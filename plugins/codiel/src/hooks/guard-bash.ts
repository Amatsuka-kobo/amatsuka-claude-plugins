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
// gh pr create の --web / -w は、テンプレートを入れた Web の作成画面を開き、そこでの
// 投稿は検査できないので、本文のフラグの有無によらず deny する(決定 66)。
// gh issue create --web は gh 自身が TTY の無い環境で拒むので対象にしない。
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

// gh の起動トークンかどうか。git と同じく絶対パス・サブシェルの `(` を許容するほか、
// `bash -c "gh …"`・`$(gh …)`・バッククォートの中の gh も起動と見なす。
function isGhToken(tok: string): boolean {
  const stripped = tok.replace(/^[("'`$]+/, "")
  return stripped === "gh" || stripped.endsWith("/gh")
}

// トークンの前後のクォートを外す(`"b.md"` や `'body=@b.md'` のような値のため)。
function unquote(tok: string): string {
  return tok.replace(/^["']+|["']+$/g, "")
}

// heredoc の本文の行を空行に置き換える。SEGMENT_SPLIT_RE は改行でも分割するため、
// 置き換えないと heredoc の本文に書かれた `gh ...` の行が単独の gh 起動と誤認される
// (`git commit -m "$(cat <<'EOF' ... EOF)"` の本文が典型例)。
// 除き過ぎると後続の行の gh の起動が検査から外れるので、判定に迷う形は除かずに残す。
// - 本文を除くのは、終端の行(<<- のときは先頭のタブを除いた行)が見つかったときだけ。
// - クォート(' $' ")の中とコメントの中の `<<` は開始と見なさない。クォートと
//   `$( … )`・バッククォートの入れ子だけを追う簡易な字句解析で見分ける。
// - 直前が `<`・数字・識別子・`)` の `<<`(`<<<` の here-string、`1<<2` のような
//   算術のシフトなど)は開始と見なさない。終端の語は英字か _ で始まるものだけを受ける。
// - 本文は、`<<` を含む論理行(行末の `\` による継続を含む)の次の行から始まる。
// この結果、`bash <<EOF` の中で実際に gh を起動する投稿は見逃す(既知の限界。
// --body の本文としてコマンド全体からマーカーを探す経路には影響しない)。
function stripHeredocBodies(cmd: string): string {
  const lines = cmd.split("\n")
  // 開いているクォートと入れ子。' $' " は文字列、( と ` はコマンドの文脈。
  const stack: string[] = []
  const pending: { word: string; dash: boolean }[] = []
  let n = 0
  while (n < lines.length) {
    const line = lines[n]
    let continued = false
    for (let i = 0; i < line.length; i++) {
      const top = stack.at(-1)
      const c = line[i]
      if (top === "'") {
        if (c === "'") stack.pop()
      } else if (c === "\\") {
        continued = i === line.length - 1
        i++
      } else if (top === "$'") {
        if (c === "'") stack.pop()
      } else if (top === '"') {
        if (c === '"') stack.pop()
        else if (c === "`") stack.push("`")
        else if (c === "$" && line[i + 1] === "(") {
          stack.push("(")
          i++
        }
      } else if (c === "#" && /^$|[\s;&|(]/.test(line[i - 1] ?? "")) {
        break
      } else if (c === "'" || c === '"') {
        stack.push(c)
      } else if (c === "$" && line[i + 1] === "'") {
        stack.push("$'")
        i++
      } else if (c === "(") {
        stack.push("(")
      } else if (c === ")" && top === "(") {
        stack.pop()
      } else if (c === "`") {
        if (top === "`") stack.pop()
        else stack.push("`")
      } else if (c === "<" && !/[<\w)]/.test(line[i - 1] ?? "")) {
        const m = line.slice(i).match(/^<<(-?)(['"]?)([A-Za-z_]\w*)\2/)
        if (m) {
          pending.push({ word: m[3], dash: m[1] === "-" })
          i += m[0].length - 1
        }
      }
    }
    n++
    if (continued || pending.length === 0) continue
    if (["'", '"', "$'"].includes(stack.at(-1) ?? "")) continue
    // 論理行が終わったので、次の行から heredoc の本文が順に続く。
    for (const { word, dash } of pending.splice(0)) {
      const isEnd = (l: string) => (dash ? l.replace(/^\t+/, "") : l) === word
      let end = n
      while (end < lines.length && !isEnd(lines[end])) end++
      if (end === lines.length) break
      lines.fill("", n, end + 1)
      n = end + 1
    }
  }
  return lines.join("\n")
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

// cmd の heredoc の本文を除き(stripHeredocBodies)、行の継続を 1 行へ戻した
// (joinContinuedLines)うえでセグメントに分け(SEGMENT_SPLIT_RE)、gh の起動ごとに
// 「object action」(issue create など)を git と同じくトークン解析で取り出す。
// 1 つのセグメントに gh の起動が複数あれば(`$(gh …) $(gh …)` など)、それぞれを
// 次の gh の起動の手前までのトークンで扱う。gh api は action を持たないので、
// command を "api" とする。GH_POST_COMMANDS に無いコマンドは返さず、あるものは
// 短いフラグの結合を分けたトークンで返す(expandShortFlags)。
// オプションは GH_VALUE_OPTS の値だけを読み飛ばし、ほかは値の有無を判定しない
// (guard-bash の他のトークン解析と同じ簡略さで足りるため)。
function findGhInvocations(cmd: string): GhInvocation[] {
  const invocations: GhInvocation[] = []
  const text = joinContinuedLines(stripHeredocBodies(cmd))
  for (const segment of text.split(SEGMENT_SPLIT_RE)) {
    const all = segment.trim().split(/\s+/).filter(Boolean)
    const starts = all.flatMap((tok, i) => (isGhToken(tok) ? [i] : []))
    starts.forEach((start, k) => {
      const tokens = all.slice(start, starts[k + 1])
      const skipOptions = (from: number): number => {
        let idx = from
        while (idx < tokens.length && tokens[idx].startsWith("-"))
          idx += GH_VALUE_OPTS.includes(tokens[idx]) ? 2 : 1
        return idx
      }
      const objIdx = skipOptions(1)
      const object = tokens[objIdx]
      const command =
        object === "api"
          ? "api"
          : `${object} ${tokens[skipOptions(objIdx + 1)]}`
      const valueShorts = GH_POST_COMMANDS[command]
      if (valueShorts !== undefined)
        invocations.push({
          command,
          tokens: expandShortFlags(tokens, valueShorts)
        })
    })
  }
  return invocations
}

// tokens[i] が names のいずれかのフラグなら、その値を返す。`--body x`・`--body=x`
// に加え、短いフラグに値を連結した `-bx`・`-Fbody.md` も受ける(gh はこの形を受け付ける)。
// フラグでなければ undefined を返す。
function flagAt(
  tokens: string[],
  i: number,
  names: string[]
): string | undefined {
  const tok = tokens[i]
  for (const n of names) {
    if (tok === n) return tokens[i + 1]
    if (tok.startsWith(`${n}=`)) return tok.slice(n.length + 1)
    if (/^-[^-]$/.test(n) && tok.startsWith(n) && tok.length > 2)
      return tok.slice(2)
  }
  return undefined
}

// tokens の中から names のいずれかのフラグの最初の値を取る。無ければ undefined。
function flagValue(tokens: string[], names: string[]): string | undefined {
  for (let i = 0; i < tokens.length; i++) {
    const value = flagAt(tokens, i, names)
    if (value !== undefined) return value
  }
  return undefined
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
// 本文のフィールドの文字列)、files は中身を読んで検査する本文ファイル。
interface BodyPost {
  command: string
  inline: boolean
  files: { flag: string; path: string }[]
}

// gh の 7 コマンドの投稿を読む。本文のフラグ(--body/-b/--body-file/-F)を持たない
// 呼び出しは投稿と見なさず undefined を返す。ただし、pr create の --web / -w
// (決定 66)と、本文のフラグを持たない --fill 系・--template/-T(決定 64)は deny する。
function readGhPost({ command, tokens }: GhInvocation): BodyPost | undefined {
  if (command === "pr create" && hasFlag(tokens, WEB_FLAGS))
    emit(
      "deny",
      "gh pr create の --web / -w は使えません。Web の作成画面での投稿は本文を検査できないためです。マーカー付きの本文を --body-file で渡して作り直してください"
    )
  const body = flagValue(tokens, ["--body", "-b"])
  const bodyFile = flagValue(tokens, ["--body-file", "-F"])
  if (body === undefined && bodyFile === undefined) {
    const autoFlags = AUTO_BODY_FLAGS[command]
    if (autoFlags && hasFlag(tokens, autoFlags))
      emit(
        "deny",
        `gh ${command} の --fill 系・--template/-T は本文を検査できません。マーカー付きの本文を --body-file で渡して作り直してください`
      )
    return undefined
  }
  return {
    command,
    inline: body !== undefined,
    files:
      bodyFile === undefined
        ? []
        : [{ flag: "--body-file", path: unquote(bodyFile) }]
  }
}

// gh api で送る本文を読む(決定 60。§6.8 の 7 コマンドの外)。
// メソッドは gh と同じく、-X/--method の指定があればそれ、無ければ
// フィールドか --input があるとき POST、どちらも無いとき GET とする。
// POST・PATCH・PUT のときだけ、次を本文として返す。
// - フィールド(-f/--raw-field・-F/--field)のキーが body か `…[body]` のもの。
//   -F の値が `@<パス>` ならそのファイル、それ以外は本文を引数で渡すものとする。
// - --input のファイル(中身に "body" のキーがあるときだけマーカーを求める)。
// 本文を持たない呼び出し(読み取り、ラベルだけの更新など)は undefined を返す。
function readGhApiPost(tokens: string[]): BodyPost | undefined {
  const fields: { typed: boolean; value: string }[] = []
  for (let i = 0; i < tokens.length; i++) {
    const raw = flagAt(tokens, i, ["--raw-field", "-f"])
    if (raw !== undefined) fields.push({ typed: false, value: unquote(raw) })
    const typed = flagAt(tokens, i, ["--field", "-F"])
    if (typed !== undefined) fields.push({ typed: true, value: unquote(typed) })
  }
  const input = flagValue(tokens, ["--input"])
  const explicitMethod = flagValue(tokens, ["--method", "-X"])
  const method =
    explicitMethod !== undefined
      ? unquote(explicitMethod).toUpperCase()
      : fields.length > 0 || input !== undefined
        ? "POST"
        : "GET"
  if (!["POST", "PATCH", "PUT"].includes(method)) return undefined

  const post: BodyPost = { command: "api", inline: false, files: [] }
  for (const { typed, value } of fields) {
    const eq = value.indexOf("=")
    const key = eq === -1 ? value : value.slice(0, eq)
    if (key !== "body" && !key.endsWith("[body]")) continue
    const val = value.slice(eq + 1)
    if (typed && val.startsWith("@"))
      post.files.push({ flag: "-F", path: unquote(val.slice(1)) })
    else post.inline = true
  }
  if (input !== undefined)
    post.files.push({ flag: "--input", path: unquote(input) })
  return post.inline || post.files.length > 0 ? post : undefined
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
// 本文を引数で渡すもの(--body / -b、gh api の本文のフィールド)はコマンド文字列全体
// (セグメントに分けない)で見る。本文はクォートや heredoc で複数行になり、改行を含む
// セグメント分割では本文の内容までは追えないため、マーカーの有無は cmd 全体を対象にする。
// その代わり、1 つのマーカーで別の投稿まで通らないよう、本文付きの投稿が 2 つ以上あって
// いずれかが本文を引数で渡すコマンドは deny する(決定 66)。
// 本文ファイル(--body-file / -F、gh api の -F body=@<パス>・--input)は、同じコマンドで
// 書き換えていないことを確かめてから(denyRewrittenBodyFile)、cwd 基準で解決した
// ファイルの中身を見る。本文を持たない呼び出しは通す。
function checkGeneratedMarker(cmd: string, cwd: string): void {
  const posts: BodyPost[] = []
  for (const inv of findGhInvocations(cmd)) {
    const post =
      inv.command === "api" ? readGhApiPost(inv.tokens) : readGhPost(inv)
    if (post) posts.push(post)
  }
  if (posts.length >= 2 && posts.some((p) => p.inline))
    emit(
      "deny",
      "1 つのコマンドに本文付きの投稿が複数あり、本文を引数で渡すものがあります。マーカーはコマンド全体で探すので、投稿は 1 回の Bash 呼び出しに 1 つにしてください"
    )
  denyRewrittenBodyFile(posts, joinContinuedLines(cmd))
  for (const { command, inline, files } of posts) {
    if (inline && !cmd.includes(GENERATED_MARKER)) denyMissingMarker(command)
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
    // gh の起動は行の継続を 1 行へ戻してから探す(`gh pr \⏎ create` を見逃さない)。
    const oneLine = joinContinuedLines(cmd)
    if (/\bgh\s+issue\s+create\b/.test(oneLine) && phase !== "triage")
      emit(
        "deny",
        `gh issue create は triage フェーズでのみ実行できます(現在: ${phase})`
      )
    if (
      /\bgh\s+pr\s+create\b/.test(oneLine) &&
      (phase !== "pr" || !testLoopPassed)
    )
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
    checkGeneratedMarker(cmd, cwd)
  }
  pass()
} catch (e) {
  emit(
    "ask",
    `guard-bash の内部エラー(フェイルクローズド): ${(e as Error).message}`
  )
}
