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

// cmd を `;` `&&` `&` `||` `|` 改行で区切ったセグメントごとに、`git`(env 等の前置後や
// 絶対パス・サブシェルの `(` 付きでも可)トークンを探し、その直後のオプション列を
// 読み飛ばして最初の非オプショントークンをサブコマンドとして返す。
// セグメント内に複数の git 起動が残っている場合(区切り文字が全て捕捉しきれない場合)
// に備え、最初の1つだけでなく全ての git トークンを走査する。
function findGitInvocations(cmd: string): GitInvocation[] {
  const invocations: GitInvocation[] = []
  for (const segment of cmd.split(SEGMENT_SPLIT_RE)) {
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

// マーカーの検査対象になる gh のコマンド。「object action」の形で持つ。
// gh api は別の規則(checkGhApiBody)で検査する。
const MARKED_GH_COMMANDS = new Set([
  "issue create",
  "issue comment",
  "issue edit",
  "pr create",
  "pr comment",
  "pr edit",
  "pr review"
])

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

// cmd をセグメントに分け(SEGMENT_SPLIT_RE)、各セグメントの gh 起動から
// 「object action」(issue create など)を git と同じくトークン解析で取り出す。
// gh api は action を持たないので、command を "api" とする。
// オプションは GH_VALUE_OPTS の値だけを読み飛ばし、ほかは値の有無を判定しない
// (guard-bash の他のトークン解析と同じ簡略さで足りるため)。
function findGhInvocations(cmd: string): GhInvocation[] {
  const invocations: GhInvocation[] = []
  for (const segment of cmd.split(SEGMENT_SPLIT_RE)) {
    const tokens = segment.trim().split(/\s+/).filter(Boolean)
    const ghIdx = tokens.findIndex((tok) => isGhToken(tok))
    if (ghIdx === -1) continue
    const skipOptions = (from: number): number => {
      let idx = from
      while (idx < tokens.length && tokens[idx].startsWith("-"))
        idx += GH_VALUE_OPTS.includes(tokens[idx]) ? 2 : 1
      return idx
    }
    const objIdx = skipOptions(ghIdx + 1)
    const object = tokens[objIdx]
    if (object === "api") {
      invocations.push({ tokens, command: "api" })
      continue
    }
    const action = tokens[skipOptions(objIdx + 1)]
    if (object !== undefined && action !== undefined)
      invocations.push({ tokens, command: `${object} ${action}` })
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

// gh api で送る本文を検査する(決定 53。§6.8 の 7 コマンドの外)。
// メソッドは gh と同じく、-X/--method の指定があればそれ、無ければ
// フィールドか --input があるとき POST、どちらも無いとき GET とする。
// POST・PATCH・PUT のときだけ、次の本文を検査する。
// - フィールド(-f/--raw-field・-F/--field)のキーが body か `…[body]` のもの。
//   -F の値が `@<パス>` ならファイルの中身、`@-` なら deny、それ以外は
//   --body と同じくコマンドの文字列全体でマーカーを探す。
// - --input のファイル。`-` は deny し、中身に "body" のキーがあるときだけマーカーを求める。
// 本文を持たない呼び出し(読み取り、ラベルだけの更新など)は通す。
function checkGhApiBody(tokens: string[], cmd: string, cwd: string): void {
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
  if (!["POST", "PATCH", "PUT"].includes(method)) return

  for (const { typed, value } of fields) {
    const eq = value.indexOf("=")
    const key = eq === -1 ? value : value.slice(0, eq)
    if (key !== "body" && !key.endsWith("[body]")) continue
    const val = value.slice(eq + 1)
    if (typed && val.startsWith("@")) {
      const content = readBodyFile("-F", unquote(val.slice(1)), cwd)
      if (!content.includes(GENERATED_MARKER)) denyMissingMarker("api")
    } else if (!cmd.includes(GENERATED_MARKER)) denyMissingMarker("api")
  }
  if (input !== undefined) {
    const content = readBodyFile("--input", unquote(input), cwd)
    if (/"body"\s*:/.test(content) && !content.includes(GENERATED_MARKER))
      denyMissingMarker("api")
  }
}

// 投稿する本文にマーカーがあるかを検査し、無ければ deny する。
// --body / -b はコマンド文字列全体(セグメントに分けない)で見る。本文は
// クォートや heredoc で複数行になり、改行を含むセグメント分割では本文の
// 内容までは追えないため、マーカーの有無は cmd 全体を対象にする。
// --body-file / -F は cwd 基準で解決したファイルの中身を見る。
// 本文を持たない呼び出し(--body・-b・--body-file・-F のどれも無い)は通す。
function checkGeneratedMarker(cmd: string, cwd: string): void {
  for (const inv of findGhInvocations(cmd)) {
    if (inv.command === "api") {
      checkGhApiBody(inv.tokens, cmd, cwd)
      continue
    }
    if (!MARKED_GH_COMMANDS.has(inv.command)) continue
    const bodyVal = flagValue(inv.tokens, ["--body", "-b"])
    const bodyFileVal = flagValue(inv.tokens, ["--body-file", "-F"])
    if (bodyVal === undefined && bodyFileVal === undefined) continue
    if (bodyVal !== undefined && !cmd.includes(GENERATED_MARKER))
      denyMissingMarker(inv.command)
    if (bodyFileVal !== undefined) {
      const content = readBodyFile("--body-file", unquote(bodyFileVal), cwd)
      if (!content.includes(GENERATED_MARKER)) denyMissingMarker(inv.command)
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
    if (/\bgh\s+issue\s+create\b/.test(cmd) && phase !== "triage")
      emit(
        "deny",
        `gh issue create は triage フェーズでのみ実行できます(現在: ${phase})`
      )
    if (/\bgh\s+pr\s+create\b/.test(cmd) && (phase !== "pr" || !testLoopPassed))
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
