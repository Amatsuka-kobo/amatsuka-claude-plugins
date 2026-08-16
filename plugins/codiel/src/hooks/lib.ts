import { spawnSync } from "node:child_process"
import fs from "node:fs"
import path from "node:path"

export interface HookInput {
  session_id?: string
  tool_name?: string
  tool_input?: { command?: string; file_path?: string; [k: string]: unknown }
  transcript_path?: string
  cwd?: string
  agent_id?: string
  agent_type?: string
  stop_hook_active?: boolean
  [k: string]: unknown
}

export async function readStdin(): Promise<HookInput> {
  let data = ""
  for await (const chunk of process.stdin) data += chunk
  return JSON.parse(data) as HookInput
}

export function emit(decision: "deny" | "ask", reason: string): never {
  process.stdout.write(
    `${JSON.stringify({
      hookSpecificOutput: {
        hookEventName: "PreToolUse",
        permissionDecision: decision,
        permissionDecisionReason: reason
      }
    })}\n`
  )
  process.exit(0)
}

// 「意見なし」の素通し。permissionDecision: "allow" は許可システムをバイパスして
// 自動実行になってしまうため、素通しでは何も出力せずに終了する。
export function pass(): never {
  process.exit(0)
}

export function globToRegExp(glob: string): RegExp {
  let re = ""
  for (let i = 0; i < glob.length; i++) {
    const c = glob[i]
    if (c === "*") {
      if (glob[i + 1] === "*") {
        re += ".*"
        i++
        if (glob[i + 1] === "/") i++
      } else re += "[^/]*"
    } else if (c === "?") re += "[^/]"
    else re += c.replace(/[.+^${}()|[\]\\]/g, "\\$&")
  }
  return new RegExp(`^${re}$`)
}

// ---------------------------------------------------------------------------
// 文書パスの解決(ファイル契約 §2・§3 の独立実装)
//
// 規則の正本は `harness-docs/design/2026-08-16-file-contract-freeze.md` の
// §2(設定スキーマ)と §3(ルート解決とパス解決の規則)。metatron と sandalphon が
// 同じ規則の写しを独立に持つ。3 プラグインは互いのインストールパスを解決できないため、
// ソースを共有せず同じ規則を独立に実装する。ここを変えたら契約 §13 の実装間一致テストを通す。
//
// codiel は基準の異なる 2 つのルート概念を持つ。関数名で区別し、混同しない。
// 文書(ARCHITECTURE / GOTCHAS)の解決には findDocRoot を、codiel 固有資産
// (`.codiel/runs` 等)の解決には findProjectRoot を使う。どちらを使うかは
// 「探しているものが文書か codiel 資産か」で決まる。同じ「ルート」という語で
// 2 つの異なる基準を指していたことが、パス解決の不整合の温床であった。
// ---------------------------------------------------------------------------

export const DOC_CONFIG_FILENAME = "metatron.config.json"
export const DOC_CONFIG_SUPPORTED_VERSION = 1
export const DEFAULT_ARCHITECTURE_PATH = "docs/ARCHITECTURE.md"
export const DEFAULT_GOTCHAS_PATH = "docs/GOTCHAS.md"

export interface DocPaths {
  /** 契約 §3 規則 1 で解決したルート(絶対パス)。 */
  docRoot: string
  /** ARCHITECTURE の絶対パス。 */
  architecture: string
  /** GOTCHAS の絶対パス。 */
  gotchas: string
  /**
   * 既定値へ落とした理由・設定を読めなかった理由(契約 §2・§3 規則 3)。
   * 空配列が正常。「設定ファイルが無い」は正常な状態なので警告にしない。
   * metatron は ResolvedConfig.warnings、sandalphon は出力 JSON の configWarnings で
   * 同じ理由を返す。3 実装で「警告が出るか出ないか」と件数を揃える。
   */
  warnings: string[]
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value)
}

// 実体パスへ解決する。解決できない場合(存在しない・権限が無い)は与えられた値をそのまま返す。
function realpathOrSelf(dir: string): string {
  try {
    return fs.realpathSync(dir)
  } catch {
    return dir
  }
}

function existsSafe(target: string): boolean {
  try {
    return fs.existsSync(target)
  } catch {
    return false
  }
}

// 契約 §3 規則 1 の段 2。必ず `git rev-parse --show-toplevel` を実行して得る。
// `.git` の手作業探索で代替しない(worktree の .git ファイル形式や
// GIT_CEILING_DIRECTORIES の挙動を再現できず、実装間で結果が割れるため)。
// git 未インストール(ENOENT)・git 管理外(exit 128)・タイムアウト・その他の非 0 終了は、
// 原因を区別せず「無かった」として扱い、例外を外へ投げない。
function gitToplevel(cwd: string): string | null {
  try {
    const res = spawnSync("git", ["rev-parse", "--show-toplevel"], {
      cwd,
      encoding: "utf8",
      timeout: 5000,
      windowsHide: true
    })
    if (res.status !== 0) return null
    const out = res.stdout?.trim()
    if (!out) return null
    return path.resolve(out)
  } catch {
    return null
  }
}

/**
 * 契約 §3 規則 1: 文書のルート解決。
 *
 * 1. `metatron.config.json` を持つ最も近い祖先ディレクトリ(開始ディレクトリ自身を含む)
 * 2. 無ければ `git rev-parse --show-toplevel`
 * 3. それも無ければ開始ディレクトリ
 *
 * 探索の前に開始ディレクトリを `fs.realpathSync` で実体パスへ解決する。段 2 が実体パスを
 * 返すため、段 1 を文字列操作だけで辿るとシンボリックリンク越しの起動で両者が別の
 * ディレクトリ木を辿り、実装間で docRoot が食い違う。
 *
 * codiel 固有資産のルートを探すときは findProjectRoot を使う(基準が異なる)。
 */
export function findDocRoot(startDir?: string): string {
  const start = realpathOrSelf(path.resolve(startDir ?? process.cwd()))

  // 段 1: 開始ディレクトリ自身を候補に含める(inclusive)。
  let dir = start
  while (true) {
    if (existsSafe(path.join(dir, DOC_CONFIG_FILENAME))) return dir
    const parent = path.dirname(dir)
    // ファイルシステムのルートに達したら打ち切る。
    if (parent === dir) break
    dir = parent
  }

  // 段 2
  const top = gitToplevel(start)
  if (top) return top

  // 段 3
  return start
}

// Windows で書かれた設定を POSIX 上でも同じに解釈するため、区切りを "/" に寄せてから判定する。
function normalizeSeparators(value: string): string {
  return value.replace(/\\/g, "/")
}

// プラットフォームに依らず絶対パスとみなす形:
// POSIX の先頭 "/"、Windows のドライブレター、UNC。
function looksAbsolute(value: string): boolean {
  return (
    path.isAbsolute(value) ||
    /^[A-Za-z]:\//.test(value) ||
    value.startsWith("//")
  )
}

// 契約 §3 規則 2・規則 3。
// 絶対パスとルート外への脱出は拒否し、その項目だけ既定値に落とす。
// 拒否したときは**理由を呼び出し元へ返す**(warnings へ積む)。黙って既定値に落とさない。
function resolveConfiguredPath(
  docRoot: string,
  raw: unknown,
  fallback: string,
  label: string,
  warnings: string[]
): string {
  const useFallback = (): string => path.resolve(docRoot, fallback)

  // 未設定は正常な状態なので警告にしない。
  if (raw === undefined) return useFallback()

  if (typeof raw !== "string" || raw.trim() === "") {
    warnings.push(
      `paths.${label} が空でない文字列でないため、既定値 ${fallback} を使用します。`
    )
    return useFallback()
  }

  const value = normalizeSeparators(raw)
  if (looksAbsolute(value)) {
    warnings.push(
      `paths.${label} が絶対パス(${raw})のため、既定値 ${fallback} を使用します。`
    )
    return useFallback()
  }

  const absolute = path.resolve(docRoot, value)
  const relative = path.relative(docRoot, absolute)
  const escapes =
    relative === "" ||
    relative === ".." ||
    relative.startsWith(`..${path.sep}`) ||
    path.isAbsolute(relative)
  if (escapes) {
    warnings.push(
      `paths.${label} がルート外(${raw})を指すため、既定値 ${fallback} を使用します。`
    )
    return useFallback()
  }

  return absolute
}

function fallbackDocRoot(startDir?: string): string {
  try {
    return path.resolve(startDir ?? process.cwd())
  } catch {
    return startDir ?? "."
  }
}

/**
 * 契約 §2・§3: 文書パスの解決。
 *
 * 内部で findDocRoot を呼び、`metatron.config.json` の `paths` を解釈して
 * ARCHITECTURE / GOTCHAS の絶対パスを返す。設定が無ければ既定値。
 * 解決結果はキャッシュしない(契約 §3 規則 4)。
 * 例外を投げない。読めない設定・壊れた設定はすべて既定値へ落とす。
 * 既定値へ落としたときは**理由を warnings で返す**(契約 §3 規則 3)。
 * 「設定ファイルが無い」は正常な状態なので警告にしない。
 */
export function resolveDocPaths(startDir?: string): DocPaths {
  const warnings: string[] = []

  let docRoot: string
  try {
    docRoot = findDocRoot(startDir)
  } catch {
    docRoot = fallbackDocRoot(startDir)
  }

  const configPath = path.join(docRoot, DOC_CONFIG_FILENAME)
  let parsed: unknown
  let parseOk = false
  try {
    if (existsSafe(configPath)) {
      parsed = JSON.parse(fs.readFileSync(configPath, "utf8"))
      parseOk = true
    }
  } catch {
    // 「設定ファイルが無い」は警告にしないが、「あるのに読めなかった」は 1 行添える。
    warnings.push("設定を読めなかったため既定値を使用します。")
  }

  // 契約 §2: 構文エラーだけでなく、トップレベルがオブジェクトでない場合
  // (配列・null・数値・文字列)も「壊れた JSON」として全項目を既定値にする。
  let source: Record<string, unknown> | undefined
  if (parseOk) {
    if (isPlainObject(parsed)) {
      source = parsed
    } else {
      warnings.push(
        "設定のトップレベルがオブジェクトでないため既定値を使用します。"
      )
    }
  }

  // 契約 §2: version が未知の値なら全項目を既定値として扱い、警告を 1 行添える。
  if (source !== undefined) {
    const version = source.version
    if (version !== undefined && version !== DOC_CONFIG_SUPPORTED_VERSION) {
      warnings.push(
        `設定の version(${JSON.stringify(version)})が未知のため、全項目に既定値を使用します。`
      )
      source = undefined
    }
  }

  // 未知キー($schema を含む)は無視する。エラーにしない(契約 §2)。
  const pathsRaw = source?.paths
  const paths = isPlainObject(pathsRaw) ? pathsRaw : undefined
  if (pathsRaw !== undefined && paths === undefined) {
    warnings.push(
      "paths がオブジェクトでないため、文書パスに既定値を使用します。"
    )
  }

  return {
    docRoot,
    architecture: resolveConfiguredPath(
      docRoot,
      paths?.architecture,
      DEFAULT_ARCHITECTURE_PATH,
      "architecture",
      warnings
    ),
    gotchas: resolveConfiguredPath(
      docRoot,
      paths?.gotchas,
      DEFAULT_GOTCHAS_PATH,
      "gotchas",
      warnings
    ),
    warnings
  }
}

// ---------------------------------------------------------------------------
// ドメインマップの抽出(契約 §1・§4-2 の独立実装)
//
// 終了フェンスの判定は契約 §4-2 の規則 2 と同一とし、開始行・終了行の認識も
// §4-2 の正規化(インデント許容・改行コード・末尾空白の扱い)に従う。
// **独自のフェンス判定を書かない**(契約 §1)。metatron の `src/lib/architecture.ts` と
// sandalphon の `src/check-intent-env.ts` が同じ規則の写しを独立に持つ。
// ここを変えたら契約 §13 の 3 者比較テストを通す。
//
// 正規表現でブロックを切り出す実装に戻してはならない。CRLF 改行の文書を読めず
// (開始行が `\r` で終わるため一致しない)、チルダのフェンスにも対応できず、
// 「開始と同じ文字を開始と同数以上」という終了条件も表現できない。
// ---------------------------------------------------------------------------

export const DOMAINS_MARKER = "metatron:domains"

// 契約 §4-2: 行頭は半角スペース 0〜3 個のインデントを許容する(CommonMark 準拠)。
// 4 個以上のインデントはフェンスとみなさない。タブは行頭のインデントとして扱わない。
const FENCE_OPEN_RE = /^ {0,3}(`{3,}|~{3,})(.*)$/
// 契約 §4-2 規則 2: 連続の後に半角スペース・タブのみが続く場合は info string を
// 持たないものとして扱い、終了フェンスと判定する(末尾空白で閉じ損ねない)。
const FENCE_CLOSE_RE = /^ {0,3}(`+|~+)[ \t]*$/

// info string が `json metatron:domains` の 2 トークンであるかを判定する。
// 旧マーカー `codiel:domains` は読まない(互換読みを設けない。契約 §1)。
function isDomainsInfo(info: string): boolean {
  const tokens = info
    .trim()
    .split(/[ \t]+/)
    .filter(Boolean)
  return (
    tokens.length === 2 && tokens[0] === "json" && tokens[1] === DOMAINS_MARKER
  )
}

// 契約 §4-2 の状態機械でドメインマップブロックの中身を取り出す。
// 同一ファイル内にブロックが 2 個以上あるときは最初のものを採る(契約 §1)。
// 読み取り経路なので警告は出さず、例外も投げない。
function findDomainsContent(text: string): string | null {
  // 契約 §4-2: 判定の前に各行の末尾の `\r` を除去する(CRLF 改行の文書で
  // フェンス判定が実装ごとに割れるのを防ぐ)。
  const lines = text.split("\n").map((line) => line.replace(/\r$/, ""))
  let fence: { char: string; count: number } | null = null
  let isTarget = false
  let openIndex = -1

  for (let i = 0; i < lines.length; i++) {
    const t = lines[i]
    if (fence) {
      const m = FENCE_CLOSE_RE.exec(t)
      // 開始と同じ文字を開始と同数以上連続させた行だけが終了フェンス。
      if (m && m[1][0] === fence.char && m[1].length >= fence.count) {
        if (isTarget) return lines.slice(openIndex + 1, i).join("\n")
        fence = null
        isTarget = false
      }
      continue
    }
    const open = FENCE_OPEN_RE.exec(t)
    if (open) {
      fence = { char: open[1][0], count: open[1].length }
      isTarget = isDomainsInfo(open[2])
      openIndex = i
    }
  }

  // 未閉フェンスでも読み取り経路は続行する(契約 §4-3。終端までを内容として扱う)。
  if (fence && isTarget) return lines.slice(openIndex + 1).join("\n")
  return null
}

// ARCHITECTURE のドメインマップを読む。
// 引数は**文書ルートではなく開始ディレクトリ**である。ルートの決定を関数の内側に
// 閉じることで、呼び出し側が基準(文書ルートか codiel 資産ルートか)を間違えようがなくなる。
export function readDomains(startDir: string): unknown {
  try {
    const { architecture } = resolveDocPaths(startDir)
    if (!fs.existsSync(architecture)) return null
    const content = findDomainsContent(fs.readFileSync(architecture, "utf8"))
    if (content === null) return null
    return JSON.parse(content)
  } catch {
    return null
  }
}

// startDir から上方向に `.codiel` ディレクトリを持つ祖先を探す。
// 見つかればそのディレクトリを、見つからなければ startDir をそのまま返す(フォールバック)。
// cwd がプロジェクトルートのサブディレクトリの場合でも、run 探索やフェーズ制御を
// プロジェクトルート基準で行えるようにするためのもの。
// 探しているものが**文書**(ARCHITECTURE / GOTCHAS)であれば、基準が異なるため findDocRoot を使う。
export function findProjectRoot(startDir: string): string {
  let dir = startDir
  while (true) {
    if (fs.existsSync(path.join(dir, ".codiel"))) return dir
    const parent = path.dirname(dir)
    if (parent === dir) return startDir
    dir = parent
  }
}
