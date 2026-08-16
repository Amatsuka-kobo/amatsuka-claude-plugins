#!/usr/bin/env node
// intent の聞き取りから issue 起票・自前実行までに必要な環境の事実を JSON で stdout に出力する。
// 判断(STOP するか、どの経路を畳むか等)はスキル側が行い、このスクリプトは常に exit 0。
//
// このスクリプトは**読み取り専用**である。ファイル・ディレクトリの作成も更新も行わない。
// `docs/intents/` の作成も intent 文書の `status` 更新もスキルの責務であり、ここではやらない
// (検出のたびにファイルが変わる副作用を持たせないため。設計書 §5-3・§7-1)。
//
// 使い方: node check-intent-env.mjs [projectDir]
//
// ルート解決(docRoot)とパス解決はファイル契約
// `harness-docs/design/2026-08-16-file-contract-freeze.md` §3 の**独立実装**である。
// 正本は plugins/metatron/src/lib/config.ts。プラグインは独立して配布され互いの
// インストールパスを解決できないため、ソースは共有せず同じ規則を実装する。
// 契約を変えたら metatron / codiel / sandalphon の 3 実装を追随させる(契約 §14)。
//
// 基準は 3 つあり、どれか 1 つに寄せない(契約 §3「codiel における 2 つのルート概念」)。
//   - intent 文書(docs/intents/)  : repoRoot(git ルート)
//   - ARCHITECTURE / GOTCHAS       : docRoot(契約 §3 規則 1)
//   - .codiel の有無と runDirs     : codielRoot(開始ディレクトリからの上方向探索)
// 3 者が別ディレクトリを指すのは正常な状態であり、フィールド名で区別する。
import { spawnSync } from "node:child_process"
import fs from "node:fs"
import path from "node:path"

/** 契約 §2。共有設定ファイルの名前。 */
const CONFIG_FILENAME = "metatron.config.json"
const SUPPORTED_CONFIG_VERSION = 1
/** 契約 §7。文書パスの既定値。 */
const DEFAULT_ARCHITECTURE_PATH = "docs/ARCHITECTURE.md"
const DEFAULT_GOTCHAS_PATH = "docs/GOTCHAS.md"
/** 契約 §1。旧マーカー `codiel:domains` は読まない。 */
const DOMAINS_MARKER = "metatron:domains"
/** 設計書 §7-4 の判定ルール 3。テストファイルの走査はこの件数で打ち切る。 */
const TEST_FILE_SCAN_LIMIT = 200
const GIT_TIMEOUT_MS = 5000

// ---------------------------------------------------------------------------
// ファイルシステムの安全なラッパ(失敗は既定値へ落とし、例外を外へ出さない)
// ---------------------------------------------------------------------------

function existsSafe(target: string): boolean {
  try {
    return fs.existsSync(target)
  } catch {
    return false
  }
}

function isFile(target: string): boolean {
  try {
    return fs.statSync(target).isFile()
  } catch {
    return false
  }
}

function isDir(target: string): boolean {
  try {
    return fs.statSync(target).isDirectory()
  } catch {
    return false
  }
}

function readFileSafe(target: string): string | null {
  try {
    return fs.readFileSync(target, "utf8")
  } catch {
    return null
  }
}

function readdirSafe(target: string): string[] {
  try {
    return fs.readdirSync(target).sort()
  } catch {
    return []
  }
}

function readdirEntriesSafe(target: string): fs.Dirent[] {
  try {
    return fs
      .readdirSync(target, { withFileTypes: true })
      .sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0))
  } catch {
    return []
  }
}

// 実体パスへ解決する。解決できない場合(存在しない・権限が無い)は与えられた値をそのまま返す。
function realpathOrSelf(dir: string): string {
  try {
    return fs.realpathSync(dir)
  } catch {
    return dir
  }
}

function cwdSafe(): string {
  try {
    return process.cwd()
  } catch {
    return "."
  }
}

function resolveSafe(value: string): string {
  try {
    return path.resolve(value)
  } catch {
    return value
  }
}

// ---------------------------------------------------------------------------
// 開始ディレクトリと git
// ---------------------------------------------------------------------------

// 契約 §3 規則 1 の細目: 探索を始める前に開始ディレクトリを実体パスへ解決する。
// 段 2 の `git rev-parse --show-toplevel` が実体パスを返すため、段 1 を文字列操作だけで
// 辿るとシンボリックリンク越しの起動で両者が別のディレクトリ木を辿る。
const startDir = realpathOrSelf(resolveSafe(process.argv[2] ?? cwdSafe()))

// git 未インストール(ENOENT で status が null)・git 管理外(exit 128)・タイムアウト・
// その他の非 0 終了は、原因を区別せず「無かった」として扱う(契約 §3 規則 1 の細目)。
function git(...args: string[]): string | null {
  try {
    const res = spawnSync("git", args, {
      cwd: startDir,
      encoding: "utf8",
      timeout: GIT_TIMEOUT_MS,
      windowsHide: true
    })
    if (res.status !== 0) return null
    const out = res.stdout?.trim()
    return out ? out : null
  } catch {
    return null
  }
}

const isGitRepo = git("rev-parse", "--is-inside-work-tree") === "true"
// 契約 §3 規則 1 の段 2 でも同じ値を使う(`.git` の手作業探索で代替しない)。
const gitToplevelRaw = git("rev-parse", "--show-toplevel")
const gitToplevel = gitToplevelRaw ? resolveSafe(gitToplevelRaw) : null
const repoRoot = isGitRepo ? gitToplevel : null
const remoteUrl = isGitRepo ? git("remote", "get-url", "origin") : null

// SSH (git@github.com:owner/repo.git) と HTTPS (https://github.com/owner/repo) の両形式に対応。
// ホスト名は github.com 完全一致(notgithub.com 等の部分一致を弾く)。
// gh-utility の check-issue-env.ts と同一の正規表現(挙動をリポジトリ内で揃える)。
const repoSlug =
  remoteUrl?.match(
    /^(?:git@|ssh:\/\/git@|https?:\/\/)github\.com[/:]([^/]+\/[^/]+?)(?:\.git)?\/?$/
  )?.[1] ?? null

// gh 未インストール時、spawnSync は ENOENT で status: null を返す(例外は投げない)
function ghExitZero(args: string[]): boolean {
  try {
    return spawnSync("gh", args, { encoding: "utf8" }).status === 0
  } catch {
    return false
  }
}

const ghInstalled = ghExitZero(["--version"])
const ghAuthenticated = ghInstalled && ghExitZero(["auth", "status"])

// ---------------------------------------------------------------------------
// Issue テンプレート(gh-utility の check-issue-env.ts と同一の実装パターン)
// ---------------------------------------------------------------------------

const unquote = (v: string): string => v.replace(/^(["'])(.*)\1$/, "$2")

// YAML パーサは使わず、トップレベル(行頭・インデント無し)のキーのみ簡易抽出する。
// labels は inline 配列・カンマ区切り・直後の「- item」複数行リストの3形式に対応
function parseTopLevel(src: string): Record<string, string> {
  const top: Record<string, string> = {}
  const lines = src.split("\n")
  for (let i = 0; i < lines.length; i++) {
    const m = lines[i].match(/^([A-Za-z_][\w-]*):\s*(.*)$/)
    if (!m) continue
    let value = m[2].trim()
    if (!value) {
      const items: string[] = []
      while (i + 1 < lines.length && /^\s+-\s+/.test(lines[i + 1])) {
        items.push(lines[++i].replace(/^\s+-\s+/, "").trim())
      }
      value = items.join(",")
    }
    top[m[1]] = value
  }
  return top
}

function parseTemplate(file: string, content: string) {
  let src = content
  if (file.endsWith(".md")) {
    src = content.match(/^---\n([\s\S]*?)\n---/)?.[1] ?? ""
  }
  const top = parseTopLevel(src)
  const labelsRaw = top.labels?.match(/^\[(.*)\]$/)?.[1] ?? top.labels ?? ""
  return {
    file,
    name: unquote(top.name ?? ""),
    about: unquote(top.description ?? top.about ?? ""),
    title: unquote(top.title ?? ""),
    labels: labelsRaw
      .split(",")
      .map((s) => unquote(s.trim()))
      .filter(Boolean)
  }
}

let templates: ReturnType<typeof parseTemplate>[] = []
let blankIssuesEnabled = true
// テンプレートはリポジトリルート直下の .github/ISSUE_TEMPLATE/ から検出する
const tplDir = repoRoot
  ? path.join(repoRoot, ".github", "ISSUE_TEMPLATE")
  : null
if (tplDir) {
  // ISSUE_TEMPLATE がディレクトリでない・読めない場合はテンプレート無し扱い(exit 0 を保つ)
  const files = readdirSafe(tplDir)
  const read = (f: string): string | null => readFileSafe(path.join(tplDir, f))
  templates = files
    .filter((f) => /\.(md|ya?ml)$/.test(f) && f !== "config.yml")
    .map((f) => ({ f, content: read(f) }))
    .filter(
      (entry): entry is { f: string; content: string } => entry.content !== null
    )
    .map(({ f, content }) => parseTemplate(f, content))
  const configRaw = files.includes("config.yml") ? read("config.yml") : null
  if (configRaw !== null) {
    const config = parseTopLevel(configRaw)
    if (config.blank_issues_enabled !== undefined) {
      blankIssuesEnabled = config.blank_issues_enabled !== "false"
    }
  }
}

// ---------------------------------------------------------------------------
// docRoot と文書パスの解決(契約 §2・§3 の独立実装)
// ---------------------------------------------------------------------------

/**
 * 契約 §3 規則 1: ルート解決。
 *
 * 1. `metatron.config.json` を持つ最も近い祖先ディレクトリ(開始ディレクトリ自身を含む)
 * 2. 無ければ `git rev-parse --show-toplevel`
 * 3. それも無ければ開始ディレクトリ
 */
function findDocRoot(): string {
  let dir = startDir
  while (true) {
    if (existsSafe(path.join(dir, CONFIG_FILENAME))) return dir
    const parent = path.dirname(dir)
    // ファイルシステムのルートに達したら打ち切る。
    if (parent === dir) break
    dir = parent
  }
  if (gitToplevel) return gitToplevel
  return startDir
}

const docRoot = findDocRoot()
const configWarnings: string[] = []

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value)
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
// 絶対パスとルート外への脱出は拒否し、その項目だけ既定値に落として理由を積む。
function resolveConfiguredPath(
  raw: unknown,
  fallback: string,
  label: string
): string {
  const useFallback = (): string => path.resolve(docRoot, fallback)

  if (raw === undefined) return useFallback()

  if (typeof raw !== "string" || raw.trim() === "") {
    configWarnings.push(
      `paths.${label} が空でない文字列でないため、既定値 ${fallback} を使用します。`
    )
    return useFallback()
  }

  const value = normalizeSeparators(raw)
  if (looksAbsolute(value)) {
    configWarnings.push(
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
    configWarnings.push(
      `paths.${label} がルート外(${raw})を指すため、既定値 ${fallback} を使用します。`
    )
    return useFallback()
  }

  return absolute
}

function loadConfigPaths(): { architecture: string; gotchas: string } {
  const configPath = path.join(docRoot, CONFIG_FILENAME)
  let source: Record<string, unknown> | undefined

  // 「設定ファイルが無い」はエラーではなく、報告もしない(契約 §2)。
  if (existsSafe(configPath)) {
    const raw = readFileSafe(configPath)
    if (raw === null) {
      configWarnings.push("設定を読めなかったため既定値を使用します。")
    } else {
      let parsed: unknown
      let parseOk = false
      try {
        parsed = JSON.parse(raw)
        parseOk = true
      } catch {
        configWarnings.push("設定の JSON が壊れているため既定値を使用します。")
      }
      // 契約 §2: 構文エラーだけでなく、トップレベルがオブジェクトでない場合
      // (配列・null・数値・文字列)も「壊れた JSON」に含める。
      if (parseOk) {
        if (isPlainObject(parsed)) {
          source = parsed
        } else {
          configWarnings.push(
            "設定のトップレベルがオブジェクトでないため既定値を使用します。"
          )
        }
      }
    }
  }

  // 契約 §2: version が未知の値なら全項目を既定値扱いにし、警告を 1 行添える。
  if (source !== undefined) {
    const version = source.version
    if (version !== undefined && version !== SUPPORTED_CONFIG_VERSION) {
      configWarnings.push(
        `設定の version(${JSON.stringify(version)})が未知のため、全項目に既定値を使用します。`
      )
      source = undefined
    }
  }

  const pathsRaw = source?.paths
  const paths = isPlainObject(pathsRaw) ? pathsRaw : undefined
  if (pathsRaw !== undefined && paths === undefined) {
    configWarnings.push(
      "paths がオブジェクトでないため、文書パスに既定値を使用します。"
    )
  }

  return {
    architecture: resolveConfiguredPath(
      paths?.architecture,
      DEFAULT_ARCHITECTURE_PATH,
      "architecture"
    ),
    gotchas: resolveConfiguredPath(
      paths?.gotchas,
      DEFAULT_GOTCHAS_PATH,
      "gotchas"
    )
  }
}

const resolvedDocPaths = loadConfigPaths()
const architecturePath = isFile(resolvedDocPaths.architecture)
  ? resolvedDocPaths.architecture
  : null
const gotchasPath = isFile(resolvedDocPaths.gotchas)
  ? resolvedDocPaths.gotchas
  : null

// ---------------------------------------------------------------------------
// ドメインマップ(契約 §1。フェンス判定は契約 §4-2 の状態機械と同一の規則)
// ---------------------------------------------------------------------------

// 契約 §4-2 規則 1。行頭は 0〜3 個の半角スペースのインデントを許容する。
const FENCE_OPEN_RE = /^ {0,3}(`{3,}|~{3,})(.*)$/
// 契約 §4-2 規則 2。開始と同じ文字を同数以上連続させ、その後に info string を持たない行。
const FENCE_CLOSE_RE = /^ {0,3}(`+|~+)[ \t]*$/

// 開始行は ```json metatron:domains に固定する(契約 §1)。
// info string の空白の量は許容するが、トークンの構成は固定する。
// 旧マーカー `codiel:domains` は一致しない(互換読みを設けない)。
function isDomainsInfo(info: string): boolean {
  const tokens = info
    .trim()
    .split(/[ \t]+/)
    .filter(Boolean)
  return (
    tokens.length === 2 && tokens[0] === "json" && tokens[1] === DOMAINS_MARKER
  )
}

// 同一ファイル内にブロックが 2 個以上あるときは最初のものを採る(契約 §1)。
// 読み取り経路なので警告を出さずに続行する。
function findDomainsContent(text: string): string | null {
  const lines = text.split("\n").map((line) => line.replace(/\r$/, ""))
  let fence: { char: string; count: number } | null = null
  let isTarget = false
  let openIndex = -1

  for (let i = 0; i < lines.length; i++) {
    const t = lines[i]
    if (fence) {
      const m = FENCE_CLOSE_RE.exec(t)
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

  // 未閉フェンスでも読み取り経路は続行する(ファイル終端までを内容として扱う)。
  if (fence && isTarget) return lines.slice(openIndex + 1).join("\n")
  return null
}

// 契約 §1 の検証 4 項目。読めない場合は例外を投げず「読めない」として扱う。
function readDomains(file: string | null): {
  domainsReadable: boolean
  domainCount: number
} {
  const unreadable = { domainsReadable: false, domainCount: 0 }
  if (!file) return unreadable
  const text = readFileSafe(file)
  if (text === null) return unreadable
  const content = findDomainsContent(text)
  if (content === null) return unreadable

  let parsed: unknown
  try {
    parsed = JSON.parse(content)
  } catch {
    return unreadable
  }
  if (!isPlainObject(parsed)) return unreadable

  const entries = Object.entries(parsed)
  if (entries.length === 0) return unreadable
  for (const [, globs] of entries) {
    if (!Array.isArray(globs) || globs.length === 0) return unreadable
    if (globs.some((g) => typeof g !== "string")) return unreadable
  }
  return { domainsReadable: true, domainCount: entries.length }
}

const domains = readDomains(architecturePath)

// ---------------------------------------------------------------------------
// Codiel 固有資産(文書の可読性は projectDocs 側に置く。設計書 §7-3)
// ---------------------------------------------------------------------------

/**
 * 契約 §3「codiel における 2 つのルート概念」・設計書 §7-3。
 *
 * `.codiel` は **開始ディレクトリからの上方向探索**で探す(codiel 自身の `findProjectRoot` と
 * 同じ基準)。`docRoot` 直下だけを見ると、`repo/.codiel/` があり
 * `repo/sub/metatron.config.json` がある構成で `repo/sub` から実行したとき、codiel は
 * `repo/.codiel` を見つけて動くのに sandalphon は「無い」と判定し、正当な委譲経路を塞ぐ。
 *
 * codiel の `findProjectRoot` は `existsSync` で判定するが、ここでは**ディレクトリだけ**を
 * 認める(設計書 §7-3 の `dirExists` の定義)。`.codiel` がファイルなら委譲は成立しないため、
 * 安全側(委譲を出さない側)に倒す。
 *
 * 見つからなければ `null` を返す(codiel の `findProjectRoot` が開始ディレクトリを返すのとは
 * 異なる。sandalphon が答えるのは「あるか無いか」であり、無いことを表す値が要る)。
 */
function findCodielRoot(): string | null {
  let dir = startDir
  while (true) {
    if (isDir(path.join(dir, ".codiel"))) return dir
    const parent = path.dirname(dir)
    // ファイルシステムのルートに達したら打ち切る。
    if (parent === dir) return null
    dir = parent
  }
}

const codielRoot = findCodielRoot()
const codielDirExists = codielRoot !== null
// runDirs は codielRoot 基準で読む(docRoot 基準ではない)。
const runDirs = codielRoot
  ? readdirEntriesSafe(path.join(codielRoot, ".codiel", "runs"))
      .filter((entry) => entry.isDirectory())
      .map((entry) => entry.name)
  : []

// 「Codiel の器がある」かつ「ドメイン定義が読める」の論理積(設計書 §7-3)。
const codielReady = codielDirExists && domains.domainsReadable

// ---------------------------------------------------------------------------
// intent 文書(repoRoot 基準。ディレクトリの作成は行わない)
// ---------------------------------------------------------------------------

const intentsDirPath = repoRoot ? path.join(repoRoot, "docs", "intents") : null
const intentsDir =
  intentsDirPath && isDir(intentsDirPath) ? intentsDirPath : null

interface IntentSummary {
  file: string
  title: string | null
  slug: string
  status: string
  issue: string
}

// 契約 §8-2: YAML パーサを導入せず、`---` で挟まれた先頭ブロックのトップレベルキーだけを
// 行単位で抽出する。値は前後の空白を除いた文字列で、引用符は剥がさない。
// frontmatter を切り出せない・`intent` キーが無いファイルは intent 文書として解釈できない
// ものとして existingIntents から落として続行する(設計書 §7-6)。
function parseIntentDoc(file: string, content: string): IntentSummary | null {
  const block = content.match(/^---\r?\n([\s\S]*?)\r?\n---/)?.[1]
  if (block === undefined) return null
  const top = parseTopLevel(block.replace(/\r/g, ""))
  if (top.intent === undefined) return null
  const title = content.match(/^# intent:\s*(.*)$/m)?.[1]?.trim() ?? null
  return {
    file,
    title: title === "" ? null : title,
    slug: top.slug ?? "",
    status: top.status ?? "",
    issue: top.issue ?? ""
  }
}

const existingIntents: IntentSummary[] = []
if (intentsDir) {
  for (const name of readdirSafe(intentsDir)) {
    if (!name.endsWith(".md")) continue
    const content = readFileSafe(path.join(intentsDir, name))
    if (content === null) continue
    const parsed = parseIntentDoc(name, content)
    if (parsed) existingIntents.push(parsed)
  }
}

// ---------------------------------------------------------------------------
// ASIS 探索の初期材料(ARCHITECTURE / GOTCHAS は解決結果、CLAUDE.md / README.md は docRoot 直下)
// ---------------------------------------------------------------------------

// 並びは capturing-intent の読む順(ARCHITECTURE → CLAUDE.md → GOTCHAS → README.md)に合わせる。
const contextDocs = [
  architecturePath,
  path.join(docRoot, "CLAUDE.md"),
  gotchasPath,
  path.join(docRoot, "README.md")
].filter((p): p is string => p !== null && isFile(p))

// ---------------------------------------------------------------------------
// テスト基盤の推定(設計書 §7-4)
// ---------------------------------------------------------------------------

type PackageManager = "pnpm" | "yarn" | "bun" | "npm"

function detectPackageManager(): PackageManager {
  if (existsSafe(path.join(docRoot, "pnpm-lock.yaml"))) return "pnpm"
  if (existsSafe(path.join(docRoot, "yarn.lock"))) return "yarn"
  if (
    existsSafe(path.join(docRoot, "bun.lockb")) ||
    existsSafe(path.join(docRoot, "bun.lock"))
  ) {
    return "bun"
  }
  return "npm"
}

const TEST_FILE_RE = /\.(test|spec)\.[^.]+$/
const PY_TEST_RE = /^test_.*\.py$/
const GO_TEST_RE = /_test\.go$/

function looksLikeTestFile(name: string): boolean {
  return (
    TEST_FILE_RE.test(name) || PY_TEST_RE.test(name) || GO_TEST_RE.test(name)
  )
}

// node_modules と .git を除外し、走査したファイル数が上限に達したら打ち切る(設計書 §7-4)。
// シンボリックリンクのディレクトリは辿らない(isDirectory() が false になるため)。
function findTestFiles(limit: number, maxMatches: number): string[] {
  const matches: string[] = []
  const queue: string[] = [docRoot]
  let visited = 0

  for (let i = 0; i < queue.length; i++) {
    if (visited >= limit || matches.length >= maxMatches) break
    const dir = queue[i]
    for (const entry of readdirEntriesSafe(dir)) {
      if (entry.isDirectory()) {
        if (entry.name === "node_modules" || entry.name === ".git") continue
        queue.push(path.join(dir, entry.name))
        continue
      }
      if (!entry.isFile()) continue
      visited++
      if (visited > limit) break
      if (looksLikeTestFile(entry.name)) {
        matches.push(
          path
            .relative(docRoot, path.join(dir, entry.name))
            .split(path.sep)
            .join("/")
        )
        if (matches.length >= maxMatches) break
      }
    }
  }
  return matches
}

function detectTestRunner(): {
  detected: boolean
  evidence: string[]
  command: string | null
} {
  const evidence: string[] = []
  let command: string | null = null

  // ルール 1: package.json の scripts.test
  const pkgRaw = readFileSafe(path.join(docRoot, "package.json"))
  if (pkgRaw !== null) {
    let pkg: unknown
    try {
      pkg = JSON.parse(pkgRaw)
    } catch {
      pkg = undefined
    }
    const scripts = isPlainObject(pkg) ? pkg.scripts : undefined
    if (isPlainObject(scripts) && typeof scripts.test === "string") {
      evidence.push("package.json:scripts.test")
      const pm = detectPackageManager()
      command = pm === "bun" ? "bun run test" : `${pm} test`
    }
  }

  // ルール 2: テストランナーの設定ファイル
  const configEvidence: { file: string; command: string | null }[] = []
  for (const name of readdirSafe(docRoot)) {
    if (/^vitest\.config\.[cm]?[jt]s$/.test(name)) {
      configEvidence.push({ file: name, command: null })
    } else if (/^jest\.config\.([cm]?[jt]s|json)$/.test(name)) {
      configEvidence.push({ file: name, command: null })
    } else if (name === "pytest.ini") {
      configEvidence.push({ file: name, command: "pytest" })
    } else if (name === "go.mod") {
      configEvidence.push({ file: name, command: "go test ./..." })
    } else if (name === "Cargo.toml") {
      configEvidence.push({ file: name, command: "cargo test" })
    }
  }
  const pyprojectRaw = readFileSafe(path.join(docRoot, "pyproject.toml"))
  if (pyprojectRaw !== null && /^\s*\[tool\.pytest/m.test(pyprojectRaw)) {
    configEvidence.push({
      file: "pyproject.toml:[tool.pytest]",
      command: "pytest"
    })
  }
  for (const entry of configEvidence) {
    evidence.push(entry.file)
    if (command === null && entry.command !== null) command = entry.command
  }

  // ルール 3: テストファイルらしきパス
  for (const file of findTestFiles(TEST_FILE_SCAN_LIMIT, 3)) evidence.push(file)

  return { detected: evidence.length > 0, evidence, command }
}

const testRunner = detectTestRunner()

// ---------------------------------------------------------------------------
// 出力(事実だけを返す。判断はスキル側が行う)
// ---------------------------------------------------------------------------

console.log(
  JSON.stringify(
    {
      isGitRepo,
      repoRoot,
      remoteUrl,
      repoSlug,
      ghInstalled,
      ghAuthenticated,
      templates,
      blankIssuesEnabled,
      docRoot,
      configWarnings,
      projectDocs: {
        architecture: architecturePath,
        gotchas: gotchasPath,
        domainsReadable: domains.domainsReadable,
        domainCount: domains.domainCount
      },
      codielReady,
      codielHarness: {
        dirExists: codielDirExists,
        codielRoot,
        runDirs
      },
      intentsDir,
      existingIntents,
      contextDocs,
      testRunner
    },
    null,
    2
  )
)
