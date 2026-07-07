/**
 * 設定の読込・深マージ・検証・configHash 算出。
 * 解決順: 環境変数 RAGUEL_CONFIG のパス → cwd/raguel.config.yaml → 内蔵デフォルトのみ。
 * ファイルが存在するのに読めない・パースできない・zod 検証に落ちる場合は throw する
 * (フェイルクローズド。黙ってデフォルトに落ちない)。
 */

import { createHash } from "node:crypto"
import { existsSync, readFileSync } from "node:fs"
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
  const merged = deepMerge(defaultConfig, raw)

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

function resolveRawConfig(): RawConfigSource {
  const envPath = process.env.RAGUEL_CONFIG
  if (envPath) {
    return { raw: readYamlFile(envPath), source: `env:${envPath}` }
  }

  const cwdPath = resolve(process.cwd(), CWD_CONFIG_FILENAME)
  if (existsSync(cwdPath)) {
    return { raw: readYamlFile(cwdPath), source: `cwd:${cwdPath}` }
  }

  return { raw: {}, source: "defaults" }
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
