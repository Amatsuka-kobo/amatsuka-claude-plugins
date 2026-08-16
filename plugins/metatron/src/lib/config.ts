// metatron.config.json の読み取りと、文書パスの解決。
//
// 規則の正本はファイル契約
// `harness-docs/design/2026-08-16-file-contract-freeze.md` の §2(設定スキーマ)と
// §3(ルート解決とパス解決の規則)。このファイルはその契約の**正本の実装**である。
//
// 同じ規則の写しを codiel(`plugins/codiel/src/hooks/lib.ts` の findDocRoot /
// resolveDocPaths)と sandalphon(`plugins/sandalphon/src/check-intent-env.ts`)が
// 独立に持つ。ここを変えたら両方を追随させ、契約 §13 の 3 者比較テストを通すこと。
//
// この層は第 2 層(機構自身の動作)であり、フェイルオープンする。
// どんな異常環境でも例外を投げず、既定値へ落として warnings に理由を積む。

import { spawnSync } from "node:child_process"
import fs from "node:fs"
import path from "node:path"

export const CONFIG_FILENAME = "metatron.config.json"
export const SUPPORTED_VERSION = 1

export const DEFAULT_ARCHITECTURE_PATH = "docs/ARCHITECTURE.md"
export const DEFAULT_GOTCHAS_PATH = "docs/GOTCHAS.md"
export const DEFAULT_INJECTION_ENABLED = true
export const DEFAULT_GOTCHAS_RECENT_COUNT = 5
export const DEFAULT_MAX_CHARS = 9000

export interface InjectionConfig {
  enabled: boolean
  gotchasRecentCount: number
  maxChars: number
}

export interface ResolvedConfig {
  /** 契約 §3 規則 1 で解決したルート(絶対パス)。 */
  docRoot: string
  /** 設定ファイルが置かれる(または置かれるはずの)絶対パス。 */
  configPath: string
  /** 設定ファイルが存在したか。存在しないことは異常ではなく、警告も積まない。 */
  configExists: boolean
  /** ARCHITECTURE の絶対パス。 */
  architecturePath: string
  /** GOTCHAS の絶対パス。 */
  gotchasPath: string
  /** ARCHITECTURE の docRoot からの相対パス(区切りは常に "/")。 */
  architectureRelative: string
  /** GOTCHAS の docRoot からの相対パス(区切りは常に "/")。 */
  gotchasRelative: string
  injection: InjectionConfig
  /** 既定値へ落とした理由・設定を読めなかった理由。空配列が正常。 */
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

// 契約 §3 規則 1 の段 1 の判定。存在チェックだけで行う(種別を見ない)。
// 3 実装がこの 1 行を同じ形で持つことが一致の条件なので、条件を増やさない。
function hasConfigFile(dir: string): boolean {
  try {
    return fs.existsSync(path.join(dir, CONFIG_FILENAME))
  } catch {
    return false
  }
}

// 契約 §3 規則 1 の段 2。必ず `git rev-parse --show-toplevel` を実行して得る。
// `.git` の手作業探索で代替しない(worktree の .git ファイル形式や
// GIT_CEILING_DIRECTORIES の挙動を再現できず、実装間で結果が割れるため)。
// git 未インストール(ENOENT で status が null)・git 管理外(exit 128)・
// タイムアウト・その他の非 0 終了は、原因を区別せず「無かった」として扱う。
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
 * 契約 §3 規則 1: ルート解決。
 *
 * 1. `metatron.config.json` を持つ最も近い祖先ディレクトリ(開始ディレクトリ自身を含む)
 * 2. 無ければ `git rev-parse --show-toplevel`
 * 3. それも無ければ開始ディレクトリ
 *
 * 探索の前に開始ディレクトリを `fs.realpathSync` で実体パスへ解決する。段 2 が実体パスを
 * 返すため、段 1 を文字列操作だけで辿るとシンボリックリンク越しの起動で両者が別の
 * ディレクトリ木を辿り、実装間で docRoot が食い違う。
 */
export function findDocRoot(startDir?: string): string {
  const start = realpathOrSelf(path.resolve(startDir ?? process.cwd()))

  // 段 1: 開始ディレクトリ自身を候補に含める(inclusive)。
  let dir = start
  while (true) {
    if (hasConfigFile(dir)) return dir
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

function toPosix(value: string): string {
  return value.split(path.sep).join("/")
}

interface ResolvedPath {
  relative: string
  absolute: string
}

// 契約 §3 規則 2・規則 3。
// 絶対パスとルート外への脱出は拒否し、その項目だけ既定値に落として理由を積む。
function resolveConfiguredPath(
  docRoot: string,
  raw: unknown,
  fallback: string,
  label: string,
  warnings: string[]
): ResolvedPath {
  const useFallback = (): ResolvedPath => ({
    relative: fallback,
    absolute: path.resolve(docRoot, fallback)
  })

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
      `paths.${label} が絶対パス(${raw})のため、既定値 ${fallback} を使用します。` +
        `マシン固有の絶対パスはリポジトリの可搬性を失わせるため受け付けません。`
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

  return { relative: toPosix(relative), absolute }
}

// 個々のキーの型不整合は「壊れた JSON」ではなく、その項目だけ既定値に落とす(契約 §2)。
function resolveBoolean(
  raw: unknown,
  fallback: boolean,
  label: string,
  warnings: string[]
): boolean {
  if (raw === undefined) return fallback
  if (typeof raw !== "boolean") {
    warnings.push(
      `${label} が真偽値でないため、既定値 ${String(fallback)} を使用します。`
    )
    return fallback
  }
  return raw
}

function resolveNumber(
  raw: unknown,
  fallback: number,
  label: string,
  min: number,
  warnings: string[]
): number {
  if (raw === undefined) return fallback
  if (
    typeof raw !== "number" ||
    !Number.isFinite(raw) ||
    !Number.isInteger(raw) ||
    raw < min
  ) {
    warnings.push(
      `${label} が ${min} 以上の整数でないため、既定値 ${String(fallback)} を使用します。`
    )
    return fallback
  }
  return raw
}

function defaultsFor(docRoot: string, warnings: string[]): ResolvedConfig {
  return {
    docRoot,
    configPath: path.join(docRoot, CONFIG_FILENAME),
    configExists: false,
    architecturePath: path.resolve(docRoot, DEFAULT_ARCHITECTURE_PATH),
    gotchasPath: path.resolve(docRoot, DEFAULT_GOTCHAS_PATH),
    architectureRelative: DEFAULT_ARCHITECTURE_PATH,
    gotchasRelative: DEFAULT_GOTCHAS_PATH,
    injection: {
      enabled: DEFAULT_INJECTION_ENABLED,
      gotchasRecentCount: DEFAULT_GOTCHAS_RECENT_COUNT,
      maxChars: DEFAULT_MAX_CHARS
    },
    warnings
  }
}

function loadConfigInner(startDir?: string): ResolvedConfig {
  const warnings: string[] = []
  const docRoot = findDocRoot(startDir)
  const configPath = path.join(docRoot, CONFIG_FILENAME)

  let configExists = false
  let parsed: unknown
  let parseOk = false
  try {
    if (fs.existsSync(configPath)) {
      configExists = true
      parsed = JSON.parse(fs.readFileSync(configPath, "utf8"))
      parseOk = true
    }
  } catch {
    // 「設定ファイルが無い」は警告にしないが、「あるのに読めなかった」は 1 行添える。
    warnings.push("設定を読めなかったため既定値を使用します。")
  }

  // 契約 §2: 構文エラーだけでなく、トップレベルがオブジェクトでない場合
  // (配列・null・数値・文字列)も「壊れた JSON」に含める。
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

  // 契約 §2: version が未知の値なら全項目を既定値扱いにし、警告を 1 行添える。
  if (source !== undefined) {
    const version = source.version
    if (version !== undefined && version !== SUPPORTED_VERSION) {
      warnings.push(
        `設定の version(${JSON.stringify(version)})が未知のため、全項目に既定値を使用します。`
      )
      source = undefined
    }
  }

  const pathsRaw = source?.paths
  const paths = isPlainObject(pathsRaw) ? pathsRaw : undefined
  if (pathsRaw !== undefined && paths === undefined) {
    warnings.push(
      "paths がオブジェクトでないため、文書パスに既定値を使用します。"
    )
  }

  const architecture = resolveConfiguredPath(
    docRoot,
    paths?.architecture,
    DEFAULT_ARCHITECTURE_PATH,
    "architecture",
    warnings
  )
  const gotchas = resolveConfiguredPath(
    docRoot,
    paths?.gotchas,
    DEFAULT_GOTCHAS_PATH,
    "gotchas",
    warnings
  )

  const injectionRaw = source?.injection
  const injection = isPlainObject(injectionRaw) ? injectionRaw : undefined
  if (injectionRaw !== undefined && injection === undefined) {
    warnings.push("injection がオブジェクトでないため、既定値を使用します。")
  }

  // 未知キー($schema を含む)は無視する。エラーにしない(契約 §2)。
  return {
    docRoot,
    configPath,
    configExists,
    architecturePath: architecture.absolute,
    gotchasPath: gotchas.absolute,
    architectureRelative: architecture.relative,
    gotchasRelative: gotchas.relative,
    injection: {
      enabled: resolveBoolean(
        injection?.enabled,
        DEFAULT_INJECTION_ENABLED,
        "injection.enabled",
        warnings
      ),
      gotchasRecentCount: resolveNumber(
        injection?.gotchasRecentCount,
        DEFAULT_GOTCHAS_RECENT_COUNT,
        "injection.gotchasRecentCount",
        0,
        warnings
      ),
      maxChars: resolveNumber(
        injection?.maxChars,
        DEFAULT_MAX_CHARS,
        "injection.maxChars",
        1,
        warnings
      )
    },
    warnings
  }
}

/**
 * 設定の読み取りとパス解決。契約 §2・§3 の実装。
 *
 * 解決結果はキャッシュしない(契約 §3 規則 4)。
 * 例外を投げない。どんな異常環境でも既定値へ落として warnings に理由を積む。
 */
export function loadConfig(startDir?: string): ResolvedConfig {
  try {
    return loadConfigInner(startDir)
  } catch {
    let docRoot: string
    try {
      docRoot = path.resolve(startDir ?? process.cwd())
    } catch {
      docRoot = startDir ?? "."
    }
    return defaultsFor(docRoot, [
      "設定の解決に失敗したため既定値を使用します。"
    ])
  }
}
