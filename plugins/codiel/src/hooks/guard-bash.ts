#!/usr/bin/env node
import fs from "node:fs"
import os from "node:os"
import path from "node:path"
import { findActiveRun } from "../codiel-state.js"
import { resolveRaguelStore } from "../raguel-records.js"
import { withoutInertBodies } from "./heredoc.js"
import {
  emit,
  findMainRoot,
  ghPostPhaseProblem,
  pass,
  readStdin,
  resolvePhysicalPath
} from "./lib.js"

interface GitInvocation {
  tokens: string[]
  subIdx: number
  subcommand: string
}

// git の「サブコマンド」を正規表現ではなくトークン解析で特定する。
// `\bgit\b...\bpush\b` のような正規表現は `git stash push` や `git config push.default`
// のような「push という語を含むが push サブコマンドではない」コマンドを誤検知してしまうため、
// コマンド文字列をシェル演算子で分割 → トークン化 → オプションを読み飛ばして
// 最初の非オプショントークン(=サブコマンド)を特定する方式に置き換える。
// `&&` は単独の `&`(バックグラウンド実行・複数コマンド区切り)を含むため、
// 先に `&&` を、続けて単独 `&` を試すことで `cmd1 & cmd2` のような区切りも分割できるようにする。
const SEGMENT_SPLIT_RE = /;|&&|&|\|\||\||\n/

// 行末の `\` と改行(行の継続)を取り除き、1 行へ戻す。SEGMENT_SPLIT_RE は改行でも
// 分割するので、戻さないと `git push \⏎ --force origin main` の起動と引数が別の
// セグメントに分かれて検査を抜ける。bash と同じく空白は足さない。`\\` の直後の改行は
// 継続ではないので、改行の直前の `\` が奇数個のときだけ取り除く。
function joinContinuedLines(cmd: string): string {
  return cmd.replace(/(?<!\\)((?:\\\\)*)\\\n/g, "$1")
}
// git のサブコマンドより前で値を取るオプション。次のトークンが値として続く
// (`--git-dir=x` のように = で連結されている場合はそのトークン自身で完結する)。
const VALUE_TAKING_OPTS = ["-C", "--git-dir", "--work-tree", "-c"]

// トークンが git 起動を指すかどうかを判定する。`(git ...)` のようなサブシェルの
// 先頭に付く `(` を剥がした上で、`git` 完全一致、または `/usr/bin/git` のような
// 絶対パス経由の起動(`/git` で終わる)を許容する。
function isGitToken(tok: string): boolean {
  const stripped = tok.replace(/^\(+/, "")
  return stripped === "git" || stripped.endsWith("/git")
}

// cmd を gh と同じ字句解析でコマンドの語の列に分ける(parseCommands。閉じていないクォートか
// コマンド置換が残れば splitLoosely)。クォートを外した語で読むので `git "push"` も push と
// 読み、`bash -c "…"` の中の git も起動と見なす。heredoc の本文は読み飛ばす。
function gitCommandsByTokens(cmd: string): string[][] {
  return parseCommands(cmd) ?? splitLoosely(cmd)
}

// cmd の行の継続を 1 行へ戻し、`;` `&&` `&` `||` `|` 改行で区切って空白で分ける(字句解析の前の
// 読み方)。語の前後のクォート・括弧は外す。heredoc と here-string でシェルへ渡した本文の
// git も起動と読むので、force と保護ブランチの判定ではこの読み方も併せて当てる(誤検知の側に倒す)。
function gitCommandsByLines(cmd: string): string[][] {
  return joinContinuedLines(cmd)
    .split(SEGMENT_SPLIT_RE)
    .map((segment) =>
      segment
        .split(/\s+/)
        .map((tok) => tok.replace(/^[("'`$]+|["'`)]+$/g, ""))
        .filter(Boolean)
    )
}

// 語の列ごとに `git`(env 等の前置後や絶対パス・サブシェルの `(` 付きでも可)の語を探し、
// その直後のオプション列を読み飛ばして最初の非オプションの語をサブコマンドとして返す。
// 1 つのコマンドに複数の git の語が残る場合に備え、全ての git の語を走査する。
function findGitInvocations(commands: string[][]): GitInvocation[] {
  const invocations: GitInvocation[] = []
  for (const tokens of commands) {
    let gitIdx = tokens.findIndex((tok) => isGitToken(tok))
    while (gitIdx !== -1) {
      let idx = gitIdx + 1
      while (idx < tokens.length) {
        const tok = tokens[idx]
        if (!tok.startsWith("-")) break
        const isValueOpt =
          VALUE_TAKING_OPTS.includes(tok) ||
          VALUE_TAKING_OPTS.some((o) => tok.startsWith(`${o}=`))
        idx += isValueOpt && !tok.includes("=") ? 2 : 1
      }
      const subcommand = tokens[idx]
      if (subcommand !== undefined) {
        invocations.push({ tokens, subIdx: idx, subcommand })
      }
      const rest = tokens.slice(gitIdx + 1).findIndex((tok) => isGitToken(tok))
      gitIdx = rest === -1 ? -1 : gitIdx + 1 + rest
    }
  }
  return invocations
}

// push サブコマンド自身に続く引数(remote・refspec・オプション)のトークン列。
function pushArgs(inv: GitInvocation): string[] {
  return inv.tokens.slice(inv.subIdx + 1)
}

// force push とみなすオプショントークン。`--force-with-lease`/`--force-if-includes` は
// 単純な `--force` より安全とされることがあるが、いずれも履歴書き換え push であり
// 保護対象ブランチに対して実行されればリモートの履歴を破壊し得るため deny 対象とする。
const FORCE_TOKENS = [
  "--force",
  "-f",
  "--force-with-lease",
  "--force-if-includes"
]

// 短いオプションの結合に f を含むもの(`-vf`)と、+ で始まる refspec(`+feature`)も force に数える。
function isForceToken(tok: string): boolean {
  return (
    FORCE_TOKENS.includes(tok) ||
    tok.startsWith("--force-with-lease=") ||
    /^-[A-Za-z]*f[A-Za-z]*$/.test(tok) ||
    tok.startsWith("+")
  )
}

// force push(--force / -f / --force-with-lease[=...] / --force-if-includes)を
// トークン単位で検出する。
function hasForcePush(invocations: GitInvocation[]): boolean {
  return invocations.some(
    (inv) => inv.subcommand === "push" && pushArgs(inv).some(isForceToken)
  )
}

// refspec の別記法(`+branch` の force 記法、`src:dest`、`refs/heads/...` 完全形)に
// 対応した保護ブランチ(main/master)宛先判定。
// トークン先頭の `+` を剥がし、`:` を含む場合は最後の `:` より後(push 先)、
// 含まない場合はトークン全体を dest とし、main/master または
// refs/heads/main・refs/heads/master に完全一致するかを見る。
function isProtectedBranchDest(token: string): boolean {
  const stripped = token.startsWith("+") ? token.slice(1) : token
  const lastColon = stripped.lastIndexOf(":")
  const dest = lastColon === -1 ? stripped : stripped.slice(lastColon + 1)
  return (
    dest === "main" ||
    dest === "master" ||
    dest === "refs/heads/main" ||
    dest === "refs/heads/master"
  )
}

// 保護ブランチ(main/master)宛の push かどうかをトークン単位で判定する。
// remote 名(origin 固定)には依存せず、オプション(- 始まり)を除く各トークンが
// isProtectedBranchDest を満たすかを見る。これにより "main-refactor-branch" のような
// 誤 deny や、"upstream main" のような origin 以外の remote への push の見逃しを防ぐ。
function pushesToProtectedBranch(invocations: GitInvocation[]): boolean {
  return invocations.some(
    (inv) =>
      inv.subcommand === "push" &&
      pushArgs(inv).some((t) => !t.startsWith("-") && isProtectedBranchDest(t))
  )
}

// ---------------------------------------------------------------------------
// 投稿する本文のマーカー(設計書 §6.8「投稿する本文のマーカー」)
//
// run が active な間、GitHub へ本文を投稿する gh のコマンドには
// `<!-- codiel:generated -->` を求める。マーカーの検査は guard-github-mcp と
// 関数を共有せず、このファイルの中だけで完結させる(計画書 §12 の不採用案)。
// ---------------------------------------------------------------------------

const GENERATED_MARKER = "<!-- codiel:generated -->"

// マーカーの検査対象になる gh のコマンド(「object action」の形。gh api は "api" で、
// 別の規則(readGhApiPost)で読む)と、それぞれの値を取る短いフラグの文字。
// 短いフラグの結合(`-df`)を分けるときに、値を取るフラグの後ろの文字を結合と
// 読み違えないために使う(gh 2.101.0 の各コマンドの --help で確認。-R は継承のフラグ)。
// 同じ文字でもコマンドによって意味が違う(pr create の -f は --fill、gh api の -f は
// --raw-field)ので、コマンドごとに持つ。
const GH_POST_COMMANDS: Record<string, string> = {
  "issue create": "abFlmpTtR",
  "issue comment": "bFR",
  "issue edit": "bFmtR",
  "pr create": "aBbFHlmprTtR",
  "pr comment": "bFR",
  "pr edit": "BbFmtR",
  "pr review": "bFR",
  api: "FHXfpqt"
}

// --fill 系(短縮形の -f を含む)・--template/-T は本文のフラグ(--body/-b/--body-file/-F)を
// 持たずに本文を作ってしまうため、投稿する中身を検査できない。run が active な間は
// これらを deny し、マーカー付きの本文を --body-file で渡して作り直すよう
// 案内する(決定 64)。--fill 系は pr create だけが持ち、--template/-T は
// issue create にもある。
const FILL_FLAGS = ["--fill", "-f", "--fill-first", "--fill-verbose"]
const TEMPLATE_FLAGS = ["--template", "-T"]
const AUTO_BODY_FLAGS: Record<string, string[]> = {
  "pr create": [...FILL_FLAGS, ...TEMPLATE_FLAGS],
  "issue create": TEMPLATE_FLAGS
}
// gh pr create と gh issue create の --web / -w は Web の作成画面を開き、そこでの
// 投稿は検査できないので、本文のフラグの有無によらず deny する(決定 66)。
// gh issue create --web は、タイトルだけなら TTY の無い環境で gh が拒むが、タイトルと
// 本文を渡すと作成画面へ進む。
const WEB_FLAGS = ["--web", "-w"]

// tokens が names のいずれかのフラグを持つか(値の有無は問わない)。
// `--flag=value` の形に加え、`-Tfile.md` のように短いフラグへ値を連結した形も
// 持つとみなす(flagAt の短いフラグの扱いと揃える)。
function hasFlag(tokens: string[], names: string[]): boolean {
  return tokens.some((tok) =>
    names.some(
      (n) =>
        tok === n ||
        tok.startsWith(`${n}=`) ||
        (/^-[^-]$/.test(n) && tok.startsWith(n) && tok.length > 2)
    )
  )
}

// gh の object(pr・issue)と action の間に置ける、値を取るオプション。
// `gh pr -R o/r comment 1` の o/r を action と取り違えないために読み飛ばす。
const GH_VALUE_OPTS = ["-R", "--repo"]

interface GhInvocation {
  tokens: string[]
  command: string
}

// heredoc の開始。`<<` か `<<-` の後に空白を置いてよく、終端の語は次のどれかである。
// - クォートした語(`'EOF'`・`"EOF"`・`'END-OF-MSG'`)。中は英数字以外の文字も受ける。
// - `\` を前に付けた語(`\EOF`)と、クォートしない語(`EOF`)。英字か _ で始まり、英数字と
//   _ だけから成るものを受ける。
// どれも直後が語の区切りのものだけを受ける(`<<EOF-X`・`<<'A'B` は開始と見なさない)。
// クォートした語と `\` を付けた語の heredoc は、bash が本文を展開しない。
const HEREDOC_RE =
  /^<<(-?)[ \t]*(?:'([^'\n]+)'|"([^"\n\\$`]+)"|(\\?)([A-Za-z_]\w*))(?=[\s;&|)<>]|$)/

// `-c` の直後の語を、中身もコマンドの列として読むシェル。
const SHELLS = ["bash", "sh", "zsh", "dash", "ksh"]

// シェルのコマンド文字列を字句解析し、単純なコマンドごとに、クォートを外した語の列を返す。
// gh の起動を分けるのは、コマンドの区切り(; & | 改行とサブシェルの括弧)とコマンド置換
// ($( … ) とバッククォート)の境界だけである。クォートの中は 1 つの語にまとめ、そこに
// 書かれた gh で外側の起動を分けない。コマンド置換の中のコマンドは別のコマンドとしても
// 返し、置換を含む語には置換の原文を残す(`--body "$(gh …)"` の値を失わないため)。
// 次の語は、中身もコマンドの列として読む。
// - シェル(SHELLS。絶対パスを含む)の語より後ろにある `-c`(`-lc` などの結合を含む)の
//   直後の語。`env X=1 bash -lc "gh …"` を読み、`grep -c "gh pr create"` のような
//   シェルでないコマンドの -c の値は読まない。
// - `eval` の直後の語。
// 行末の `\` による継続は語をつなぐ。
// 閉じていないクォートかコマンド置換を残して文字列の終わりに達したときは、undefined を
// 返す。bash はそのコマンドを実行しないが、この字句解析が heredoc の開始を見落とし、本文の
// `don't` の `'` から後ろを 1 語に読んだときにも起きる。呼び出し元は splitLoosely で
// 厳しい側に読み直す。
//
// heredoc の本文は、終端の行(<<- のときは先頭のタブを除いた行)が見つかったときだけ
// 読み飛ばす。コミットメッセージの heredoc に書いた gh の使用例を起動と見なさないためである。
// - 終端の語をクォートしない heredoc(<<EOF)では、bash が本文のコマンド置換を実行する
//   ので、本文の $( … ) とバッククォートの中だけをコマンドとして読む。
// - クォートとコメントの中の `<<`、直前が数字・`)`・`<` の `<<`(`<<<` の here-string、
//   `1<<2`・`(1)<<y` の算術のシフト)、算術の展開 `$(( … ))` の中の `<<` は開始と見なさず、
//   後の行も読み飛ばさない(判定に迷う形は検査する側に倒す)。識別子の直後の `<<`
//   (`cat<<EOF`)は開始と見なす。
// 既知の限界は次のとおり。
// - `bash <<EOF` の本文で起動した gh の投稿は見逃す。
// - `$` の無い算術のコマンド `(( x << y ))` の `<<` は開始と読み違え、`y` だけの行が
//   あればそこまでを読み飛ばす。
// - HEREDOC_RE が受けない書き方(`<<END-OF-MSG`・`<<E"O"F`・`0<<EOF`)と、終端の語を
//   `)` と同じ行に書く `$(cat <<'EOF' … EOF)` は、本文の行をコマンドとして読む(誤検知の
//   側)。本文に対になっていないクォートがあれば、splitLoosely で読み直す。
// - シェルの語がコマンド名かどうかは見ないので、`echo bash -c "gh pr create"` の値も
//   コマンドとして読む(誤検知の側)。
// - `case` の `)` を含むコマンド置換は早く閉じる。
function parseCommands(text: string): string[][] | undefined {
  const commands: string[][] = []
  const pending: { word: string; dash: boolean; quoted: boolean }[] = []
  let i = 0
  let inArith = false
  let unclosed = false

  // text[i] の $( かバッククォートから置換の中をコマンドとして読み、置換の原文を返す。
  // `$((` は算術の展開として読み、中の `<<` を heredoc の開始と見なさない。
  const readSubst = (): string => {
    const start = i
    const backquote = text[i] === "`"
    const outer = inArith
    inArith = text.startsWith("$((", i)
    i += backquote ? 1 : 2
    parseList(backquote ? "`" : ")")
    inArith = outer
    return text.slice(start, i)
  }

  // text[i] の " から閉じの " までを読み、中身を返す。
  const readDouble = (): string => {
    let out = ""
    i++
    while (i < text.length && text[i] !== '"') {
      const c = text[i]
      if (c === "\\") {
        const next = text[i + 1] ?? ""
        if (next !== "\n") out += '$`"\\'.includes(next) ? next : c + next
        i += 2
      } else if (c === "`" || text.startsWith("$(", i)) out += readSubst()
      else {
        out += c
        i++
      }
    }
    if (i >= text.length) unclosed = true
    i++
    return out
  }

  // 語を 1 つ読み、クォートを外した文字列を返す。close は読んでいる置換の閉じの文字。
  const readWord = (close?: string): string => {
    let out = ""
    while (i < text.length) {
      const c = text[i]
      if (" \t\n;&|()".includes(c) || (c === "`" && close === "`")) break
      if (c === "\\") {
        if (text[i + 1] !== "\n") out += text[i + 1] ?? ""
        i += 2
      } else if (c === "'" || text.startsWith("$'", i)) {
        const from = c === "'" ? i + 1 : i + 2
        let end = from
        while (end < text.length && text[end] !== "'")
          end += c === "$" && text[end] === "\\" ? 2 : 1
        if (end >= text.length) unclosed = true
        out += text.slice(from, end)
        i = end + 1
      } else if (c === '"') out += readDouble()
      else if (c === "`" || text.startsWith("$(", i)) out += readSubst()
      else {
        const m =
          c === "<" && !inArith && !/[\d)<]/.test(text[i - 1] ?? "")
            ? text.slice(i).match(HEREDOC_RE)
            : null
        if (m)
          pending.push({
            word: m[2] ?? m[3] ?? m[5],
            dash: m[1] === "-",
            quoted: m[5] === undefined || m[4] === "\\"
          })
        const s = m ? m[0] : c
        out += s
        i += s.length
      }
    }
    return out
  }

  // 改行の直後で、待っている heredoc の本文を順に読み飛ばす。終端の行が無ければ、
  // その heredoc から後は本文と見なさず、通常のコマンドとして読む。
  const skipHeredocBodies = (): void => {
    for (const { word, dash, quoted } of pending.splice(0)) {
      const lines = text.slice(i).split("\n")
      const k = lines.findIndex(
        (l) => (dash ? l.replace(/^\t+/, "") : l) === word
      )
      if (k === -1) return
      let bodyEnd = i
      for (const l of lines.slice(0, k)) bodyEnd += l.length + 1
      while (!quoted && i < bodyEnd) {
        if (text[i] === "\\") i += 2
        else if (text[i] === "`" || text.startsWith("$(", i)) readSubst()
        else i++
      }
      i = Math.max(i, bodyEnd + lines[k].length + 1)
    }
  }

  // close(置換の閉じの文字)か文字列の終わりまで、コマンドを読む。
  const parseList = (close?: string): void => {
    let words: string[] = []
    let depth = 0
    let closed = false
    const flush = () => {
      if (words.length > 0) commands.push(words)
      words = []
    }
    while (i < text.length) {
      const c = text[i]
      if (c === close && (close === "`" || depth === 0)) {
        closed = true
        i++
        break
      }
      if (c === "\\" && text[i + 1] === "\n") i += 2
      else if (c === " " || c === "\t") i++
      else if (";&|()\n".includes(c)) {
        flush()
        if (c === "(") depth++
        if (c === ")") depth--
        i++
        if (c === "\n") skipHeredocBodies()
      } else if (c === "#") {
        const eol = text.indexOf("\n", i)
        i = eol === -1 ? text.length : eol
      } else words.push(readWord(close))
    }
    flush()
    if (close !== undefined && !closed) unclosed = true
  }

  parseList()
  if (unclosed) return undefined
  for (const words of [...commands]) {
    const shellAt = words.findIndex((w) => SHELLS.includes(path.basename(w)))
    for (let k = 1; k < words.length; k++) {
      const prev = words[k - 1]
      if (
        prev !== "eval" &&
        !(shellAt !== -1 && shellAt < k - 1 && /^-\w*c$/.test(prev))
      )
        continue
      const inner = parseCommands(words[k])
      if (inner === undefined) return undefined
      commands.push(...inner)
    }
  }
  return commands
}

// parseCommands が閉じていないクォートかコマンド置換を残したときの、厳しい側の読み方
// (字句解析に書き直す前の方式)。行の継続を戻して ; & | 改行で分け、空白で区切った語ごとに
// 2 つの値を作る。bare は、前後のクォート・括弧・コマンド置換の開きだけを外した値で、
// これを words に積む(代入があれば残す)。ghWord は、bare からさらに前置きの代入
// (`NAME=`・`NAME+=`)と開きを外した値で、この語が gh の起動の始まりかどうかの判定にだけ
// 使う。判定用の値と積む値を分けるのは、`gh api … -f body=<値>` のように代入の形に
// 見える引数(`body=`)を、gh の判定のためだけに剥がしてしまうと、積んだ words 側の
// `body=` まで失われ、本文のキー照合が壊れるためである(M2-E-R)。ghWord が `gh` か
// `*/gh` に一致したときだけそこでコマンドを分け、積む語には(元の代入つきの値ではなく)
// 判定に使った ghWord を積む。`url=$(gh …)`・`PR=$(gh pr create …)`・`` x=`gh …` ``・
// `x+=$(gh …)`・`arr+=("$(gh …)")`・`echo "url=$(gh …)"` のように、語の途中や引用符の
// 中から始まる gh の起動も見つける(M2-FX5-AR、M2-E-AR)。クォートの中と heredoc の本文の
// gh も起動と見なすので、誤検知の側に倒れる。
function splitLoosely(cmd: string): string[][] {
  const commands: string[][] = []
  for (const segment of joinContinuedLines(cmd).split(SEGMENT_SPLIT_RE)) {
    let words: string[] = []
    for (const tok of segment.split(/\s+/)) {
      const bare = tok.replace(/^[("'`$]+|["'`)]+$/g, "")
      const ghWord = bare.replace(/^[A-Za-z_]\w*\+?=[("'`$]*/, "")
      if (ghWord === "gh" || ghWord.endsWith("/gh")) {
        commands.push(words)
        words = [ghWord]
        continue
      }
      if (bare !== "") words.push(bare)
    }
    commands.push(words)
  }
  return commands
}

// `-df` のような短いフラグの結合を `-d` `-f` に分ける(gh の引数の解釈と同じ)。
// valueShorts(値を取るフラグの文字)に当たったら、残りをその値として `-Tfile.md` の
// 形で残す(flagAt・hasFlag が値の連結として読む)。英字以外の文字(`-f=true` の `=`
// など)に当たったら、残りを直前のフラグに付けたまま残す。
function expandShortFlags(tokens: string[], valueShorts: string): string[] {
  return tokens.flatMap((tok) => {
    if (!/^-[A-Za-z]./.test(tok)) return [tok]
    const out: string[] = []
    for (let i = 1; i < tok.length; i++) {
      if (!/[A-Za-z]/.test(tok[i])) {
        out[out.length - 1] += tok.slice(i)
        break
      }
      if (valueShorts.includes(tok[i])) {
        out.push(`-${tok.slice(i)}`)
        break
      }
      out.push(`-${tok[i]}`)
    }
    return out
  })
}

// cmd をコマンドに分け(parseCommands。閉じていないクォートかコマンド置換が残れば
// splitLoosely)、gh の起動ごとに「object action」(issue create
// など)を git と同じくトークン解析で取り出す。起動は、コマンドの中の最初の gh の語から
// そのコマンドの終わりまでとする。gh api は action を持たないので、command を "api" と
// する。GH_POST_COMMANDS に無いコマンドは返さず、あるものは短いフラグの結合を分けた
// トークンで返す(expandShortFlags)。
// オプションは GH_VALUE_OPTS の値だけを読み飛ばし、ほかは値の有無を判定しない
// (guard-bash の他のトークン解析と同じ簡略さで足りるため)。
function findGhInvocations(cmd: string): GhInvocation[] {
  const invocations: GhInvocation[] = []
  for (const words of parseCommands(cmd) ?? splitLoosely(cmd)) {
    const start = words.findIndex((w) => w === "gh" || w.endsWith("/gh"))
    if (start === -1) continue
    const tokens = words.slice(start)
    const skipOptions = (from: number): number => {
      let idx = from
      while (idx < tokens.length && tokens[idx].startsWith("-"))
        idx += GH_VALUE_OPTS.includes(tokens[idx]) ? 2 : 1
      return idx
    }
    const objIdx = skipOptions(1)
    const object = tokens[objIdx]
    const command =
      object === "api" ? "api" : `${object} ${tokens[skipOptions(objIdx + 1)]}`
    const valueShorts = GH_POST_COMMANDS[command]
    if (valueShorts !== undefined)
      invocations.push({
        command,
        tokens: expandShortFlags(tokens, valueShorts)
      })
  }
  return invocations
}

// tokens[i] が names のいずれかのフラグなら、その値を返す。`--body x`・`--body=x`
// に加え、短いフラグに値を連結した `-bx`・`-Fbody.md` も受ける(gh はこの形を受け付ける)。
// 値の無いフラグ(末尾の `--body`)は空の値とする。フラグでなければ undefined を返す。
function flagAt(
  tokens: string[],
  i: number,
  names: string[]
): string | undefined {
  const tok = tokens[i]
  for (const n of names) {
    if (tok === n) return tokens[i + 1] ?? ""
    if (tok.startsWith(`${n}=`)) return tok.slice(n.length + 1)
    if (/^-[^-]$/.test(n) && tok.startsWith(n) && tok.length > 2)
      return tok.slice(2)
  }
  return undefined
}

// tokens から names のいずれかのフラグの値をすべて取る。gh は同じフラグを繰り返すと
// 最後の値を使うので、本文の検査はすべての値に当てる。
function flagValues(tokens: string[], names: string[]): string[] {
  const values: string[] = []
  for (let i = 0; i < tokens.length; i++) {
    const value = flagAt(tokens, i, names)
    if (value === undefined) continue
    values.push(value)
    if (names.includes(tokens[i])) i++
  }
  return values
}

// 本文のファイルを cwd 基準で読む。`-`(標準入力)は中身を検査できないので deny し、
// 読めないファイルも deny する(emit は never を返すので、戻り値は常に読めた中身)。
function readBodyFile(flag: string, file: string, cwd: string): string {
  if (file === "-")
    emit(
      "deny",
      `${flag} に - (標準入力)は指定できません。本文をファイルに書き、パスで渡し直してください`
    )
  try {
    return fs.readFileSync(path.resolve(cwd, file), "utf8")
  } catch {
    return emit("deny", `${flag} のファイルを読み込めません: ${file}`)
  }
}

// rawFileRef は、gh api の本文を `-f body=@<パス>` で渡したとき(呼び出し元が判定する)に
// 真にする。-f は値を文字列のまま送り、本文が `@<パス>` の文字列になるためである。
function denyMissingMarker(command: string, rawFileRef = false): never {
  const hint = rawFileRef
    ? "。`-f` は値をそのまま送ります。ファイルの中身を本文にするには `-F body=@<パス>` を使ってください"
    : ""
  return emit(
    "deny",
    `gh ${command} の本文に \`${GENERATED_MARKER}\` を含めて投稿し直してください${hint}`
  )
}

// 本文付きの投稿 1 つ分。inline は本文を引数で渡すもの(--body / -b、gh api の
// 本文のフィールドの文字列)の値、files は中身を読んで検査する本文ファイル。
interface BodyPost {
  command: string
  inline: string[]
  files: { flag: string; path: string }[]
}

// gh の 7 コマンドの投稿を読む。本文のフラグ(--body/-b/--body-file/-F)を持たない
// 呼び出しは投稿と見なさず undefined を返す。ただし、pr create と issue create の
// --web / -w(決定 66)と、本文のフラグを持たない --fill 系・--template/-T(決定 64)は
// deny する。
function readGhPost({ command, tokens }: GhInvocation): BodyPost | undefined {
  if (
    (command === "pr create" || command === "issue create") &&
    hasFlag(tokens, WEB_FLAGS)
  )
    emit(
      "deny",
      `gh ${command} の --web / -w は使えません。Web の作成画面での投稿は本文を検査できないためです。マーカー付きの本文を --body-file で渡して作り直してください`
    )
  const inline = flagValues(tokens, ["--body", "-b"])
  const files = flagValues(tokens, ["--body-file", "-F"]).map((p) => ({
    flag: "--body-file",
    path: p
  }))
  if (inline.length === 0 && files.length === 0) {
    const autoFlags = AUTO_BODY_FLAGS[command]
    if (autoFlags && hasFlag(tokens, autoFlags))
      emit(
        "deny",
        `gh ${command} の --fill 系・--template/-T は本文を検査できません。マーカー付きの本文を --body-file で渡して作り直してください`
      )
    return undefined
  }
  return { command, inline, files }
}

// gh api で送る本文を読む(決定 60。§6.8 の 7 コマンドの外)。
// メソッドは gh と同じく、-X/--method の指定があれば最後の値、無ければ
// フィールドか --input があるとき POST、どちらも無いとき GET とする。
// POST・PATCH・PUT のときだけ、次を本文として返す。
// - フィールド(-f/--raw-field・-F/--field)のキーが body か `…[body]` のもの。
//   -F の値が `@<パス>` ならそのファイル、それ以外は本文を引数で渡すものとする。
// - --input のファイル(中身に "body" のキーがあるときだけマーカーを求める)。
// 本文を持たない呼び出し(読み取り、ラベルだけの更新など)は undefined を返す。
function readGhApiPost(tokens: string[]): BodyPost | undefined {
  const fields = [
    ...flagValues(tokens, ["--raw-field", "-f"]).map((value) => ({
      typed: false,
      value
    })),
    ...flagValues(tokens, ["--field", "-F"]).map((value) => ({
      typed: true,
      value
    }))
  ]
  const inputs = flagValues(tokens, ["--input"])
  const explicitMethod = flagValues(tokens, ["--method", "-X"]).at(-1)
  const method =
    explicitMethod !== undefined
      ? explicitMethod.toUpperCase()
      : fields.length > 0 || inputs.length > 0
        ? "POST"
        : "GET"
  if (!["POST", "PATCH", "PUT"].includes(method)) return undefined

  const post: BodyPost = { command: "api", inline: [], files: [] }
  for (const { typed, value } of fields) {
    const eq = value.indexOf("=")
    const key = eq === -1 ? value : value.slice(0, eq)
    if (key !== "body" && !key.endsWith("[body]")) continue
    const val = value.slice(eq + 1)
    if (typed && val.startsWith("@"))
      post.files.push({ flag: "-F", path: val.slice(1) })
    else post.inline.push(val)
  }
  for (const input of inputs) post.files.push({ flag: "--input", path: input })
  return post.inline.length > 0 || post.files.length > 0 ? post : undefined
}

// 本文ファイルのパスが、本文のフラグの値として使った回数より多くコマンドに現れたら
// deny する(決定 66)。フックは実行前にファイルを読むので、同じコマンドの中で
// 書き換えると(`cat > x.md <<EOF` や `cp t.md x.md` の後の `-F x.md`)古い中身を
// 検査してしまうためである。部分一致で数えるので、パスを含む別の語でも deny する
// (厳しい側に倒す)。値と違う表記での書き換え(値が `./x.md` で `cp t.md x.md` など)は
// 検出しないので、本文を Write ツールで書く規律と併せて防ぐ。
function denyRewrittenBodyFile(posts: BodyPost[], text: string): void {
  const paths = posts
    .flatMap((p) => p.files.map((f) => f.path))
    .filter((p) => p !== "" && p !== "-")
  for (const p of new Set(paths))
    if (text.split(p).length - 1 > paths.filter((x) => x === p).length)
      emit(
        "deny",
        `本文ファイル ${p} のパスが、同じコマンドの中で本文のフラグの値以外にも現れます。フックは実行前のファイルを検査するので、本文は Write ツールで別名のファイルに書き、別の Bash 呼び出しで --body-file で渡してください`
      )
}

// 投稿する本文にマーカーがあるかを検査し、無ければ deny する。
// 本文を引数で渡すもの(--body / -b、gh api の本文のフィールド)が 1 つなら、コマンド
// 文字列全体で見る(§6.8)。本文は heredoc や変数で組み立てることがあり、値だけでは
// 中身を追えないためである。
// 1 つの投稿に本文が 2 つ以上あるとき(本文のフラグの繰り返し、gh api の
// `comments[][body]`)は、引数の本文ごとに値そのものにマーカーを求める。gh は繰り返した
// フラグの最後の値を使うので、1 つのマーカーで別の本文を通さないためである。
// 同じ理由で、本文付きの投稿が 2 つ以上あっていずれかが本文を引数で渡すコマンドは
// deny する(決定 66)。
// 本文ファイル(--body-file / -F、gh api の -F body=@<パス>・--input)は、すべてのパスに
// ついて同じコマンドで書き換えていないことを確かめてから(denyRewrittenBodyFile)、
// cwd 基準で解決したファイルの中身を見る。本文を持たない呼び出しは通す。
function checkGeneratedMarker(
  invocations: GhInvocation[],
  cmd: string,
  cwd: string
): void {
  const posts: BodyPost[] = []
  for (const inv of invocations) {
    const post =
      inv.command === "api" ? readGhApiPost(inv.tokens) : readGhPost(inv)
    if (post) posts.push(post)
  }
  if (posts.length >= 2 && posts.some((p) => p.inline.length > 0))
    emit(
      "deny",
      "1 つのコマンドに本文付きの投稿が複数あり、本文を引数で渡すものがあります。マーカーはコマンド全体で探すので、投稿は 1 回の Bash 呼び出しに 1 つにしてください。本文は Write ツールで書いたファイルを --body-file(gh api では -F body=@<パス>)で渡してください"
    )
  denyRewrittenBodyFile(posts, joinContinuedLines(cmd))
  for (const { command, inline, files } of posts) {
    const missing =
      inline.length + files.length >= 2
        ? inline.some((body) => !body.includes(GENERATED_MARKER))
        : inline.length === 1 && !cmd.includes(GENERATED_MARKER)
    // gh api の inline に入るのは -f / --raw-field の値と @ で始まらない -F の値だけなので、
    // @ で始まる値があれば -f body=@<パス> と判定できる(設計書 §6.16.5)
    if (missing)
      denyMissingMarker(
        command,
        command === "api" && inline.some((body) => body.startsWith("@"))
      )
    for (const { flag, path: file } of files) {
      const content = readBodyFile(flag, file, cwd)
      const needsMarker = flag !== "--input" || /"body"\s*:/.test(content)
      if (needsMarker && !content.includes(GENERATED_MARKER))
        denyMissingMarker(command)
    }
  }
}

// ---------------------------------------------------------------------------
// state.json へのシェル経由の書き込みと削除(設計書 §6.16.2。決定 96)
//
// 判定は parseCommands の語の列に当てる。クォートの中の `>` を演算子と読まず、
// `&&` などの区切りをまたいで後ろのコマンドのパスに当てないためである。
// 語は文字列ではなく解決したパスで判定し、`<root>/.codiel/runs/` の配下の state.json か、
// その配下のディレクトリ(削除と移動の元)かを見る。/tmp のテストデータのように、別の場所の
// state.json は止めない。
// ---------------------------------------------------------------------------

// リダイレクトの行き先が hit を満たすか(state.json の判定と Raguel の設定と記録の判定で共有する)。
// readWord は `>` で語を区切らないので、
// 語の中の `>` のそれぞれから演算子(`>` か `>>`)を切り出し、後ろから次の `>` か `<` の
// 手前までを行き先とする(`2>` の `2` のような前の部分は含めない)。`&` と `|` は区切りなので、
// `&>path` は語 `>path` になり、`>|path` は語 `>`・区切り・次のコマンドの `path` になる。
// 行き先が空なら同じコマンドの次の語を、次の語が無ければ次のコマンドの最初の語を行き先とする。
// クォートを外した語を読むので、`"x>…state.json"` や `">"` の直後のパスは余分に止める
// (既知の限界。書き込みを見逃す側には倒れない)。
function redirectsTo(
  commands: string[][],
  ci: number,
  hit: (word: string | undefined) => boolean
): boolean {
  const words = commands[ci]
  for (let wi = 0; wi < words.length; wi++) {
    const w = words[wi]
    for (let p = w.indexOf(">"); p !== -1; ) {
      const from = p + (w[p + 1] === ">" ? 2 : 1)
      const dest = w.slice(from).split(/[<>]/)[0]
      const target =
        dest !== ""
          ? dest
          : wi + 1 < words.length
            ? words[wi + 1]
            : commands[ci + 1]?.[0]
      if (hit(target)) return true
      p = w.indexOf(">", from)
    }
  }
  return false
}

// 同じコマンドの中の tee と sed -i の引数に hit を満たす語があるか。リダイレクトの行き先と
// 入力は引数に数えないので、語の中の最初の `>` か `<` から後ろを除き、演算子だけの語の
// 次の語も除く(`tee x.log < state.json` の state.json は入力)。
function teeOrSedWrites(
  words: string[],
  hit: (word: string) => boolean
): boolean {
  const args: string[] = []
  for (let k = 0; k < words.length; k++) {
    const op = words[k].search(/[<>]/)
    if (op === -1) args.push(words[k])
    else if (op > 0) args.push(words[k].slice(0, op))
    else if (/^[<>]+$/.test(words[k])) k++
  }
  const after = (name: string) => {
    const at = args.findIndex((a) => path.basename(a) === name)
    return at === -1 ? [] : args.slice(at + 1)
  }
  const sedArgs = after("sed")
  return (
    after("tee").some(hit) ||
    (sedArgs.some((a) => /^(-[A-Za-z]*i|--in-place)/.test(a)) &&
      sedArgs.some(hit))
  )
}

const STATE_JSON_RE = /\.codiel\/runs\/\S*state\.json/

const STATE_FILE_COMMANDS = ["rm", "mv", "cp", "ln", "install", "dd"]
// cwd の候補の上限。cd が多いコマンドで候補が増えすぎないようにする
const MAX_CWD_CANDIDATES = 256

// 語の列の cd・pushd の行き先を、現れた順に返す
function cdTargets(commands: string[][]): string[] {
  return commands.flatMap((words) => {
    if (!["cd", "pushd"].includes(words[0])) return []
    const dir = words.slice(1).find((w) => !w.startsWith("-"))
    return dir === undefined ? [] : [dir]
  })
}

// 語の列の cd・pushd の行き先を元の順にたどり、元の cwd と合わせて cwd の候補にする。
// サブシェル・パイプ・{ } の区別はせず、cd の効く範囲は追わない(拒否が広がる向きに倒す)。
// 候補が MAX_CWD_CANDIDATES を超えたら null を返す。
function cwdCandidatesOf(commands: string[][], cwd: string): string[] | null {
  const out = new Set([cwd])
  for (const dir of cdTargets(commands)) {
    // 字句で畳んだ行き先と、symlink を実体で辿った行き先(`cd -P alias/..`)の両方を残す
    for (const c of [...out]) {
      out.add(path.resolve(c, expandHome(dir)))
      out.add(resolvePhysicalPath(c, expandHome(dir)))
      if (out.size > MAX_CWD_CANDIDATES) return null
    }
  }
  return [...out]
}

// 字句解析の語の列と行の走査の語の列から、それぞれ cwd の候補を作って和集合にする。
// 2 つの列は同じ cd を両方に持つが、列をまたいで相殺すると heredoc の本文の中の cd を落とす
// ので、列ごとに数える。どちらかが上限を超えたら null を返し、呼び出し元は拒否する。
// ponytail: 上限を超えるほど cd を重ねたコマンドは、書き込み先を見ずに拒否する
function cwdCandidates(
  tokenCommands: string[][],
  lineCommands: string[][],
  cwd: string
): string[] | null {
  const a = cwdCandidatesOf(tokenCommands, cwd)
  const b = cwdCandidatesOf(lineCommands, cwd)
  return a && b ? [...new Set([...a, ...b])] : null
}

// cmd が root の run の state.json へ書き込むか、state.json を含む run のディレクトリを
// 消すか動かすか。見るのはリダイレクト・tee・sed -i と、rm・mv・cp・ln・install・dd の引数で
// ある。語は、`.codiel/runs/…state.json` の文字列を含むかの字句の検査と、cwd の候補ごとに
// 字句で畳んだパスと symlink を実体で辿ったパスの照合を当て、どれかが当たれば止める。
// 字句解析は gh の起動を探すものと同じ(閉じていないクォートが残れば splitLoosely で厳しい側に
// 読み直す)。heredoc と here-string でシェルへ渡したコマンドも見るため、コマンドの全行を行の
// 走査(gitCommandsByLines)でも読む。差し引くのは、受け手が本文を実行しないと確かに分かる
// heredoc の本文の行だけである(heredoc.ts の isInertHeredoc)。`.codiel/runs/` を含まない変数で渡したパスは
// 見えない(既知の限界)。
// 止めるときは理由の文を返し、止めないときは undefined を返す。
function stateJsonProblem(cmd: string, cwd: string): string | undefined {
  // git commit・git tag・gh の `-m`・`--message`・`--body` の値で改行を含む語は、コミット
  // メッセージや本文である。中の `>` やパスを書き込みと読まないために外す。置換の中のコマンドは
  // 字句解析が別のコマンドとして読む。それ以外の改行を含む語は判定に残す
  const tokenCommands = (parseCommands(cmd) ?? splitLoosely(cmd)).map(
    withoutMessageValues
  )
  const lineCommands = gitCommandsByLines(withoutInertBodies(cmd))
  const root = findMainRoot(cwd)
  const runsDirs = [
    path.join(root, ".codiel", "runs"),
    resolvePhysicalPath(root, path.join(".codiel", "runs"))
  ]
  const underRuns = (p: string) => runsDirs.some((d) => isUnder(p, d))
  const cwds = cwdCandidates(tokenCommands, lineCommands, cwd)
  if (cwds === null) return "cd が多すぎて書き込み先を判定できない"
  // 字句で畳んだパス・生の結合パスを実体で辿ったパス・字句で畳んだパスを実体で辿ったパス
  const resolved = (word: string): string[] =>
    cwds.flatMap((c) => {
      const lexical = path.resolve(c, expandHome(word))
      return [
        lexical,
        resolvePhysicalPath(c, expandHome(word)),
        resolvePhysicalPath(c, lexical)
      ]
    })
  // 字句の検査(語に `.codiel/runs/…state.json` を含む)も残す。`$PWD/…` や `` `pwd`/… `` の
  // ようにシェルの展開を含む語は、解決したパスでは当たらないためである
  const isStateFile = (word: string | undefined): boolean =>
    word !== undefined &&
    word !== "" &&
    (STATE_JSON_RE.test(word) ||
      resolved(word).some(
        (p) => path.basename(p) === "state.json" && underRuns(p)
      ))
  // 消すか動かすと state.json が失われるパス。runs の配下のディレクトリ(存在しないものを
  // 含む)か、runs を含む祖先
  const holdsState = (word: string): boolean =>
    resolved(word).some(
      (p) =>
        runsDirs.some((d) => isUnder(d, p)) ||
        (underRuns(p) && !isRegularFile(p))
    )
  // runs の配下か、runs を含む祖先(ln のリンク先と、作るリンクの名前の判定に使う)
  const touchesRuns = (word: string): boolean =>
    resolved(word).some(
      (p) => underRuns(p) || runsDirs.some((d) => isUnder(d, p))
    )
  // words[at] の rm・mv・cp・ln・install・dd が state.json を書き換えるか消すか
  const fileOpWrites = (words: string[], at: number): boolean => {
    if (at < 0 || at >= words.length) return false
    const name = path.basename(words[at])
    if (!STATE_FILE_COMMANDS.includes(name)) return false
    // 書き込み先のディレクトリをオプションで渡す形(`-t <dir>`・`-t<dir>`・`--target-directory <dir>`・
    // `--target-directory=<dir>`)の値は、引数から分けて書き込み先とする
    const args: string[] = []
    let targetDir: string | undefined
    let noTargetDir = false
    let parents = false
    const rest = words.slice(at + 1)
    for (let k = 0; k < rest.length; k++) {
      const a = rest[k]
      if (name === "dd") {
        if (a.startsWith("of=")) args.push(a.slice(3))
      } else if (isTargetDirectoryOption(a))
        // GNU の長いオプションの省略形(`--target-dir`・`--t`)も受ける
        targetDir = a.includes("=") ? a.slice(a.indexOf("=") + 1) : rest[++k]
      else if (/^-[A-Za-z]*t$/.test(a)) targetDir = rest[++k]
      else if (/^-[A-Za-z]*t./.test(a) && !a.startsWith("--"))
        targetDir = a.slice(a.indexOf("t") + 1)
      else if (isNoTargetDirectoryOption(a) || /^-[A-Za-z]*T[A-Za-z]*$/.test(a))
        noTargetDir = true
      else if (isParentsOption(a)) parents = true
      else if (!a.startsWith("-") && a !== "") args.push(a)
    }
    if (args.some(isStateFile)) return true
    if (name === "rm") return args.some(holdsState)
    if (name === "dd") return false
    // cp・mv・install・ln は「書かれるパスの根」で判定する。
    // 1. 書き込み先 D は -t などの値か位置引数の最後の語。ln で位置引数が 1 個なら D は `.`(cwd)
    // 2. 元ごとの書かれる根 W は、-T・--no-target-directory のとき D、それ以外は D に元の basename を
    //    つないだもの(元が `/.` で終わる中身のコピーは basename が `.` なので D になる)
    // 3. W が runs の配下か runs そのものか runs の祖先なら、元を問わず拒否する。祖先への中身の
    //    コピー(`cp -a src/. .`)も止める(受け入れる誤拒否。ファイルを指定してコピーすれば避けられる)
    // 4. `--parents` のときは、D と実際の配置先(D に元の語をそのままつないだもの)の両方を照合し、
    //    どちらかが runs の配下か runs そのものか runs の祖先なら拒否する
    // 元の中身や symlink を見て通す許可は持たない。許可を細かくするほど抜けが増えるためである。
    // 指示書に runs の下へこれらで書く手順は無い
    const lnImplicit =
      name === "ln" && targetDir === undefined && args.length === 1
    const dest =
      targetDir ??
      (lnImplicit ? "." : args.length >= 2 ? args.at(-1) : undefined)
    const sources =
      targetDir !== undefined || lnImplicit
        ? args
        : args.slice(0, Math.max(args.length - 1, 0))
    if (dest !== undefined) {
      if (parents && touchesRuns(dest)) return true
      // path.join は `alias/..` を字句で畳むので、生の文字列でつなぐ。--parents の配置先は、元の
      // 語をそのまま(絶対パスは先頭の / を外して)つないだもの
      for (const src of sources) {
        if (touchesRuns(noTargetDir ? dest : `${dest}/${path.basename(src)}`))
          return true
        // `~` から始まる元は、展開した後のパスでもつなぐ(`$HOME` などの変数は範囲外)
        if (
          parents &&
          [src, expandHome(src)].some((s) =>
            touchesRuns(`${dest}/${s.replace(/^\/+/, "")}`)
          )
        )
          return true
      }
    }
    if (name === "mv" && sources.some(holdsState)) return true
    // 同じコマンドで run の配下への symlink を作ってから書く形(`ln -s <runs の配下> a && … > a/state.json`)
    return name === "ln" && args.some(touchesRuns)
  }
  // 字句解析の語の列では、コマンドの中の最初のファイル操作の語をコマンド名とする
  const byTokens = tokenCommands.some(
    (words, ci) =>
      redirectsTo(tokenCommands, ci, isStateFile) ||
      teeOrSedWrites(words, isStateFile) ||
      fileOpWrites(
        words,
        words.findIndex((w) => STATE_FILE_COMMANDS.includes(path.basename(w)))
      )
  )
  // 行の走査では、コマンド名を区切りの先頭の語・`<<<` の直後の語・シェルの `-c` の直後の
  // 語でだけ認める。printf などのデータの中の `cp …` をコマンドと読まないためである。
  // sudo・env などが前に付く形は、字句解析の側が拾う。
  const byLines = lineCommands.some(
    (words, ci) =>
      redirectsTo(lineCommands, ci, isStateFile) ||
      teeOrSedWrites(words, isStateFile) ||
      words.some(
        (_, k) =>
          (k === 0 ||
            words[k - 1] === "<<<" ||
            (/^-\w*c$/.test(words[k - 1]) &&
              words
                .slice(0, k - 1)
                .some((w) => SHELLS.includes(path.basename(w))))) &&
          fileOpWrites(words, k)
      )
  )
  return byTokens || byLines
    ? "state.json へのシェル経由の書き込みか削除"
    : undefined
}

// git commit・git tag・gh のコマンドで、`-m`・`--message`・`--body` の値になっている改行を含む語を
// 外した語の列を返す。ほかのコマンドと、ほかの語はそのまま残す
function withoutMessageValues(words: string[]): string[] {
  // 先頭のコマンド(`VAR=値` の代入だけを飛ばした最初の語)が git commit・git tag・gh のときに限る。
  // シェル・eval・xargs・env・sudo などの後ろの囮の `gh` で外し始めないためである
  const at = words.findIndex((w) => !/^[A-Za-z_]\w*=/.test(w))
  const head = words[at]
  if (
    at === -1 ||
    !(
      (head === "git" && ["commit", "tag"].includes(words[at + 1] ?? "")) ||
      head === "gh"
    )
  )
    return words
  return words.filter((w, k) => {
    if (k <= at || !w.includes("\n")) return true
    const prev = words[k - 1]
    const inline = /^(?:--message|--body)=/.test(w) || /^-m./.test(w)
    return !(["-m", "--message", "--body"].includes(prev) || inline)
  })
}

// `--target-directory` か、その GNU の省略形(3 文字以上の前方一致。`=値` の付いた形を含む)か
function isTargetDirectoryOption(a: string): boolean {
  const name = a.split("=")[0]
  return name.length >= 3 && "--target-directory".startsWith(name)
}

// `--no-target-directory` か、その GNU の省略形(`--no-clobber` などと区別できる `--no-t` 以上の
// 前方一致)か
function isNoTargetDirectoryOption(a: string): boolean {
  return a.length >= 6 && "--no-target-directory".startsWith(a)
}

// `--parents` か、その GNU の省略形(`--pa` 以上の前方一致)か
function isParentsOption(a: string): boolean {
  return a.length >= 4 && "--parents".startsWith(a)
}

function isRegularFile(p: string): boolean {
  try {
    return fs.statSync(p).isFile()
  } catch {
    return false
  }
}

// ---------------------------------------------------------------------------
// Raguel の設定と記録へのシェル経由の書き込み(Raguel 設計書 §6.13.4、所見 G8・R12)
//
// 守るのは `.codiel/config.json` と、RAGUEL_CONFIG が指すファイルと、casesDir の配下である。
// run が active か awaiting_human の間は、これらを書き換えるコマンドを止める。人の裁定を待つ間に設定を緩めたり
// 評価の記録を書き換えたりして、ゲートを偽装するのを防ぐためである。
// 判定は state.json と同じく parseCommands の語の列に当てる(閉じていないクォートでは
// splitLoosely)。見るのはリダイレクト・tee・sed -i・cp・mv・rm・dd・install である。
// 既知の限界(codiel 設計 §6.8 の書き方に倣う)。どれも書き込みを見逃す側である。
// - 変数(`$HOME` と `${HOME}` を除く)・グロブ・コマンド置換で組み立てたパスは展開しない。
// - 上の 8 つ以外で書くコマンド(`truncate`・`ln -sf`・`perl -i`・`python -c`・`node -e`・
//   `git checkout -- <パス>` など)と、`bash <<EOF` の本文は見ない。
// - シンボリックリンクを経由した別名のパスは、論理パスのまま比べるので見逃す。
// - ディレクトリごと写して中のファイルで上書きする形(`cp -r dir/ .codiel`)は見逃す。
// 厳しい側の限界もある。cp と install はコピー元も判定に入れるので、設定や記録を
// 外へ写すだけのコマンドも止める。
// ---------------------------------------------------------------------------

const FILE_COMMANDS = ["cp", "mv", "rm", "dd", "install"]
const CODIEL_CONFIG_RE = /[/\\]\.codiel[/\\]config\.json$/i

// p が dir そのものか、その配下か
function isUnder(p: string, dir: string): boolean {
  const rel = path.relative(dir, p)
  return (
    rel === "" ||
    (rel !== ".." && !rel.startsWith(`..${path.sep}`) && !path.isAbsolute(rel))
  )
}

interface RaguelTargets {
  // 守るファイル。<root>/.codiel/config.json と、RAGUEL_CONFIG が指すファイル
  files: string[]
  // 守るディレクトリ。設定が読めなければ null(そのとき Raguel も評価できない)
  casesDir: string | null
}

function raguelTargets(root: string): RaguelTargets {
  const files = [path.join(root, ".codiel", "config.json")]
  const env = process.env.RAGUEL_CONFIG
  if (env) files.push(path.resolve(env))
  let casesDir: string | null = null
  try {
    casesDir = resolveRaguelStore(root).casesDir
  } catch {
    // 設定の不正は pass-gate が失敗として扱う。ここで止めると run の間の Bash がすべて止まる
  }
  return { files, casesDir }
}

// `~`・`$HOME`・`${HOME}` の先頭だけをホームディレクトリへ展開する
function expandHome(word: string): string {
  return word.replace(/^(~|\$HOME|\$\{HOME\})(?=\/|$)/, os.homedir())
}

// 語をパスとして読む
function wordPath(word: string, cwd: string): string {
  return path.resolve(cwd, expandHome(word))
}

// cmd が Raguel の設定か記録を書き換えるか。書き換えるなら、その語を返す。
function writesRaguelFiles(
  cmd: string,
  cwd: string,
  t: RaguelTargets
): string | undefined {
  const isTarget = (abs: string) =>
    CODIEL_CONFIG_RE.test(abs) ||
    t.files.includes(abs) ||
    (t.casesDir !== null && isUnder(abs, t.casesDir))
  // rm と mv で動かすディレクトリが、守るパスを含むか(`rm -rf .codiel`)
  const contains = (abs: string) =>
    t.files.some((f) => isUnder(f, abs)) ||
    (t.casesDir !== null && isUnder(t.casesDir, abs))
  // cp・mv・install の行き先が守るファイルの親で、同じ名前のファイルを写すか
  // (`cp x/config.json .codiel`)
  const isParent = (abs: string, args: string[]) =>
    t.files.some(
      (f) =>
        path.dirname(f) === abs &&
        args.some((a) => path.basename(a) === path.basename(f))
    )
  let found: string | undefined
  const hit = (word: string | undefined): boolean => {
    if (word === undefined || word === "") return false
    if (!isTarget(wordPath(word, cwd))) return false
    found = word
    return true
  }
  const commands = parseCommands(cmd) ?? splitLoosely(cmd)
  for (let ci = 0; ci < commands.length; ci++) {
    const words = commands[ci]
    if (redirectsTo(commands, ci, hit) || teeOrSedWrites(words, hit))
      return found
    const at = words.findIndex((w) => FILE_COMMANDS.includes(path.basename(w)))
    if (at === -1) continue
    const name = path.basename(words[at])
    const args: string[] = []
    for (const a of words.slice(at + 1)) {
      if (name === "dd") {
        if (a.startsWith("of=")) args.push(a.slice(3))
      } else if (a.startsWith("--target-directory="))
        args.push(a.slice("--target-directory=".length))
      else if (!a.startsWith("-") && a !== "") args.push(a)
    }
    for (const [k, a] of args.entries()) {
      const abs = wordPath(a, cwd)
      // mv の最後の引数は行き先なので、含む判定に入れない(`mv x .` を止めない)
      const moved = name === "rm" || (name === "mv" && k < args.length - 1)
      if (
        isTarget(abs) ||
        (moved && contains(abs)) ||
        (name !== "rm" && name !== "dd" && isParent(abs, args))
      )
        return a
    }
  }
  return undefined
}

try {
  const input = await readStdin()
  const cmd = input.tool_input?.command ?? ""
  // push の有無・force・保護ブランチは、字句解析と行の走査のどちらかで当たれば当たりとする。
  // 行の走査は heredoc と here-string でシェルへ渡した本文の push も拾う(誤検知の側に倒す)
  const pushCandidates = [
    ...findGitInvocations(gitCommandsByTokens(cmd)),
    ...findGitInvocations(gitCommandsByLines(cmd))
  ]
  const isGitPush = pushCandidates.some((inv) => inv.subcommand === "push")

  const cwd = input.cwd ?? process.cwd()
  const stateProblem = stateJsonProblem(cmd, cwd)
  const ALWAYS_DENY: [boolean, string][] = [
    [
      /\brm\s+(-[a-zA-Z]*r[a-zA-Z]*f|-[a-zA-Z]*f[a-zA-Z]*r)[a-zA-Z]*\s+(\/(?!tmp)|~)/.test(
        cmd
      ),
      "作業ツリー外への rm -rf"
    ],
    [
      /\b(curl|wget)\b[^|;&]*\|\s*(ba|z)?sh\b/.test(cmd),
      "ダウンロードしたスクリプトの直接実行(curl | sh)"
    ],
    [hasForcePush(pushCandidates), "force push"],
    [
      pushesToProtectedBranch(pushCandidates),
      "保護ブランチ(main/master)への push"
    ],
    [stateProblem !== undefined, stateProblem ?? ""]
  ]
  for (const [triggered, why] of ALWAYS_DENY)
    if (triggered) emit("deny", `禁止コマンド: ${why}`)

  // run はメインの作業ツリーで探す。cwd が worktree の中でも同じ run に届く(設計書 §6.8 の (a))
  const root = findMainRoot(cwd)
  const run = findActiveRun(root)
  // findActiveRun は active / awaiting_human の run しか返さない。
  // 人間の判断待ち(awaiting_human)中こそ PR 作成や push を許してはならないため、
  // run が存在する限りゲートを適用する(status による分岐はしない)。
  if (run) {
    const raguelWord = writesRaguelFiles(cmd, cwd, raguelTargets(root))
    if (raguelWord !== undefined)
      emit(
        "deny",
        `run の間(active・awaiting_human)は Raguel の設定と記録(${raguelWord})をシェルで書き換えられません。ゲートの偽装を防ぐためです。変更するときは run を止めるか、利用者が自分で変更してください`
      )
    const phase = run.state.phase
    const testLoopPassed = run.state.phases["test-loop"]?.status === "passed"
    // フェーズの制限も、マーカーの検査と同じ gh の起動の解析(findGhInvocations)で判定する。
    // `gh -R o/r pr create` を捕まえ、コミットメッセージに書いた使用例は起動と見なさない。
    const ghInvocations = findGhInvocations(cmd)
    const invokes = (command: string) =>
      ghInvocations.some((inv) => inv.command === command)
    for (const [command, kind] of [
      ["issue create", "issue"],
      ["pr create", "pr"]
    ] as const) {
      const problem = invokes(command) && ghPostPhaseProblem(kind, run.state)
      if (problem) emit("deny", problem)
    }
    if (
      isGitPush &&
      (!["pr", "fix-loop", "triage", "finalize"].includes(phase as string) ||
        !testLoopPassed)
    )
      emit(
        "deny",
        `push は pr・fix-loop・triage・finalize のフェーズで、test-loop の合格の後にだけ実行できます(現在: ${phase})`
      )
    checkGeneratedMarker(ghInvocations, cmd, cwd)
  }
  pass()
} catch (e) {
  emit(
    "ask",
    `guard-bash の内部エラー(フェイルクローズド): ${(e as Error).message}`
  )
}
