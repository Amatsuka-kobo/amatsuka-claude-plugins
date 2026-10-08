#!/usr/bin/env node
// intent の聞き取りと issue の起票に要る環境の事実を JSON で stdout に出力する。
// 判断はスキルが行い、このスクリプトは常に exit 0 で終わる。
//
// このスクリプトは**読み取り専用**である。ファイルもディレクトリも作らず、更新もしない。
// `docs/intents/` の作成と intent 文書の `status` の更新はスキルが行う
// (検出のたびにファイルが変わる副作用を持たせないため)。
//
// 使い方: node check-intent-env.mjs [projectDir]
//
// 文書のルート(docRoot)と ARCHITECTURE / GOTCHAS のパスの解決、ドメインマップの読み取りは
// `hooks/lib.ts` の findDocRoot / resolveDocPaths / readDomainsResult に任せ、ここに写しを持たない。
// 規則の正本は metatron の `src/lib/config.ts` と `src/lib/architecture.ts` で、
// lib.ts との一致は契約 §14 の 2 者比較テストが確かめる。
//
// 基準は 2 つあり、どちらか一方に寄せない。
//   - intent 文書(docs/intents/)と Issue テンプレート : repoRoot(git ルート)
//   - ARCHITECTURE / GOTCHAS のパスと contextDocs      : docRoot(契約 §3 規則 1)
// 2 つが別のディレクトリを指すのは正常な状態であり、フィールド名で区別する。
import { spawnSync } from "node:child_process"
import fs from "node:fs"
import path from "node:path"
import {
  readDomainsResult,
  resolveDocPaths,
  resolveRulesDir
} from "./hooks/lib.js"

const GIT_TIMEOUT_MS = 5000

// ADR と GOTCHAS の記録を有効にする環境変数。値を trim して小文字にし、1 / true / on のどれかなら有効。
// metatron の src/lib/features.ts と同じ規則を独立に持つ(値域のずれは 2 者比較テストが確かめる)。
const ENABLE_VALUES = new Set(["1", "true", "on"])
function featureEnabled(env: NodeJS.ProcessEnv, name: string): boolean {
  return ENABLE_VALUES.has((env[name] ?? "").trim().toLowerCase())
}
function readKnowledgeRecording(env: NodeJS.ProcessEnv): {
  adr: boolean
  gotchas: boolean
} {
  return {
    adr: featureEnabled(env, "AMATSUKA_METATRON_ENABLE_ADR"),
    gotchas: featureEnabled(env, "AMATSUKA_METATRON_ENABLE_GOTCHAS")
  }
}

// ---------------------------------------------------------------------------
// ファイルシステムの安全なラッパ(失敗は既定値へ落とし、例外を外へ出さない)
// ---------------------------------------------------------------------------

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

function isReadableDir(target: string): boolean {
  if (!isDir(target)) return false
  try {
    fs.accessSync(target, fs.constants.R_OK | fs.constants.X_OK)
    return true
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

// ---------------------------------------------------------------------------
// 開始ディレクトリと git
// ---------------------------------------------------------------------------

// 引数(無ければ `process.cwd()`)を絶対パスにしたもの。実体パスへの解決は findDocRoot が行う。
// git の探索には論理パスのまま渡してよい(`--show-toplevel` は実体パスを返す)。
function resolveStartDir(): string {
  try {
    return path.resolve(process.argv[2] ?? process.cwd())
  } catch {
    return process.argv[2] ?? "."
  }
}

const startDir = resolveStartDir()

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
const gitToplevel = git("rev-parse", "--show-toplevel")
const repoRoot = isGitRepo && gitToplevel ? path.resolve(gitToplevel) : null
const remoteUrl = isGitRepo ? git("remote", "get-url", "origin") : null

// SSH (git@host:owner/repo.git) と HTTPS (https://host/owner/repo) の両形式からホストと
// owner/repo を抽出する。repoSlug を返すのは github.com と <名前>.ghe.com のホストだけ
// (notgithub.com 等の部分一致、GHES の独自ドメインは弾く)。remoteHost にはリモートの種類を
// 問わず抽出したホスト名を入れる(決定 46)。
// gh-utility の check-issue-env.ts と同一の正規表現(挙動をリポジトリ内で揃える)。
const remoteMatch = remoteUrl?.match(
  /^(?:git@|ssh:\/\/git@|https?:\/\/)([^/:]+)[/:]([^/]+\/[^/]+?)(?:\.git)?\/?$/
)
const remoteHost = remoteMatch?.[1] ?? null
const isGithubHost =
  remoteHost !== null && /^(?:github\.com|[^./]+\.ghe\.com)$/.test(remoteHost)
const repoSlug = isGithubHost ? (remoteMatch?.[2] ?? null) : null

// gh 未インストール時、spawnSync は ENOENT で status: null を返す(例外は投げない)
function ghExitZero(args: string[]): boolean {
  try {
    return spawnSync("gh", args, { encoding: "utf8" }).status === 0
  } catch {
    return false
  }
}

const ghInstalled = ghExitZero(["--version"])
// remoteHost が分かればホストを固定して認証を確かめ、無ければ現行どおりホスト指定なしで確かめる。
const ghAuthenticated =
  ghInstalled &&
  ghExitZero(
    remoteHost
      ? ["auth", "status", "--hostname", remoteHost]
      : ["auth", "status"]
  )

// gh --version の出力(例 "gh version 2.99.0 (2026-09-01)")からバージョン番号を取り出す。
// 未導入・パース失敗は null。
function ghVersionOf(): string | null {
  if (!ghInstalled) return null
  try {
    const res = spawnSync("gh", ["--version"], { encoding: "utf8" })
    return res.stdout?.match(/gh version (\d+\.\d+\.\d+)/)?.[1] ?? null
  } catch {
    return null
  }
}

const ghVersion = ghVersionOf()

// x.y.z 形式のバージョン文字列を比較する(a が b 以上なら true)。
function versionGte(a: string, b: string): boolean {
  const pa = a.split(".").map(Number)
  const pb = b.split(".").map(Number)
  for (let i = 0; i < Math.max(pa.length, pb.length); i++) {
    const diff = (pa[i] ?? 0) - (pb[i] ?? 0)
    if (diff !== 0) return diff > 0
  }
  return true
}

// --attach は 2.99.0 以上で、かつ origin のホストが github.com か *.ghe.com のときだけ使える
// (画像の載せ方 §6.12.4)。判定は事実だけを返し、imageUpload の決定はスキルが行う。
const ghAttachSupported =
  ghVersion !== null && versionGte(ghVersion, "2.99.0") && isGithubHost

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
// docRoot・文書パス・ドメインマップ(hooks/lib.ts に任せる)
// ---------------------------------------------------------------------------

// docRoot は resolveDocPaths が内部で findDocRoot を呼んで得た値を使う。
// 別に呼ぶと、文書パスと docRoot が別々の解決結果になりうるため。
const docPaths = resolveDocPaths(startDir)
const docRoot = docPaths.docRoot
// 存在するファイルだけを返す(ディレクトリや未作成のパスは null)。
const architecturePath = isFile(docPaths.architecture)
  ? docPaths.architecture
  : null
const gotchasPath = isFile(docPaths.gotchas) ? docPaths.gotchas : null
// metatron の rules ディレクトリがあり、中を読めるか。knowledgeTarget の判定に使う。
// 読めないディレクトリを true にすると、metatron へ写すと決めた後に写せない。
const metatronRules = isReadableDir(resolveRulesDir(startDir).rulesDir)

const domains = readDomainsResult(startDir)
// 契約 §1: 警告は経路を問わず返す。読み取り専用のこのスクリプトも黙って落とさない。
// configWarnings は「既定値へ落とした理由」と文書構造の指摘を 1 本で返す。
const configWarnings = [...docPaths.warnings, ...domains.warnings]

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
  intent: string
}

// 契約 §8-2: YAML パーサを導入せず、`---` で挟まれた先頭ブロックのトップレベルキーだけを
// 行単位で抽出する。値は前後の空白を除いた文字列で、引用符は剥がさない。
// frontmatter を切り出せない・`intent` キーが無いファイルは intent 文書として解釈できない
// ものとして existingIntents から落として続行する。
// intent 用の読み取りは、リスト(`  - item`)を項目値として読まず、閉じ区切りを
// `---` だけの行(末尾の空白は許す)に限る(`intent-format.md` の frontmatter の規則)。
function parseIntentTopLevel(block: string): Record<string, string> {
  const top: Record<string, string> = {}
  for (const line of block.split("\n")) {
    const m = line.match(/^([A-Za-z_][\w-]*):\s*(.*)$/)
    if (m) top[m[1]] = m[2].trim()
  }
  return top
}

function parseIntentDoc(file: string, content: string): IntentSummary | null {
  const block = content.match(
    /^---\r?\n([\s\S]*?)\r?\n---[ \t]*(?:\r?\n|$)/
  )?.[1]
  if (block === undefined) return null
  const top = parseIntentTopLevel(block.replace(/\r/g, ""))
  if (top.intent === undefined) return null
  const title = content.match(/^# intent:\s*(.*)$/m)?.[1]?.trim() ?? null
  return {
    file,
    title: title === "" ? null : title,
    slug: top.slug ?? "",
    status: top.status ?? "",
    issue: top.issue ?? "",
    intent: top.intent
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
// ASIS 探索の初期材料(docRoot 直下の CLAUDE.md / README.md。ARCHITECTURE / GOTCHAS は含めない)
// ---------------------------------------------------------------------------

// 並びは capturing-intent の読む順(CLAUDE.md → README.md)に合わせる。
const contextDocs = [
  path.join(docRoot, "CLAUDE.md"),
  path.join(docRoot, "README.md")
].filter((p) => isFile(p))

// ---------------------------------------------------------------------------
// 出力(事実だけを返す。判断はスキルが行う)
// ---------------------------------------------------------------------------

console.log(
  JSON.stringify(
    {
      isGitRepo,
      repoRoot,
      remoteUrl,
      remoteHost,
      repoSlug,
      ghInstalled,
      ghVersion,
      ghAuthenticated,
      ghAttachSupported,
      templates,
      blankIssuesEnabled,
      docRoot,
      configWarnings,
      projectDocs: {
        architecture: architecturePath,
        gotchas: gotchasPath,
        metatronRules,
        domainsReadable: domains.domains !== null,
        domainCount: domains.domains ? Object.keys(domains.domains).length : 0
      },
      knowledgeRecording: readKnowledgeRecording(process.env),
      intentsDir,
      existingIntents,
      contextDocs
    },
    null,
    2
  )
)
