/**
 * 設定の読込・深マージ・検証・configHash 算出と、ファイルが変わったときの読み直し。
 * 解決順: 環境変数 RAGUEL_CONFIG のパス → cwd/raguel.config.yaml → 内蔵デフォルトのみ。
 * ファイルが存在するのに読めない・パースできない・zod 検証に落ちる場合は throw する
 * (フェイルクローズド。黙ってデフォルトに落ちない)。
 */

import { createHash } from "node:crypto"
import { existsSync, readFileSync, statSync } from "node:fs"
import { homedir } from "node:os"
import { isAbsolute, resolve } from "node:path"
import { parse as parseYaml } from "yaml"
import { assertInvariants } from "../core/invariants"
import { log } from "../core/log"
import type { LoadedConfig, RaguelConfig } from "../core/types"
import { defaultConfig } from "./defaults"
import { configSchema } from "./schema"

const CWD_CONFIG_FILENAME = "raguel.config.yaml"

export function loadConfig(): LoadedConfig {
  const { raw, source } = resolveRawConfig()
  const merged = withProtectedGlobsUnion(deepMerge(defaultConfig, raw))

  const result = configSchema.safeParse(merged)
  if (!result.success) {
    throw new Error(
      `設定の検証に失敗しました(${source}): ${result.error.message}`
    )
  }

  assertInvariants(result.data)

  const config = withExpandedCasesDir(result.data)
  const configHash = computeConfigHash(config)

  log.info("設定を読み込みました", { source, configHash })

  return { config, configHash, source }
}

// ---- 設定ソースの解決 ----

interface RawConfigSource {
  raw: Record<string, unknown>
  source: string
}

/**
 * 設定の出所になりうるファイル。RAGUEL_CONFIG があればそのパス、無ければ cwd の raguel.config.yaml。
 * source はファイルから読んだときの値(`env:<パス>`・`cwd:<パス>`)である。
 */
export function configCandidate(): { path: string; source: string } {
  const envPath = process.env.RAGUEL_CONFIG
  if (envPath) return { path: envPath, source: `env:${envPath}` }
  const cwdPath = resolve(process.cwd(), CWD_CONFIG_FILENAME)
  return { path: cwdPath, source: `cwd:${cwdPath}` }
}

function resolveRawConfig(): RawConfigSource {
  const { path, source } = configCandidate()
  if (process.env.RAGUEL_CONFIG || existsSync(path)) {
    return { raw: readYamlFile(path), source }
  }
  return { raw: {}, source: "defaults" }
}

// ---- 読み直し(決定 83 の (3)) ----

/**
 * 呼ぶたびに設定の出所になりうるファイルのパス・有無・mtime を前回の読み込みと比べ、
 * 違えば loadConfig で読み直して build の結果を作り直す関数を返す。
 * 読み込みか build が失敗したら例外を投げ、前の結果には戻さない(次の呼び出しで読み直しを試す)。
 */
export function createConfigReloader<T>(
  build: (loaded: LoadedConfig) => T
): () => T {
  let stamp: string | undefined
  let current: T | undefined
  return () => {
    const next = configStamp()
    if (current === undefined || next !== stamp) {
      current = undefined // 失敗したら前の結果に戻さない
      current = build(loadConfig())
      stamp = next
    }
    return current
  }
}

function configStamp(): string {
  const { path } = configCandidate()
  const stat = statSync(path, { throwIfNoEntry: false })
  return JSON.stringify([path, stat ? stat.mtimeMs : null])
}

function readYamlFile(path: string): Record<string, unknown> {
  let text: string
  try {
    text = readFileSync(path, "utf8")
  } catch (err) {
    throw new Error(
      `設定ファイルを読み込めません: ${path} (${(err as Error).message})`
    )
  }

  let parsed: unknown
  try {
    parsed = parseYaml(text)
  } catch (err) {
    throw new Error(
      `設定ファイルの YAML パースに失敗しました: ${path} (${(err as Error).message})`
    )
  }

  if (parsed === null || parsed === undefined) return {}
  if (typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new Error(
      `設定ファイルのルートはオブジェクトである必要があります: ${path}`
    )
  }
  return parsed as Record<string, unknown>
}

// ---- 深マージ(オブジェクトは再帰マージ、配列はユーザー値で置換、undefined はデフォルト維持) ----

function deepMerge(base: unknown, override: unknown): unknown {
  if (override === undefined) return base
  if (Array.isArray(override)) return override
  if (isPlainObject(base) && isPlainObject(override)) {
    const result: Record<string, unknown> = { ...base }
    for (const key of Object.keys(override)) {
      const overrideValue = override[key]
      if (overrideValue === undefined) continue
      result[key] = deepMerge(base[key], overrideValue)
    }
    return result
  }
  return override
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value)
}

// ---- code/protected-paths の globs は既定値との和集合(決定 83 の (3)) ----

const PROTECTED_PATHS_RULE = "code/protected-paths"

/**
 * sealed の保護パスは、利用者の設定で既定の glob を消せないようにする。
 * ほかの配列は deepMerge のとおりユーザー値で置き換える。
 */
function withProtectedGlobsUnion(merged: unknown): unknown {
  if (!isPlainObject(merged) || !isPlainObject(merged.rules)) return merged
  const settings = merged.rules[PROTECTED_PATHS_RULE]
  const defaults = defaultConfig.rules[PROTECTED_PATHS_RULE]?.globs
  if (
    !isPlainObject(settings) ||
    !Array.isArray(settings.globs) ||
    !Array.isArray(defaults)
  ) {
    return merged
  }
  return {
    ...merged,
    rules: {
      ...merged.rules,
      [PROTECTED_PATHS_RULE]: {
        ...settings,
        globs: [...new Set([...defaults, ...settings.globs])]
      }
    }
  }
}

// ---- casesDir の ~ 展開(os.homedir() を使い絶対パス化) ----

function withExpandedCasesDir(config: RaguelConfig): RaguelConfig {
  return {
    ...config,
    storage: {
      ...config.storage,
      casesDir: expandHome(config.storage.casesDir)
    }
  }
}

function expandHome(path: string): string {
  let expanded = path
  if (path === "~") {
    expanded = homedir()
  } else if (path.startsWith("~/")) {
    expanded = resolve(homedir(), path.slice(2))
  }
  return isAbsolute(expanded) ? expanded : resolve(expanded)
}

// ---- configHash(マージ後設定をキーソートで正規化した JSON の sha256 hex) ----

function computeConfigHash(config: RaguelConfig): string {
  const normalized = normalizeForHash(config)
  return createHash("sha256").update(JSON.stringify(normalized)).digest("hex")
}

function normalizeForHash(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(normalizeForHash)
  if (isPlainObject(value)) {
    const sortedKeys = Object.keys(value).sort()
    const result: Record<string, unknown> = {}
    for (const key of sortedKeys) {
      result[key] = normalizeForHash(value[key])
    }
    return result
  }
  return value
}
