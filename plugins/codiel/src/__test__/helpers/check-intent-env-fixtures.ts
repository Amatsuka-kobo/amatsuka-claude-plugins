import { execFileSync } from "node:child_process"
import fs from "node:fs"
import os from "node:os"
import path from "node:path"
import { fileURLToPath } from "node:url"
import { expect } from "vitest"
// 契約 §14 / ケース 16f の 2 者比較のためだけの相対 import(テストコード限定)。
// codiel の実行時に metatron を参照することはない。
import { extractDomains } from "../../../../metatron/src/lib/architecture.js"
import { loadConfig } from "../../../../metatron/src/lib/config.js"
import {
  readDomains,
  readDomainsResult,
  resolveDocPaths
} from "../../hooks/lib.js"
import { runTs } from "../../testing/run-ts.js"

export const SCRIPT = fileURLToPath(
  new URL("../../check-intent-env.ts", import.meta.url)
)

export const mockEnv = (binDir: string) => ({
  ...process.env,
  PATH: `${binDir}${path.delimiter}${path.dirname(process.execPath)}`
})

// スクリプトを起動し stdout の JSON を返す。pathDirs 指定時は PATH を差し替える
// (gh / git の有無を擬似するため)
export function runScript(
  cwd: string,
  pathDirs?: string[],
  extra: Record<string, string> = {}
) {
  // PATH を指定しないときも実物の gh を見せない。gh auth status はネットワークに出て
  // 1 回 0.5 秒かかり、結果も環境で変わるため。git は実物を使う
  const dirs = pathDirs ?? [defaultBin()]
  const base = mockEnv(dirs.join(path.delimiter))
  const env: NodeJS.ProcessEnv = { ...base }
  Object.assign(env, extra)
  const stdout = runTs(SCRIPT, [cwd], { env })
  return JSON.parse(stdout)
}

// macOS では os.tmpdir() 自体がシンボリックリンクなので実体パスへ揃える
// (docRoot は開始ディレクトリを realpath で解決する。契約 §3 規則 1 の細目)
let gitOnlyBin: string | null = null
function defaultBin(): string {
  gitOnlyBin ??= fakeBin()
  return gitOnlyBin
}

export function tmpdir(): string {
  return fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "intent-env-")))
}

export function gitRepo(remoteUrl: string | null = null): string {
  const dir = tmpdir()
  execFileSync("git", ["init", "-q"], { cwd: dir })
  if (remoteUrl)
    execFileSync("git", ["remote", "add", "origin", remoteUrl], { cwd: dir })
  return dir
}

export function write(dir: string, relative: string, content: string): string {
  const target = path.join(dir, relative)
  fs.mkdirSync(path.dirname(target), { recursive: true })
  fs.writeFileSync(target, content)
  return target
}

export function mkdir(dir: string, relative: string): string {
  const target = path.join(dir, relative)
  fs.mkdirSync(target, { recursive: true })
  return target
}

export const DOMAINS_ARCHITECTURE = [
  "# ARCHITECTURE",
  "",
  "## ドメインマップ",
  "",
  "```json metatron:domains",
  '{ "frontend": ["src/app/**"], "backend": ["src/server/**"] }',
  "```",
  ""
].join("\n")

export const INTENT_DOC = (
  slug: string,
  status: string,
  issue: string,
  title: string,
  intentVersion: string = "v1"
): string =>
  [
    "---",
    `intent: ${intentVersion}`,
    `slug: ${slug}`,
    "created: 2026-08-16",
    `status: ${status}`,
    `issue: ${issue}`,
    "---",
    "",
    `# intent: ${title}`,
    "",
    "## ASIS",
    ""
  ].join("\n")

// PATH 制御用の bin ディレクトリ。スクリプトが spawn するのは git と gh のみ。
export function fakeBin({
  gh,
  git = true
}: {
  gh?: string
  git?: boolean
} = {}) {
  const dir = tmpdir()
  if (git) {
    const realGit = execFileSync("sh", ["-c", "command -v git"], {
      encoding: "utf8"
    }).trim()
    fs.symlinkSync(realGit, path.join(dir, "git"))
  }
  if (gh) {
    const file = path.join(dir, "gh")
    fs.writeFileSync(file, gh)
    fs.chmodSync(file, 0o755)
  }
  return dir
}

export const isRoot =
  typeof process.getuid === "function" && process.getuid() === 0

export function ensureFile(file: string): void {
  if (fs.existsSync(file)) return
  writeAt(file, DOMAINS_ARCHITECTURE)
}

// 絶対パスへ書く(write は「ルート + 相対パス」で、解決済みのパスには使えない)。
export function writeAt(file: string, content: string): void {
  fs.mkdirSync(path.dirname(file), { recursive: true })
  fs.writeFileSync(file, content)
}

// PATH を空にして関数を呼ぶ(子プロセス側は fakeBin({ git: false }) で同じ状態を作る)。
export function withoutGitBinary<T>(fn: () => T): T {
  const saved = process.env.PATH
  process.env.PATH = ""
  try {
    return fn()
  } finally {
    if (saved === undefined) delete process.env.PATH
    else process.env.PATH = saved
  }
}

export function expectTwoWayMatch(
  startDir: string,
  label: string,
  opts: { withoutGit?: boolean; architecture?: string } = {}
): void {
  const call = <T>(fn: () => T): T =>
    opts.withoutGit ? withoutGitBinary(fn) : fn()

  const metatron = call(() => loadConfig(startDir))
  const codiel = call(() => resolveDocPaths(startDir))

  expect(codiel.docRoot, `${label}: metatron と codiel の docRoot`).toBe(
    metatron.docRoot
  )
  expect(
    codiel.architecture,
    `${label}: metatron と codiel の architecture`
  ).toBe(metatron.architecturePath)
  expect(codiel.gotchas, `${label}: metatron と codiel の gotchas`).toBe(
    metatron.gotchasPath
  )
  expect(
    codiel.warnings.length > 0,
    `${label}: metatron と codiel の警告の有無`
  ).toBe(metatron.warnings.length > 0)
  expect(
    codiel.warnings.length,
    `${label}: metatron と codiel の警告の件数`
  ).toBe(metatron.warnings.length)

  // opts.architecture を渡した構成では、解決先へその中身を必ず置く(既存を上書きする)。
  // ドメインマップの形を指定して 2 実装の判定を突き合わせるための口である。
  if (opts.architecture !== undefined)
    writeAt(metatron.architecturePath, opts.architecture)
  else ensureFile(metatron.architecturePath)
  ensureFile(metatron.gotchasPath)

  // 2 実装が同じ ARCHITECTURE から同じドメイン定義を読むか(契約 §1・§4-2)。
  // **「読めたか」の真偽だけでは足りない。** 検証 4 項目のどれかを 1 実装だけが
  // 見ていなければ、同じ `{}` や `{"x":[]}` を片方だけが受け入れる割れになる。
  const architectureText = fs.readFileSync(metatron.architecturePath, "utf8")
  const metatronDomains = extractDomains(architectureText)
  const codielDomains = call(() => readDomainsResult(startDir))

  expect(
    codielDomains.domains,
    `${label}: metatron と codiel のドメイン定義`
  ).toStrictEqual(metatronDomains.ok ? metatronDomains.domains : null)
  expect(
    call(() => readDomains(startDir)) !== null,
    `${label}: codiel のドメインマップ可読性`
  ).toBe(metatronDomains.ok)
  // 重複ブロック・未閉フェンスの警告も揃える(契約 §1「警告は経路を問わず返す」)。
  // 文言までは求めず、有無と件数を突き合わせる(2 実装の同期コストを上げない)。
  expect(
    codielDomains.warnings.length,
    `${label}: metatron と codiel のドメイン警告の件数`
  ).toBe(metatronDomains.warnings.length)

  const script = runScript(
    startDir,
    opts.withoutGit ? [fakeBin({ git: false })] : undefined
  )
  expect(script.docRoot, `${label}: check-intent-env の docRoot`).toBe(
    metatron.docRoot
  )
  expect(
    script.projectDocs.architecture,
    `${label}: check-intent-env の architecture`
  ).toBe(metatron.architecturePath)
  expect(
    script.projectDocs.gotchas,
    `${label}: check-intent-env の gotchas`
  ).toBe(metatron.gotchasPath)
  // check-intent-env は設定の警告と文書構造の警告を configWarnings の 1 本で返すため、
  // 比較相手も metatron の両方(loadConfig + extractDomains)の合計にする。
  const expectedWarnings =
    metatron.warnings.length + metatronDomains.warnings.length
  expect(
    script.configWarnings.length > 0,
    `${label}: check-intent-env の警告の有無`
  ).toBe(expectedWarnings > 0)
  expect(
    script.configWarnings.length,
    `${label}: check-intent-env の警告の件数`
  ).toBe(expectedWarnings)

  expect(
    script.projectDocs.domainsReadable,
    `${label}: check-intent-env のドメインマップ可読性`
  ).toBe(metatronDomains.ok)
  // check-intent-env は定義そのものを返さない。突き合わせられるのは件数まで。
  expect(
    script.projectDocs.domainCount,
    `${label}: check-intent-env のドメイン件数`
  ).toBe(
    metatronDomains.ok ? Object.keys(metatronDomains.domains ?? {}).length : 0
  )
}

export const DUPLICATE_DOMAINS_ARCHITECTURE = [
  DOMAINS_ARCHITECTURE,
  "## ドメインマップ(重複)",
  "",
  "```json metatron:domains",
  '{ "data": ["db/**"] }',
  "```",
  ""
].join("\n")

export const UNCLOSED_DOMAINS_ARCHITECTURE = [
  "# ARCHITECTURE",
  "",
  "## ドメインマップ",
  "",
  "```json metatron:domains",
  '{ "frontend": ["src/app/**"] }',
  ""
].join("\n")
