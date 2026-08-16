// コードベース解析(事実の収集)と、現行 ARCHITECTURE との乖離候補の算出。
//
// 出典: metatron 設計書 `harness-docs/design/2026-08-16-metatron-design.md`
// §9-1(scan が返す事実の表)/ §9-3(diff-architecture が返す乖離候補の表)。
// セクション名の正本はファイル契約
// `harness-docs/design/2026-08-16-file-contract-freeze.md` §4-1。
//
// この層は読み取り経路(契約 §4-3 の第 2 層)であり、フェイルオープンする。
// **例外を投げない。** 読めないディレクトリ・壊れた JSON はスキップして続行する。
// 走査はすべて打ち切り上限を持ち、上限に当たった事実は `truncation` に載せる。
//
// scan は「決定的に取れる事実」だけを返す。推測も文章生成もしない。
// diffArchitecture も同様に、決定的に検出できる乖離だけを候補に出す。
// 「散文の内容が実装と食い違う」といった意味的な乖離は候補に出さない(設計書 §9-3)。

import fs from "node:fs"
import path from "node:path"
import { findDocRoot } from "./config.js"

// ---------------------------------------------------------------------------
// 定数
// ---------------------------------------------------------------------------

/** 契約 §4-1 の 10 セクション。見出し名と順序を固定する。 */
export const ARCHITECTURE_SECTIONS = [
  "システム概要",
  "技術スタック",
  "レイヤー構造",
  "ディレクトリ構成と責務",
  "ドメインマップ",
  "コマンド定義",
  "テスト方針",
  "保護パス",
  "規約",
  "ADR 一覧"
] as const

/**
 * 走査から除外するディレクトリ名。
 * `node_modules` / `.git` と、主要なビルド出力・キャッシュ(設計書 §9-1)。
 * 名前での一致であり、階層を問わない。
 */
export const EXCLUDED_DIRECTORY_NAMES: ReadonlySet<string> = new Set([
  ".git",
  "node_modules",
  "dist",
  "build",
  "out",
  "coverage",
  "target",
  "vendor",
  "__pycache__",
  ".venv",
  "venv",
  ".tox",
  ".mypy_cache",
  ".pytest_cache",
  ".ruff_cache",
  ".next",
  ".nuxt",
  ".output",
  ".svelte-kit",
  ".astro",
  ".turbo",
  ".cache",
  ".parcel-cache",
  ".vercel",
  ".netlify",
  ".gradle",
  ".idea",
  ".pnpm-store"
])

/** lockfile → パッケージマネージャ。判定の優先順位はこの並び。 */
const LOCKFILES: ReadonlyArray<{ file: string; name: string }> = [
  { file: "pnpm-lock.yaml", name: "pnpm" },
  { file: "yarn.lock", name: "yarn" },
  { file: "package-lock.json", name: "npm" },
  { file: "npm-shrinkwrap.json", name: "npm" },
  { file: "bun.lockb", name: "bun" },
  { file: "bun.lock", name: "bun" },
  { file: "deno.lock", name: "deno" },
  { file: "uv.lock", name: "uv" },
  { file: "poetry.lock", name: "poetry" },
  { file: "Pipfile.lock", name: "pipenv" },
  { file: "Cargo.lock", name: "cargo" },
  { file: "go.sum", name: "go" },
  { file: "composer.lock", name: "composer" },
  { file: "Gemfile.lock", name: "bundler" }
]

/** JS 系パッケージマネージャ(`<pm> run <script>` の形を持つもの)。 */
const JS_PACKAGE_MANAGERS: ReadonlySet<string> = new Set([
  "pnpm",
  "npm",
  "yarn",
  "bun"
])

/** テストファイルを収めるとみなすディレクトリ名。 */
const TEST_DIRECTORY_NAMES: ReadonlySet<string> = new Set([
  "__tests__",
  "__test__",
  "tests",
  "test",
  "spec",
  "e2e"
])

/** 設定ファイル名(接頭辞) → テストフレームワーク。 */
const TEST_CONFIG_PREFIXES: ReadonlyArray<{
  prefix: string
  framework: string
}> = [
  { prefix: "vitest.config.", framework: "vitest" },
  { prefix: "vitest.workspace.", framework: "vitest" },
  { prefix: "jest.config.", framework: "jest" },
  { prefix: "playwright.config.", framework: "playwright" },
  { prefix: "cypress.config.", framework: "cypress" },
  { prefix: "karma.conf.", framework: "karma" },
  { prefix: ".mocharc.", framework: "mocha" }
]

/** 完全一致でテストフレームワークを示す設定ファイル。 */
const TEST_CONFIG_FILES: ReadonlyArray<{ file: string; framework: string }> = [
  { file: "cypress.json", framework: "cypress" },
  { file: "pytest.ini", framework: "pytest" },
  { file: "conftest.py", framework: "pytest" },
  { file: "tox.ini", framework: "tox" },
  { file: "phpunit.xml", framework: "phpunit" }
]

/** devDependencies / dependencies に現れたらテストフレームワークとみなす名前。 */
const TEST_DEPENDENCY_NAMES: ReadonlySet<string> = new Set([
  "vitest",
  "jest",
  "mocha",
  "ava",
  "tap",
  "uvu",
  "karma",
  "jasmine",
  "cypress",
  "playwright",
  "@playwright/test",
  "@jest/globals",
  "testing-library",
  "@testing-library/react",
  "node-tap"
])

/** `<pm> run` の後ろに来てもスクリプト名でないサブコマンド。 */
const PACKAGE_MANAGER_SUBCOMMANDS: ReadonlySet<string> = new Set([
  "install",
  "i",
  "ci",
  "add",
  "remove",
  "rm",
  "un",
  "uninstall",
  "exec",
  "dlx",
  "x",
  "create",
  "init",
  "update",
  "up",
  "upgrade",
  "outdated",
  "audit",
  "publish",
  "pack",
  "link",
  "unlink",
  "why",
  "list",
  "ls",
  "run",
  "workspace",
  "recursive",
  "config",
  "store",
  "dedupe",
  "licenses",
  "info",
  "version"
])

/**
 * `## 技術スタック` の inline code から依存名を拾うときに無視する語。
 * npm のパッケージ名の文法には合致するが、依存ライブラリを指していないもの。
 */
const NON_PACKAGE_TOKENS: ReadonlySet<string> = new Set([
  "node",
  "npm",
  "pnpm",
  "yarn",
  "bun",
  "deno",
  "git",
  "docker",
  "make",
  "python",
  "python3",
  "pip",
  "uv",
  "poetry",
  "go",
  "rust",
  "cargo",
  "java",
  "kotlin",
  "swift",
  "ruby",
  "php",
  "sh",
  "bash",
  "zsh",
  "json",
  "jsonc",
  "yaml",
  "yml",
  "toml",
  "md",
  "markdown",
  "ts",
  "tsx",
  "js",
  "jsx",
  "mjs",
  "cjs",
  "mts",
  "cts",
  "esm",
  "cjs-only",
  "src",
  "dist",
  "scripts",
  "main",
  "dev",
  "prod",
  "latest",
  "workspace",
  "true",
  "false",
  "null"
])

// ---------------------------------------------------------------------------
// 型
// ---------------------------------------------------------------------------

export interface ScanLimits {
  /** ツリーとして返す深さ(既定 3。設計書 §9-1)。 */
  maxDepth: number
  /** 走査するディレクトリエントリの総数。 */
  maxEntries: number
  /** `files` として返すファイルパスの数。 */
  maxFiles: number
  /** `tree` として返すエントリの数。 */
  maxTreeEntries: number
  /** テストファイルとして記録するファイルの数(既定 200)。 */
  maxTestFiles: number
  /** ドメイン候補ごとに保持するサンプルパスの数。 */
  maxDomainSamples: number
  /** 見出しを読む既存ドキュメントの数。 */
  maxDocuments: number
  /** 1 文書あたりに読む見出しの数。 */
  maxHeadingsPerDocument: number
}

export const DEFAULT_SCAN_LIMITS: ScanLimits = {
  maxDepth: 3,
  maxEntries: 20000,
  maxFiles: 2000,
  maxTreeEntries: 2000,
  maxTestFiles: 200,
  maxDomainSamples: 12,
  maxDocuments: 50,
  maxHeadingsPerDocument: 200
}

export interface ScanOptions {
  /** 走査の基準ディレクトリ。省略時は `findDocRoot(startDir)` の結果。 */
  root?: string
  /** 打ち切り上限の上書き。指定した項目だけ差し替わる。 */
  limits?: Partial<ScanLimits>
}

export interface PackageManagerFact {
  /** 判定結果。lockfile が 1 つも無ければ `null`。 */
  name: string | null
  /** 検出した lockfile(root からの相対パス)。 */
  lockfiles: string[]
  /** `package.json` の `packageManager` フィールド。無ければ `null`。 */
  packageManagerField: string | null
}

export interface LanguageFact {
  /** 言語・ランタイム名。 */
  name: string
  /** 判定の出所(root からの相対パス)。 */
  source: string
  /** 出所から決定的に取れた値。 */
  details: Record<string, string>
}

export interface DependencyEntry {
  name: string
  /** `package.json` に書かれたバージョン指定の文字列。 */
  version: string
}

export interface DependencyFacts {
  /** 読み取れた `package.json` の相対パス。読めなければ `null`。 */
  source: string | null
  dependencies: DependencyEntry[]
  devDependencies: DependencyEntry[]
}

export type CommandKind = "e2e" | "typecheck" | "test" | "lint" | "build"

export interface ScriptEntry {
  name: string
  command: string
}

export interface CommandCandidate {
  kind: CommandKind
  /** `scripts` のキー。 */
  script: string
  /** `scripts` の値。 */
  command: string
  /** パッケージマネージャを前置した実行形。判定できなければ `null`。 */
  invocation: string | null
}

export interface TreeEntry {
  /** root からの相対パス(区切りは常に `/`)。 */
  path: string
  /** root 直下を 1 とする深さ。 */
  depth: number
  type: "directory" | "file"
}

export interface TestConfigFact {
  framework: string
  /** root からの相対パス。 */
  path: string
}

export interface TestFilePattern {
  /** 命名パターン(例: `*.test.ts`)。 */
  pattern: string
  count: number
  /** 実例(最大 3 件)。 */
  examples: string[]
}

export interface TestFrameworkFacts {
  /** 設定ファイルから検出したフレームワーク。 */
  configs: TestConfigFact[]
  /** `package.json` の依存から検出したフレームワーク名。 */
  fromDependencies: string[]
  /** テストファイルの命名パターンと件数。 */
  filePatterns: TestFilePattern[]
  /** テストファイルを含むディレクトリ(root からの相対パス)。 */
  directories: string[]
}

export interface DomainCandidate {
  /** root からの相対パス(区切りは常に `/`)。 */
  path: string
  /** ディレクトリ名。 */
  name: string
  /** 配下のファイル数(再帰。除外ディレクトリを除く)。 */
  fileCount: number
  /** glob の突き合わせに使うサンプルパス。 */
  samplePaths: string[]
}

export interface DocumentHeading {
  /** `#` の個数。 */
  level: number
  /** 見出しの文字列(`#` と直後の空白を除いたもの)。 */
  text: string
}

export interface DocumentFact {
  /** root からの相対パス。 */
  path: string
  headings: DocumentHeading[]
  /** 見出しの上限に達して打ち切ったか。 */
  truncated: boolean
}

export interface ScanTruncation {
  /** ディレクトリ走査がエントリ数の上限に達した。 */
  walk: boolean
  /** `files` が上限に達した。 */
  files: boolean
  /** `tree` が上限に達した。 */
  tree: boolean
  /** テストファイルの検出が上限に達した。 */
  testFiles: boolean
  /** 見出しを読む文書数が上限に達した。 */
  documents: boolean
  /** 上限に当たった箇所の説明。空配列なら打ち切り無し。 */
  notes: string[]
}

export interface ScanResult {
  /** 走査の基準ディレクトリ(絶対パス)。 */
  root: string
  packageManager: PackageManagerFact
  languages: LanguageFact[]
  dependencies: DependencyFacts
  /** `package.json` の `scripts` 全件。 */
  scripts: ScriptEntry[]
  /** test / lint / build / typecheck / e2e に該当しそうなキー。 */
  commands: CommandCandidate[]
  /** 深さ `maxDepth` までのツリー。 */
  tree: TreeEntry[]
  /** 走査したファイル(root からの相対パス)。`maxFiles` で打ち切る。 */
  files: string[]
  /** 除外ディレクトリを除いたファイルの総数。 */
  fileCount: number
  testFrameworks: TestFrameworkFacts
  domainCandidates: DomainCandidate[]
  documents: DocumentFact[]
  truncation: ScanTruncation
  /** 読めなかったディレクトリ・壊れた JSON 等の理由。空配列が正常。 */
  warnings: string[]
}

export type DiffFindingKind =
  | "section_missing"
  | "tech_stack_added"
  | "tech_stack_removed"
  | "command_added"
  | "command_removed"
  | "directory_undocumented"
  | "directory_stale"
  | "domain_gap"
  | "domain_dead_glob"

export interface DiffFinding {
  kind: DiffFindingKind
  /** 対象セクションの見出し名。 */
  section: string
  /** 対象(パッケージ名 / スクリプト名 / glob / ディレクトリ / 見出し名)。 */
  subject: string
  /** 1 行の説明。 */
  detail: string
}

export interface ArchitectureSection {
  /** 見出し名(`## ` を除いたもの)。 */
  heading: string
  /** セクション本文。見出し行は含めても含めなくてよい。 */
  body: string
}

/**
 * セクション本文の受け取り方。
 * 見出し名 → 本文の写像でも、`{ heading, body }` の配列でもよい。
 * **ファイルの読み取りとセクション分解は呼び出し元(CLI)の責務**であり、
 * この関数は architecture.ts に依存しない。
 */
export type ArchitectureSections =
  | Record<string, string>
  | ArchitectureSection[]

export interface DiffArchitectureInput {
  /** `scan()` の結果。 */
  scan: ScanResult
  /** 現行 ARCHITECTURE のセクション本文。 */
  sections: ArchitectureSections
  /**
   * ARCHITECTURE が存在したか。既定は `sections` が 1 つ以上あるかで判定する。
   * `false` のときは 10 セクションすべてを `section_missing` として返す。
   */
  architectureExists?: boolean
  /**
   * `metatron:domains` の抽出結果。
   * 抽出は architecture.ts の責務なので、呼び出し元が渡す。
   * `undefined` は「抽出していない」、`null` は「抽出できなかった」を表し、
   * どちらもドメイン関連の検出を行わない。
   */
  domains?: Record<string, string[]> | null
}

export interface DiffArchitectureResult {
  findings: DiffFinding[]
  /** 決定的に検出できないため実施しなかった項目の理由。 */
  skipped: string[]
  warnings: string[]
}

// ---------------------------------------------------------------------------
// 小道具
// ---------------------------------------------------------------------------

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value)
}

function compareStrings(a: string, b: string): number {
  if (a < b) return -1
  if (a > b) return 1
  return 0
}

function readTextFile(file: string): string | null {
  try {
    return fs.readFileSync(file, "utf8")
  } catch {
    return null
  }
}

function fileExists(file: string): boolean {
  try {
    return fs.statSync(file).isFile()
  } catch {
    return false
  }
}

/** JSON を読む。読めない・壊れている場合は `null` を返し、例外を投げない。 */
function readJsonFile(file: string): unknown {
  const text = readTextFile(file)
  if (text === null) return null
  try {
    return JSON.parse(text)
  } catch {
    return null
  }
}

/**
 * JSONC(コメント付き JSON)を読む。`tsconfig.json` がコメントを含みうるため。
 * 素の `JSON.parse` に失敗したときだけ、コメントを除去して 1 度だけ再試行する。
 */
function readJsoncFile(file: string): unknown {
  const text = readTextFile(file)
  if (text === null) return null
  try {
    return JSON.parse(text)
  } catch {
    // 文字列リテラルの中を壊さないよう、簡易な字句走査で除去する。
    let stripped = ""
    let inString = false
    let escaped = false
    let i = 0
    while (i < text.length) {
      const c = text[i] ?? ""
      if (inString) {
        stripped += c
        if (escaped) escaped = false
        else if (c === "\\") escaped = true
        else if (c === '"') inString = false
        i += 1
        continue
      }
      if (c === '"') {
        inString = true
        stripped += c
        i += 1
        continue
      }
      if (c === "/" && text[i + 1] === "/") {
        while (i < text.length && text[i] !== "\n") i += 1
        continue
      }
      if (c === "/" && text[i + 1] === "*") {
        i += 2
        while (i < text.length && !(text[i] === "*" && text[i + 1] === "/")) {
          i += 1
        }
        i += 2
        continue
      }
      stripped += c
      i += 1
    }
    // 末尾カンマも許容する(tsconfig で頻出)。
    stripped = stripped.replace(/,(\s*[}\]])/g, "$1")
    try {
      return JSON.parse(stripped)
    } catch {
      return null
    }
  }
}

/**
 * glob を正規表現へ変換する。
 * 意味は codiel `src/hooks/lib.ts` の `globToRegExp` と同じ
 * (`**` は任意深さ、`*` は 1 階層内、`?` は 1 文字)。
 * プラグイン間はソースを共有できないため独立に持つ(設計書 §3-3)。
 */
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
    else re += (c ?? "").replace(/[.+^${}()|[\]\\]/g, "\\$&")
  }
  return new RegExp(`^${re}$`)
}

/**
 * Markdown の見出しを抽出する。
 * 契約 §4-2 の正規化(末尾 `\r` の除去、0〜3 スペースのインデント許容)と
 * フェンス状態機械に従い、フェンス内の `#` を見出しと誤認しない。
 * ここは契約が規定する ARCHITECTURE の分解ではなく、既存文書の見出し一覧の
 * 収集であるため architecture.ts に依存しないが、判定規則は同じものを使う。
 */
export function extractHeadings(
  text: string,
  maxHeadings: number
): { headings: DocumentHeading[]; truncated: boolean } {
  const headings: DocumentHeading[] = []
  let truncated = false
  let fenceChar: string | null = null
  let fenceLength = 0

  for (const rawLine of text.split("\n")) {
    const line = rawLine.endsWith("\r") ? rawLine.slice(0, -1) : rawLine
    const indent = /^ {0,3}/.exec(line)?.[0].length ?? 0
    if (/^ {4,}/.test(line)) {
      // インデント 4 以上は行頭とみなさない(契約 §4-2)。
      continue
    }
    const rest = line.slice(indent)

    if (fenceChar !== null) {
      const close = new RegExp(`^(\\${fenceChar}{${fenceLength},})[ \\t]*$`)
      if (close.test(rest)) {
        fenceChar = null
        fenceLength = 0
      }
      continue
    }

    const open = /^(`{3,}|~{3,})/.exec(rest)
    if (open) {
      const marker = open[1] ?? ""
      fenceChar = marker[0] ?? null
      fenceLength = marker.length
      continue
    }

    const heading = /^(#{1,6})\s+(.*)$/.exec(rest)
    if (heading) {
      if (headings.length >= maxHeadings) {
        truncated = true
        break
      }
      headings.push({
        level: (heading[1] ?? "").length,
        text: (heading[2] ?? "").trim()
      })
    }
  }

  return { headings, truncated }
}

/** フェンスで囲まれたブロックを取り除く。inline code の抽出前に使う。 */
function stripFencedBlocks(text: string): string {
  const kept: string[] = []
  let fenceChar: string | null = null
  let fenceLength = 0
  for (const rawLine of text.split("\n")) {
    const line = rawLine.endsWith("\r") ? rawLine.slice(0, -1) : rawLine
    const rest = /^ {4,}/.test(line) ? line : line.replace(/^ {0,3}/, "")
    if (fenceChar !== null) {
      const close = new RegExp(`^(\\${fenceChar}{${fenceLength},})[ \\t]*$`)
      if (close.test(rest)) {
        fenceChar = null
        fenceLength = 0
      }
      continue
    }
    const open = /^(`{3,}|~{3,})/.exec(rest)
    if (open) {
      const marker = open[1] ?? ""
      fenceChar = marker[0] ?? null
      fenceLength = marker.length
      continue
    }
    kept.push(line)
  }
  return kept.join("\n")
}

/** フェンス外の inline code スパンを取り出す。 */
function extractInlineCode(text: string): string[] {
  const out: string[] = []
  const body = stripFencedBlocks(text)
  const re = /`([^`\n]+)`/g
  let m = re.exec(body)
  while (m !== null) {
    const token = (m[1] ?? "").trim()
    if (token !== "") out.push(token)
    m = re.exec(body)
  }
  return out
}

/** npm のパッケージ名の文法に合致するか。 */
function looksLikePackageName(token: string): boolean {
  return /^(@[a-z0-9-~][a-z0-9-._~]*\/)?[a-z0-9-~][a-z0-9-._~]*$/.test(token)
}

// ---------------------------------------------------------------------------
// scan: ディレクトリ走査
// ---------------------------------------------------------------------------

interface WalkState {
  limits: ScanLimits
  tree: TreeEntry[]
  files: string[]
  fileCount: number
  testFiles: string[]
  /** 深さ 1・2 のディレクトリ → 配下のファイル数。 */
  dirFileCounts: Map<string, number>
  /** 深さ 1・2 のディレクトリ → サンプルパス。 */
  dirSamples: Map<string, string[]>
  /** 深さ 1・2 のディレクトリ(出現順を保つため別に持つ)。 */
  dirs: Set<string>
  visited: number
  truncation: ScanTruncation
  unreadable: string[]
}

function recordFile(state: WalkState, rel: string): void {
  state.fileCount += 1
  if (state.files.length < state.limits.maxFiles) state.files.push(rel)
  else state.truncation.files = true

  // ドメイン候補は「トップレベルおよび src/ 直下」なので、
  // 深さ 1・2 の接頭辞にだけ集計すれば足りる(設計書 §9-1)。
  const segments = rel.split("/")
  for (let depth = 1; depth <= 2 && depth < segments.length; depth++) {
    const prefix = segments.slice(0, depth).join("/")
    state.dirFileCounts.set(prefix, (state.dirFileCounts.get(prefix) ?? 0) + 1)
    const samples = state.dirSamples.get(prefix)
    if (samples === undefined) state.dirSamples.set(prefix, [rel])
    else if (samples.length < state.limits.maxDomainSamples) samples.push(rel)
  }

  if (isTestFilePath(rel)) {
    if (state.testFiles.length < state.limits.maxTestFiles) {
      state.testFiles.push(rel)
    } else {
      state.truncation.testFiles = true
    }
  }
}

function pushTree(
  state: WalkState,
  rel: string,
  depth: number,
  type: "directory" | "file"
): void {
  if (depth > state.limits.maxDepth) return
  if (state.tree.length >= state.limits.maxTreeEntries) {
    state.truncation.tree = true
    return
  }
  state.tree.push({ path: rel, depth, type })
}

function walkDirectory(
  state: WalkState,
  dir: string,
  rel: string,
  depth: number
): void {
  if (state.truncation.walk) return

  let dirents: fs.Dirent[]
  try {
    dirents = fs.readdirSync(dir, { withFileTypes: true })
  } catch {
    state.unreadable.push(rel === "" ? "." : rel)
    return
  }
  dirents.sort((a, b) => compareStrings(a.name, b.name))

  for (const dirent of dirents) {
    if (state.visited >= state.limits.maxEntries) {
      state.truncation.walk = true
      return
    }
    state.visited += 1
    const childRel = rel === "" ? dirent.name : `${rel}/${dirent.name}`
    // シンボリックリンクは isDirectory / isFile のいずれでもないため、
    // ここで自然に読み飛ばされる。循環を踏まないための意図的な扱い。
    if (dirent.isDirectory()) {
      if (EXCLUDED_DIRECTORY_NAMES.has(dirent.name)) continue
      if (depth + 1 <= 2) state.dirs.add(childRel)
      pushTree(state, childRel, depth + 1, "directory")
      walkDirectory(state, path.join(dir, dirent.name), childRel, depth + 1)
    } else if (dirent.isFile()) {
      recordFile(state, childRel)
      pushTree(state, childRel, depth + 1, "file")
    }
  }
}

/** テストファイルとみなすか(命名パターンまたはテストディレクトリ配下)。 */
function isTestFilePath(rel: string): boolean {
  return testFilePattern(rel) !== null
}

/**
 * テストファイルの命名パターンを返す。テストファイルでなければ `null`。
 * 判定は決定的な命名規則のみで行い、ファイルの中身は読まない。
 */
export function testFilePattern(rel: string): string | null {
  const segments = rel.split("/")
  const base = segments[segments.length - 1] ?? ""

  const dotted = /^.+\.(test|spec)\.([A-Za-z0-9]+)$/.exec(base)
  if (dotted) return `*.${dotted[1]}.${dotted[2]}`

  const pyPrefix = /^test_.+\.py$/.exec(base)
  if (pyPrefix) return "test_*.py"

  const underscore = /^.+_test\.([A-Za-z0-9]+)$/.exec(base)
  if (underscore) return `*_test.${underscore[1]}`

  const suffixTest = /^.+Test\.(java|kt|kts|cs|scala)$/.exec(base)
  if (suffixTest) return `*Test.${suffixTest[1]}`

  for (let i = 0; i < segments.length - 1; i++) {
    const dir = segments[i] ?? ""
    if (TEST_DIRECTORY_NAMES.has(dir)) {
      const ext = /\.([A-Za-z0-9]+)$/.exec(base)?.[1]
      return ext === undefined ? `${dir}/*` : `${dir}/*.${ext}`
    }
  }
  return null
}

// ---------------------------------------------------------------------------
// scan: 事実の抽出
// ---------------------------------------------------------------------------

function scanPackageManager(
  root: string,
  packageJson: Record<string, unknown> | null,
  warnings: string[]
): PackageManagerFact {
  const lockfiles: string[] = []
  let name: string | null = null
  for (const entry of LOCKFILES) {
    if (!fileExists(path.join(root, entry.file))) continue
    lockfiles.push(entry.file)
    if (name === null) name = entry.name
  }
  if (lockfiles.length > 1) {
    warnings.push(
      `lockfile が複数あります(${lockfiles.join(", ")})。優先順位の先頭 ${String(name)} を採用しました。`
    )
  }
  const field = packageJson?.packageManager
  return {
    name,
    lockfiles,
    packageManagerField: typeof field === "string" ? field : null
  }
}

/** `key = "value"` 形式の 1 行を拾う簡易 TOML 読み(パーサは導入しない)。 */
function tomlValue(text: string, key: string): string | undefined {
  const re = new RegExp(`^\\s*${key}\\s*=\\s*["']([^"']*)["']\\s*$`, "m")
  return re.exec(text)?.[1]
}

function scanLanguages(
  root: string,
  packageJson: Record<string, unknown> | null
): LanguageFact[] {
  const out: LanguageFact[] = []

  if (packageJson !== null) {
    const details: Record<string, string> = {}
    const engines = packageJson.engines
    if (isPlainObject(engines)) {
      for (const [k, v] of Object.entries(engines)) {
        if (typeof v === "string") details[`engines.${k}`] = v
      }
    }
    if (typeof packageJson.type === "string") details.type = packageJson.type
    out.push({ name: "Node.js", source: "package.json", details })
  }

  const tsconfigPath = path.join(root, "tsconfig.json")
  if (fileExists(tsconfigPath)) {
    const details: Record<string, string> = {}
    const parsed = readJsoncFile(tsconfigPath)
    if (isPlainObject(parsed)) {
      const options = parsed.compilerOptions
      if (isPlainObject(options)) {
        for (const key of ["target", "module", "moduleResolution", "strict"]) {
          const value = options[key]
          if (typeof value === "string" || typeof value === "boolean") {
            details[key] = String(value)
          }
        }
      }
    }
    out.push({ name: "TypeScript", source: "tsconfig.json", details })
  }

  const pyproject = readTextFile(path.join(root, "pyproject.toml"))
  if (pyproject !== null) {
    const details: Record<string, string> = {}
    const requires = tomlValue(pyproject, "requires-python")
    if (requires !== undefined) details["requires-python"] = requires
    const name = tomlValue(pyproject, "name")
    if (name !== undefined) details.name = name
    out.push({ name: "Python", source: "pyproject.toml", details })
  }

  const goMod = readTextFile(path.join(root, "go.mod"))
  if (goMod !== null) {
    const details: Record<string, string> = {}
    const moduleName = /^module\s+(\S+)\s*$/m.exec(goMod)?.[1]
    if (moduleName !== undefined) details.module = moduleName
    const goVersion = /^go\s+(\S+)\s*$/m.exec(goMod)?.[1]
    if (goVersion !== undefined) details.go = goVersion
    out.push({ name: "Go", source: "go.mod", details })
  }

  const cargo = readTextFile(path.join(root, "Cargo.toml"))
  if (cargo !== null) {
    const details: Record<string, string> = {}
    const edition = tomlValue(cargo, "edition")
    if (edition !== undefined) details.edition = edition
    const rustVersion = tomlValue(cargo, "rust-version")
    if (rustVersion !== undefined) details["rust-version"] = rustVersion
    const name = tomlValue(cargo, "name")
    if (name !== undefined) details.name = name
    out.push({ name: "Rust", source: "Cargo.toml", details })
  }

  return out
}

function toDependencyEntries(raw: unknown): DependencyEntry[] {
  if (!isPlainObject(raw)) return []
  const out: DependencyEntry[] = []
  for (const [name, version] of Object.entries(raw)) {
    out.push({ name, version: typeof version === "string" ? version : "" })
  }
  out.sort((a, b) => compareStrings(a.name, b.name))
  return out
}

/**
 * `scripts` のキーがどの種別に該当しそうかを判定する。
 * 1 キーに 1 種別を割り当て、優先順位は e2e → typecheck → test → lint → build。
 * (`test:e2e` は e2e として扱う。)
 */
export function classifyScript(name: string): CommandKind | null {
  const key = name.toLowerCase().replace(/[-_:./\s]/g, "")
  if (
    key.includes("e2e") ||
    key.includes("playwright") ||
    key.includes("cypress")
  ) {
    return "e2e"
  }
  if (key.includes("typecheck") || key.includes("tsc")) return "typecheck"
  if (
    key.includes("test") ||
    key.includes("spec") ||
    key.includes("vitest") ||
    key.includes("jest")
  ) {
    return "test"
  }
  if (key.includes("lint") || key.includes("biome") || key.includes("eslint")) {
    return "lint"
  }
  if (
    key.includes("build") ||
    key.includes("compile") ||
    key.includes("bundle")
  ) {
    return "build"
  }
  return null
}

function scanScripts(
  packageJson: Record<string, unknown> | null,
  packageManager: string | null
): { scripts: ScriptEntry[]; commands: CommandCandidate[] } {
  const raw = packageJson?.scripts
  if (!isPlainObject(raw)) return { scripts: [], commands: [] }

  const scripts: ScriptEntry[] = []
  for (const [name, command] of Object.entries(raw)) {
    if (typeof command !== "string") continue
    scripts.push({ name, command })
  }
  scripts.sort((a, b) => compareStrings(a.name, b.name))

  const usable =
    packageManager !== null && JS_PACKAGE_MANAGERS.has(packageManager)
      ? packageManager
      : null

  const commands: CommandCandidate[] = []
  for (const script of scripts) {
    const kind = classifyScript(script.name)
    if (kind === null) continue
    commands.push({
      kind,
      script: script.name,
      command: script.command,
      invocation: usable === null ? null : `${usable} run ${script.name}`
    })
  }
  return { scripts, commands }
}

function scanTestFrameworks(
  root: string,
  state: WalkState,
  dependencies: DependencyFacts
): TestFrameworkFacts {
  const configs: TestConfigFact[] = []
  const seenConfigs = new Set<string>()
  // 設定ファイルはルート直下と深さ 2 までのツリー上の実在ファイルから拾う。
  for (const entry of state.tree) {
    if (entry.type !== "file") continue
    if (entry.depth > 2) continue
    const base = entry.path.split("/").pop() ?? ""
    let framework: string | null = null
    for (const candidate of TEST_CONFIG_FILES) {
      if (base === candidate.file) framework = candidate.framework
    }
    if (framework === null) {
      for (const candidate of TEST_CONFIG_PREFIXES) {
        if (base.startsWith(candidate.prefix)) framework = candidate.framework
      }
    }
    if (framework === null) continue
    const key = `${framework}\u0000${entry.path}`
    if (seenConfigs.has(key)) continue
    seenConfigs.add(key)
    configs.push({ framework, path: entry.path })
  }

  // pyproject.toml の [tool.pytest] は設定ファイルと同じ強さの決定的な signal。
  const pyproject = readTextFile(path.join(root, "pyproject.toml"))
  if (pyproject !== null && /^\s*\[tool\.pytest/m.test(pyproject)) {
    configs.push({ framework: "pytest", path: "pyproject.toml" })
  }
  configs.sort(
    (a, b) =>
      compareStrings(a.framework, b.framework) || compareStrings(a.path, b.path)
  )

  const fromDependencies: string[] = []
  for (const dep of [
    ...dependencies.dependencies,
    ...dependencies.devDependencies
  ]) {
    if (TEST_DEPENDENCY_NAMES.has(dep.name)) fromDependencies.push(dep.name)
  }
  fromDependencies.sort(compareStrings)

  const patternMap = new Map<string, { count: number; examples: string[] }>()
  const directories = new Set<string>()
  for (const file of state.testFiles) {
    const pattern = testFilePattern(file)
    if (pattern === null) continue
    const current = patternMap.get(pattern)
    if (current === undefined) {
      patternMap.set(pattern, { count: 1, examples: [file] })
    } else {
      current.count += 1
      if (current.examples.length < 3) current.examples.push(file)
    }
    const dir = file.includes("/") ? file.slice(0, file.lastIndexOf("/")) : "."
    directories.add(dir)
  }
  const filePatterns: TestFilePattern[] = [...patternMap.entries()]
    .map(([pattern, v]) => ({
      pattern,
      count: v.count,
      examples: v.examples
    }))
    .sort((a, b) => b.count - a.count || compareStrings(a.pattern, b.pattern))

  return {
    configs,
    fromDependencies: [...new Set(fromDependencies)],
    filePatterns,
    directories: [...directories].sort(compareStrings)
  }
}

function scanDomainCandidates(state: WalkState): DomainCandidate[] {
  const out: DomainCandidate[] = []
  for (const dir of state.dirs) {
    const depth = dir.split("/").length
    // トップレベル、および src/ 直下だけを候補にする(設計書 §9-1)。
    if (depth === 2 && !dir.startsWith("src/")) continue
    out.push({
      path: dir,
      name: dir.split("/").pop() ?? dir,
      fileCount: state.dirFileCounts.get(dir) ?? 0,
      samplePaths: state.dirSamples.get(dir) ?? []
    })
  }
  out.sort((a, b) => compareStrings(a.path, b.path))
  return out
}

function collectMarkdownFiles(
  dir: string,
  rel: string,
  depth: number,
  maxDepth: number,
  out: string[],
  limit: number
): void {
  if (depth > maxDepth || out.length >= limit) return
  let dirents: fs.Dirent[]
  try {
    dirents = fs.readdirSync(dir, { withFileTypes: true })
  } catch {
    return
  }
  dirents.sort((a, b) => compareStrings(a.name, b.name))
  for (const dirent of dirents) {
    if (out.length >= limit) return
    const childRel = rel === "" ? dirent.name : `${rel}/${dirent.name}`
    if (dirent.isDirectory()) {
      if (EXCLUDED_DIRECTORY_NAMES.has(dirent.name)) continue
      collectMarkdownFiles(
        path.join(dir, dirent.name),
        childRel,
        depth + 1,
        maxDepth,
        out,
        limit
      )
    } else if (dirent.isFile() && /\.md$/i.test(dirent.name)) {
      out.push(childRel)
    }
  }
}

function scanDocuments(
  root: string,
  limits: ScanLimits,
  truncation: ScanTruncation
): DocumentFact[] {
  const targets: string[] = []

  // ルート直下の README / CLAUDE(大文字小文字を問わない)。
  let rootEntries: fs.Dirent[] = []
  try {
    rootEntries = fs.readdirSync(root, { withFileTypes: true })
  } catch {
    rootEntries = []
  }
  rootEntries.sort((a, b) => compareStrings(a.name, b.name))
  for (const dirent of rootEntries) {
    if (!dirent.isFile()) continue
    const lower = dirent.name.toLowerCase()
    if (lower === "readme.md" || lower === "claude.md")
      targets.push(dirent.name)
  }

  // docs/ 配下の md(深さ 3 まで)。
  const docsDir = path.join(root, "docs")
  const docsFiles: string[] = []
  collectMarkdownFiles(docsDir, "docs", 1, 3, docsFiles, limits.maxDocuments)
  for (const file of docsFiles) targets.push(file)

  const documents: DocumentFact[] = []
  for (const rel of targets) {
    if (documents.length >= limits.maxDocuments) {
      truncation.documents = true
      break
    }
    const text = readTextFile(path.join(root, rel))
    if (text === null) continue
    const { headings, truncated } = extractHeadings(
      text,
      limits.maxHeadingsPerDocument
    )
    documents.push({ path: rel, headings, truncated })
  }
  return documents
}

// ---------------------------------------------------------------------------
// scan 本体
// ---------------------------------------------------------------------------

function scanInner(
  startDir: string | undefined,
  options: ScanOptions
): ScanResult {
  const limits: ScanLimits = { ...DEFAULT_SCAN_LIMITS, ...options.limits }
  const root =
    options.root !== undefined
      ? path.resolve(options.root)
      : findDocRoot(startDir)

  const warnings: string[] = []
  const truncation: ScanTruncation = {
    walk: false,
    files: false,
    tree: false,
    testFiles: false,
    documents: false,
    notes: []
  }

  const state: WalkState = {
    limits,
    tree: [],
    files: [],
    fileCount: 0,
    testFiles: [],
    dirFileCounts: new Map(),
    dirSamples: new Map(),
    dirs: new Set(),
    visited: 0,
    truncation,
    unreadable: []
  }
  walkDirectory(state, root, "", 0)

  if (state.unreadable.length > 0) {
    const shown = state.unreadable.slice(0, 5).join(", ")
    warnings.push(
      `読めなかったディレクトリを ${String(state.unreadable.length)} 件スキップしました(${shown})。`
    )
  }

  const packageJsonRaw = readJsonFile(path.join(root, "package.json"))
  const packageJsonExists = fileExists(path.join(root, "package.json"))
  const packageJson = isPlainObject(packageJsonRaw) ? packageJsonRaw : null
  if (packageJsonExists && packageJson === null) {
    warnings.push(
      "package.json を JSON として読めなかったため、依存とコマンドを収集できませんでした。"
    )
  }

  const packageManager = scanPackageManager(root, packageJson, warnings)
  const languages = scanLanguages(root, packageJson)
  const dependencies: DependencyFacts = {
    source: packageJson === null ? null : "package.json",
    dependencies: toDependencyEntries(packageJson?.dependencies),
    devDependencies: toDependencyEntries(packageJson?.devDependencies)
  }
  const { scripts, commands } = scanScripts(packageJson, packageManager.name)
  const testFrameworks = scanTestFrameworks(root, state, dependencies)
  const domainCandidates = scanDomainCandidates(state)
  const documents = scanDocuments(root, limits, truncation)

  if (truncation.walk) {
    truncation.notes.push(
      `ディレクトリ走査を ${String(limits.maxEntries)} エントリで打ち切りました。`
    )
  }
  if (truncation.files) {
    truncation.notes.push(
      `ファイル一覧を ${String(limits.maxFiles)} 件で打ち切りました。`
    )
  }
  if (truncation.tree) {
    truncation.notes.push(
      `ツリーを ${String(limits.maxTreeEntries)} エントリで打ち切りました。`
    )
  }
  if (truncation.testFiles) {
    truncation.notes.push(
      `テストファイルの検出を ${String(limits.maxTestFiles)} 件で打ち切りました。`
    )
  }
  if (truncation.documents) {
    truncation.notes.push(
      `見出しを読む文書を ${String(limits.maxDocuments)} 件で打ち切りました。`
    )
  }

  return {
    root,
    packageManager,
    languages,
    dependencies,
    scripts,
    commands,
    tree: state.tree,
    files: state.files,
    fileCount: state.fileCount,
    testFrameworks,
    domainCandidates,
    documents,
    truncation,
    warnings
  }
}

/**
 * コードベースから決定的に取れる事実を収集する(設計書 §9-1)。
 *
 * 推測も文章生成もしない。**例外を投げない。**
 * 読めないディレクトリ・壊れた JSON はスキップして続行し、理由を `warnings` に積む。
 * 走査の打ち切り上限に当たった場合は `truncation` に載せる。
 */
export function scan(startDir?: string, options: ScanOptions = {}): ScanResult {
  try {
    return scanInner(startDir, options)
  } catch (error) {
    let root: string
    try {
      root = options.root ?? path.resolve(startDir ?? process.cwd())
    } catch {
      root = options.root ?? startDir ?? "."
    }
    const reason = error instanceof Error ? error.message : String(error)
    return {
      root,
      packageManager: {
        name: null,
        lockfiles: [],
        packageManagerField: null
      },
      languages: [],
      dependencies: { source: null, dependencies: [], devDependencies: [] },
      scripts: [],
      commands: [],
      tree: [],
      files: [],
      fileCount: 0,
      testFrameworks: {
        configs: [],
        fromDependencies: [],
        filePatterns: [],
        directories: []
      },
      domainCandidates: [],
      documents: [],
      truncation: {
        walk: false,
        files: false,
        tree: false,
        testFiles: false,
        documents: false,
        notes: []
      },
      warnings: [`コードベースの走査に失敗しました: ${reason}`]
    }
  }
}

// ---------------------------------------------------------------------------
// diffArchitecture
// ---------------------------------------------------------------------------

const FINDING_ORDER: Record<DiffFindingKind, number> = {
  section_missing: 0,
  tech_stack_added: 1,
  tech_stack_removed: 2,
  command_added: 3,
  command_removed: 4,
  directory_undocumented: 5,
  directory_stale: 6,
  domain_gap: 7,
  domain_dead_glob: 8
}

function normalizeSections(
  sections: ArchitectureSections
): Map<string, string> {
  const map = new Map<string, string>()
  if (Array.isArray(sections)) {
    for (const section of sections) {
      if (section === null || typeof section !== "object") continue
      const heading = String(section.heading ?? "").trim()
      if (heading === "") continue
      // 同名の見出しが複数あるときは最初のものを採る(契約 §4-2)。
      if (map.has(heading)) continue
      map.set(heading, String(section.body ?? ""))
    }
    return map
  }
  if (isPlainObject(sections)) {
    for (const [heading, body] of Object.entries(sections)) {
      const key = heading.trim()
      if (key === "") continue
      if (map.has(key)) continue
      map.set(key, typeof body === "string" ? body : "")
    }
  }
  return map
}

function diffTechStack(
  result: ScanResult,
  body: string | undefined,
  findings: DiffFinding[]
): void {
  const section = "技術スタック"
  if (body === undefined) return

  const declared = new Set<string>()
  for (const dep of [
    ...result.dependencies.dependencies,
    ...result.dependencies.devDependencies
  ]) {
    declared.add(dep.name)
    // 依存名が本文のどこかに現れていれば「記載あり」とみなす。
    if (!body.includes(dep.name)) {
      findings.push({
        kind: "tech_stack_added",
        section,
        subject: dep.name,
        detail: `package.json の依存 ${dep.name} が ## ${section} に記載されていません。`
      })
    }
  }

  // 逆向き。inline code の中で npm のパッケージ名の形をしたものだけを対象にする。
  // 散文の中の名前は決定的に取り出せないため見ない(意味的な突き合わせをしない)。
  const seen = new Set<string>()
  for (const token of extractInlineCode(body)) {
    if (seen.has(token)) continue
    seen.add(token)
    if (!looksLikePackageName(token)) continue
    if (NON_PACKAGE_TOKENS.has(token)) continue
    if (declared.has(token)) continue
    findings.push({
      kind: "tech_stack_removed",
      section,
      subject: token,
      detail: `## ${section} に書かれた ${token} が package.json の依存にありません。`
    })
  }
}

function diffCommands(
  result: ScanResult,
  body: string | undefined,
  findings: DiffFinding[]
): void {
  const section = "コマンド定義"
  if (body === undefined) return

  const scriptNames = new Set(result.scripts.map((s) => s.name))

  for (const command of result.commands) {
    const mentioned =
      body.includes(command.script) || body.includes(command.command)
    if (mentioned) continue
    findings.push({
      kind: "command_added",
      section,
      subject: command.script,
      detail: `package.json の scripts.${command.script}(${command.kind})が ## ${section} に記載されていません。`
    })
  }

  const re = /\b(?:pnpm|npm|yarn|bun)\s+(?:run\s+)?([A-Za-z0-9:_.-]+)/g
  const seen = new Set<string>()
  let m = re.exec(body)
  while (m !== null) {
    const name = m[1] ?? ""
    m = re.exec(body)
    if (name === "" || seen.has(name)) continue
    seen.add(name)
    if (PACKAGE_MANAGER_SUBCOMMANDS.has(name)) continue
    if (scriptNames.has(name)) continue
    findings.push({
      kind: "command_removed",
      section,
      subject: name,
      detail: `## ${section} に書かれたコマンド ${name} が package.json の scripts にありません。`
    })
  }
}

function diffDirectories(
  result: ScanResult,
  body: string | undefined,
  findings: DiffFinding[]
): void {
  const section = "ディレクトリ構成と責務"
  if (body === undefined) return

  for (const entry of result.tree) {
    if (entry.type !== "directory" || entry.depth !== 1) continue
    if (body.includes(entry.path)) continue
    findings.push({
      kind: "directory_undocumented",
      section,
      subject: entry.path,
      detail: `トップレベルのディレクトリ ${entry.path} が ## ${section} に記載されていません。`
    })
  }

  const existing = new Set<string>()
  for (const entry of result.tree) {
    if (entry.type === "directory") existing.add(entry.path)
  }
  const seen = new Set<string>()
  for (const raw of extractInlineCode(body)) {
    const token = raw.replace(/\/+$/, "")
    if (token === "" || seen.has(token)) continue
    seen.add(token)
    // ワイルドカードを含むものは保護パス等の glob なので見ない。
    if (/[*?[\]{}]/.test(token)) continue
    if (!/^[A-Za-z0-9._-]+(\/[A-Za-z0-9._-]+)*$/.test(token)) continue
    if (!token.includes("/")) continue
    if (existing.has(token)) continue
    // ツリーは maxDepth までしか持たない。それより深いパスは「実在しない」と
    // 断定できないため候補にしない(決定的でない検出をしない)。
    if (token.split("/").length > DEFAULT_SCAN_LIMITS.maxDepth) continue
    // ファイルとして実在するものは対象外。
    if (result.files.includes(token)) continue
    findings.push({
      kind: "directory_stale",
      section,
      subject: token,
      detail: `## ${section} に書かれた ${token} が実在しません。`
    })
  }
}

function diffDomains(
  result: ScanResult,
  domains: Record<string, string[]> | null | undefined,
  findings: DiffFinding[],
  skipped: string[]
): void {
  const section = "ドメインマップ"
  if (domains === undefined || domains === null) {
    skipped.push(
      "ドメインマップの穴・死んだ glob: metatron:domains の抽出結果が渡されていないため検出しませんでした。"
    )
    return
  }

  const globs: Array<{ domain: string; glob: string; re: RegExp }> = []
  for (const [domain, patterns] of Object.entries(domains)) {
    if (!Array.isArray(patterns)) continue
    for (const glob of patterns) {
      if (typeof glob !== "string" || glob === "") continue
      globs.push({ domain, glob, re: globToRegExp(glob) })
    }
  }

  // 穴: 実在するソースディレクトリのうち、配下のどのファイルもどの glob に
  // 一致しないもの。サンプルが 1 件も無い(空ディレクトリ)ものは判定しない。
  for (const candidate of result.domainCandidates) {
    if (candidate.samplePaths.length === 0) continue
    const covered = candidate.samplePaths.some((file) =>
      globs.some((g) => g.re.test(file))
    )
    if (covered) continue
    findings.push({
      kind: "domain_gap",
      section,
      subject: candidate.path,
      detail: `${candidate.path}(ファイル ${String(candidate.fileCount)} 件)が metatron:domains のどの glob にも一致しません。`
    })
  }

  // 死んだ glob: どのファイルにも一致しないもの。
  // ファイル一覧が打ち切られていると「一致しない」が事実にならないため検出しない。
  if (result.truncation.files || result.truncation.walk) {
    skipped.push(
      "ドメインマップの死んだ glob: ファイル走査が打ち切り上限に達したため検出しませんでした。"
    )
    return
  }
  for (const g of globs) {
    if (result.files.some((file) => g.re.test(file))) continue
    findings.push({
      kind: "domain_dead_glob",
      section,
      subject: g.glob,
      detail: `ドメイン ${g.domain} の glob ${g.glob} がどのファイルにも一致しません。`
    })
  }
}

function diffArchitectureInner(
  input: DiffArchitectureInput
): DiffArchitectureResult {
  const findings: DiffFinding[] = []
  const skipped: string[] = []
  const warnings: string[] = []

  const sections = normalizeSections(input.sections)
  const exists = input.architectureExists ?? sections.size > 0

  for (const heading of ARCHITECTURE_SECTIONS) {
    if (exists && sections.has(heading)) continue
    findings.push({
      kind: "section_missing",
      section: heading,
      subject: heading,
      detail: exists
        ? `## ${heading} が ARCHITECTURE にありません。`
        : `ARCHITECTURE が無いため ## ${heading} もありません。`
    })
  }

  if (input.scan.dependencies.source === null) {
    skipped.push(
      "技術スタック / コマンドの突き合わせ: package.json を読めなかったため検出しませんでした。"
    )
  } else {
    diffTechStack(input.scan, sections.get("技術スタック"), findings)
    diffCommands(input.scan, sections.get("コマンド定義"), findings)
  }

  diffDirectories(input.scan, sections.get("ディレクトリ構成と責務"), findings)
  diffDomains(input.scan, input.domains, findings, skipped)

  // 決定的に検出できないため、この関数では扱わない項目(設計書 §9-3)。
  skipped.push(
    "保護パスの不整合: raguel.config.yaml の解析を伴うため、この関数では検出しません。"
  )
  skipped.push(
    "ADR の状態の陳腐化: ADR の解析(adr.ts)を伴うため、この関数では検出しません。"
  )

  findings.sort(
    (a, b) =>
      FINDING_ORDER[a.kind] - FINDING_ORDER[b.kind] ||
      compareStrings(a.subject, b.subject)
  )

  return { findings, skipped, warnings }
}

/**
 * `scan()` の結果と現行 ARCHITECTURE を突き合わせ、乖離候補を返す(設計書 §9-3)。
 *
 * **ファイルの読み取りとセクション分解は呼び出し元(CLI)の責務**であり、
 * この関数はセクション本文の文字列と、抽出済みの `metatron:domains` を受け取る。
 * architecture.ts に依存しない。
 *
 * 決定的に検出できるものだけを候補に出す。散文の内容が実装と食い違うといった
 * 意味的な乖離は候補に出さない。**例外を投げない。**
 */
export function diffArchitecture(
  input: DiffArchitectureInput
): DiffArchitectureResult {
  try {
    return diffArchitectureInner(input)
  } catch (error) {
    const reason = error instanceof Error ? error.message : String(error)
    return {
      findings: [],
      skipped: [],
      warnings: [`乖離候補の算出に失敗しました: ${reason}`]
    }
  }
}
