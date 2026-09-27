#!/usr/bin/env node
import fs from "node:fs"
import path from "node:path"
import { findActiveRun } from "../codiel-state.js"
import { emit, findProjectRoot, pass, readStdin } from "./lib.js"

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

// cmd の行の継続を 1 行へ戻し(joinContinuedLines)、`;` `&&` `&` `||` `|` 改行で
// 区切ったセグメントごとに、`git`(env 等の前置後や
// 絶対パス・サブシェルの `(` 付きでも可)トークンを探し、その直後のオプション列を
// 読み飛ばして最初の非オプショントークンをサブコマンドとして返す。
// セグメント内に複数の git 起動が残っている場合(区切り文字が全て捕捉しきれない場合)
// に備え、最初の1つだけでなく全ての git トークンを走査する。
function findGitInvocations(cmd: string): GitInvocation[] {
  const invocations: GitInvocation[] = []
  for (const segment of joinContinuedLines(cmd).split(SEGMENT_SPLIT_RE)) {
    const tokens = segment.trim().split(/\s+/).filter(Boolean)
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

function isForceToken(tok: string): boolean {
  return FORCE_TOKENS.includes(tok) || tok.startsWith("--force-with-lease=")
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

// heredoc の開始(`<<WORD`・`<<-WORD`・`<<'WORD'`・`<<"WORD"`)。終端の語は英字か _ で
// 始まり、直後が語の区切りのものだけを受ける(`<<EOF-X` は開始と見なさない)。
const HEREDOC_RE = /^<<(-?)(['"]?)([A-Za-z_]\w*)\2(?=[\s;&|)<>]|$)/

// シェルのコマンド文字列を字句解析し、単純なコマンドごとに、クォートを外した語の列を返す。
// gh の起動を分けるのは、コマンドの区切り(; & | 改行とサブシェルの括弧)とコマンド置換
// ($( … ) とバッククォート)の境界だけである。クォートの中は 1 つの語にまとめ、そこに
// 書かれた gh で外側の起動を分けない。コマンド置換の中のコマンドは別のコマンドとしても
// 返し、置換を含む語には置換の原文を残す(`--body "$(gh …)"` の値を失わないため)。
// `bash -c "gh …"`・`eval "gh …"` のように `-c` と `eval` の直後に置いた語は、中身も
// コマンドの列として読む。
// 行末の `\` による継続は語をつなぐ。閉じていないクォートは残りをすべて 1 つの語とする
// (bash はそのコマンドを実行しない)。
//
// heredoc の本文は、終端の行(<<- のときは先頭のタブを除いた行)が見つかったときだけ
// 読み飛ばす。コミットメッセージの heredoc に書いた gh の使用例を起動と見なさないためである。
// - 終端の語をクォートしない heredoc(<<EOF)では、bash が本文のコマンド置換を実行する
//   ので、本文の $( … ) とバッククォートの中だけをコマンドとして読む。
// - クォートとコメントの中の `<<` と、直前が `<`・英数字・`_`・`)` の `<<`(`<<<` の
//   here-string、`1<<2`・`x<<y` の算術のシフト)は開始と見なさず、後の行も読み飛ばさない
//   (判定に迷う形は検査する側に倒す)。
// 既知の限界は次のとおり。
// - 空白を詰めた `cat<<EOF` も開始と見なさないので、本文の行をコマンドとして読む
//   (誤検知の側に倒れる)。
// - `bash <<EOF` の本文で起動した gh の投稿は見逃す。
// - 算術の中で空白の後に置いた `<<b`(`$(( 1 <<b ))`)は開始と読み違え、`b` の行までを
//   読み飛ばす。
function parseCommands(text: string): string[][] {
  const commands: string[][] = []
  const pending: { word: string; dash: boolean; quoted: boolean }[] = []
  let i = 0

  // text[i] の $( かバッククォートから置換の中をコマンドとして読み、置換の原文を返す。
  const readSubst = (): string => {
    const start = i
    const backquote = text[i] === "`"
    i += backquote ? 1 : 2
    parseList(backquote ? "`" : ")")
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
        out += text.slice(from, end)
        i = end + 1
      } else if (c === '"') out += readDouble()
      else if (c === "`" || text.startsWith("$(", i)) out += readSubst()
      else {
        const m =
          c === "<" && !/[<\w)]/.test(text[i - 1] ?? "")
            ? text.slice(i).match(HEREDOC_RE)
            : null
        if (m)
          pending.push({ word: m[3], dash: m[1] === "-", quoted: m[2] !== "" })
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
    const flush = () => {
      if (words.length > 0) commands.push(words)
      words = []
    }
    while (i < text.length) {
      const c = text[i]
      if (c === close && (close === "`" || depth === 0)) {
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
  }

  parseList()
  for (const words of [...commands])
    words.forEach((w, k) => {
      if (k > 0 && (/^-\w*c$/.test(words[k - 1]) || words[k - 1] === "eval"))
        commands.push(...parseCommands(w))
    })
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

// cmd をコマンドに分け(parseCommands)、gh の起動ごとに「object action」(issue create
// など)を git と同じくトークン解析で取り出す。起動は、コマンドの中の最初の gh の語から
// そのコマンドの終わりまでとする。gh api は action を持たないので、command を "api" と
// する。GH_POST_COMMANDS に無いコマンドは返さず、あるものは短いフラグの結合を分けた
// トークンで返す(expandShortFlags)。
// オプションは GH_VALUE_OPTS の値だけを読み飛ばし、ほかは値の有無を判定しない
// (guard-bash の他のトークン解析と同じ簡略さで足りるため)。
function findGhInvocations(cmd: string): GhInvocation[] {
  const invocations: GhInvocation[] = []
  for (const words of parseCommands(cmd)) {
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

function denyMissingMarker(command: string): never {
  return emit(
    "deny",
    `gh ${command} の本文に \`${GENERATED_MARKER}\` を含めて投稿し直してください`
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
    if (missing) denyMissingMarker(command)
    for (const { flag, path: file } of files) {
      const content = readBodyFile(flag, file, cwd)
      const needsMarker = flag !== "--input" || /"body"\s*:/.test(content)
      if (needsMarker && !content.includes(GENERATED_MARKER))
        denyMissingMarker(command)
    }
  }
}

try {
  const input = await readStdin()
  const cmd = input.tool_input?.command ?? ""
  const gitInvocations = findGitInvocations(cmd)
  const isGitPush = gitInvocations.some((inv) => inv.subcommand === "push")

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
    [hasForcePush(gitInvocations), "force push"],
    [
      pushesToProtectedBranch(gitInvocations),
      "保護ブランチ(main/master)への push"
    ],
    [
      /(>|>>|\btee\b|\bsed\s+-i\b)[^\n]*\.codiel\/runs\/[^\s]*state\.json/.test(
        cmd
      ),
      "state.json へのシェル経由の書き込み"
    ],
    [
      /\b(cp|mv|dd|install)\b[^\n;|&]*\.codiel\/runs\/[^\s]*state\.json/.test(
        cmd
      ),
      "state.json への cp/mv/dd/install 経由の書き込み"
    ]
  ]
  for (const [triggered, why] of ALWAYS_DENY)
    if (triggered) emit("deny", `禁止コマンド: ${why}`)

  const cwd = input.cwd ?? process.cwd()
  const root = findProjectRoot(cwd)
  const run = findActiveRun(root)
  // findActiveRun は active / awaiting_human の run しか返さない。
  // 人間の判断待ち(awaiting_human)中こそ PR 作成や push を許してはならないため、
  // run が存在する限りゲートを適用する(status による分岐はしない)。
  if (run) {
    const phase = run.state.phase
    const testLoopPassed = run.state.phases["test-loop"]?.status === "passed"
    // フェーズの制限も、マーカーの検査と同じ gh の起動の解析(findGhInvocations)で判定する。
    // `gh -R o/r pr create` を捕まえ、コミットメッセージに書いた使用例は起動と見なさない。
    const ghInvocations = findGhInvocations(cmd)
    const invokes = (command: string) =>
      ghInvocations.some((inv) => inv.command === command)
    if (invokes("issue create") && phase !== "triage")
      emit(
        "deny",
        `gh issue create は triage フェーズでのみ実行できます(現在: ${phase})`
      )
    if (invokes("pr create") && (phase !== "pr" || !testLoopPassed))
      emit(
        "deny",
        `PR 作成は pr フェーズかつ test-loop 合格後のみ可能です(現在: ${phase}, test-loop passed: ${testLoopPassed})`
      )
    if (
      isGitPush &&
      (!["pr", "fix-loop", "triage", "finalize"].includes(phase as string) ||
        !testLoopPassed)
    )
      emit(
        "deny",
        `push は test-loop 合格後の pr 以降のフェーズでのみ可能です(現在: ${phase})`
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
