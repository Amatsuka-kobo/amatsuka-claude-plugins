/**
 * 設定の読み込み・深いマージ・検証・configHash の算出と、ファイルが変わったときの読み直し(設計書 §6.12)。
 * 読む順: 環境変数 RAGUEL_CONFIG のパス(JSON) → プロジェクトルートの .codiel/config.json の raguel → 内蔵の既定値。
 * testsDir は RAGUEL_CONFIG を設定したときもプロジェクトルートの .codiel/config.json から読む(config/paths.ts)。
 * ファイルがあるのに読めない・JSON でない・検証に落ちる、のどれかは throw する
 * (フェイルクローズド。黙って既定値に落ちない)。
 */

import { createHash } from "node:crypto"
import { existsSync, readFileSync, statSync } from "node:fs"
import { resolve } from "node:path"
import { assertInvariants } from "../core/invariants"
import { log } from "../core/log"
import type {
  ConfigLoadResult,
  LoadedConfig,
  RaguelConfig
} from "../core/types"
import { resolveCasesDir, resolveProjectRoot } from "../project/root"
import {
  DEFAULT_PROTECTED_GLOBS,
  RETIRED_RULE_IDS,
  RULE_SPECS
} from "../rules/params"
import { defaultConfig } from "./defaults"
import { resolveTestsDir } from "./paths"
import { parseConfig } from "./schema"

const PROJECT_CONFIG_PATH = [".codiel", "config.json"]

/** 廃止したキー。path は raguel の値の中の位置で、`.` で区切る(ルール ID は `.` を含まない) */
const ABOLISHED_KEYS: readonly { path: string; reason: string }[] = [
  {
    path: "judge.canStop",
    reason: "パネルと meta は STOP を出せない。設定から削除してください。"
  },
  ...["trivial", "standard", "critical"].map((tier) => ({
    path: `panel.${tier}`,
    reason:
      "パネルの構成は tier ごとに固定で、設定では変えられない。設定から削除してください。"
  })),
  {
    path: "rules.common/resubmission-loop.stopAfter",
    reason:
      "再提出は ask の所見だけを出し、stop へ上げない。設定から削除してください。"
  }
]

function projectConfigPath(cwd: string): string {
  return resolve(resolveProjectRoot(cwd), ...PROJECT_CONFIG_PATH)
}

/**
 * 設定の出所になりうるファイル。RAGUEL_CONFIG があればそのパス、無ければプロジェクトルートの .codiel/config.json。
 * source はファイルから読んだときの値(`env:<パス>`・`cwd:<パス>`)である
 */
export function configCandidate(cwd: string = process.cwd()): {
  path: string
  source: string
} {
  const envPath = process.env.RAGUEL_CONFIG
  if (envPath) return { path: envPath, source: `env:${envPath}` }
  const path = projectConfigPath(cwd)
  return { path, source: `cwd:${path}` }
}

export function loadConfig(cwd: string = process.cwd()): LoadedConfig {
  const projectRoot = resolveProjectRoot(cwd)
  const { raw, source } = resolveRawConfig(cwd)
  assertNoRetiredKeys(raw, source)

  const parsed = parseConfig(deepMerge(defaultConfig, raw))
  if (!parsed.success) {
    throw new Error(`設定の検証に失敗しました(${source}): ${parsed.error}`)
  }
  const config = withProtectedGlobs(withUnionParams(parsed.data), raw)
  try {
    assertInvariants(config)
  } catch (err) {
    throw new Error(`設定が不正です(${source}): ${(err as Error).message}`)
  }

  let testsDir: string
  try {
    testsDir = resolveTestsDir(projectRoot)
  } catch (err) {
    throw new Error(
      `testsDir を読めません(${projectConfigPath(cwd)}): ${(err as Error).message}`
    )
  }

  const expanded: RaguelConfig = {
    ...config,
    storage: {
      ...config.storage,
      // 相対パスは、設定を探したプロジェクトルートを基準にする(cwd に依らず同じ置き場になる)
      casesDir: resolve(projectRoot, resolveCasesDir(config.storage.casesDir))
    }
  }
  const configHash = computeConfigHash(expanded)

  log.info("設定を読み込みました", { source, configHash })

  return { config: expanded, configHash, source, projectRoot, testsDir }
}

/**
 * loadConfig の失敗を例外ではなく結果で返す(§6.12.4)。
 * 起動時に設定が壊れていてもサーバーを起動し、評価と list_rules に理由を載せるために使う
 */
export function tryLoadConfig(cwd: string = process.cwd()): ConfigLoadResult {
  try {
    return { ok: true, loaded: loadConfig(cwd) }
  } catch (err) {
    const { path, source } = configCandidate(cwd)
    return {
      ok: false,
      error: err instanceof Error ? err.message : String(err),
      path,
      source
    }
  }
}

// ---- 設定の出所の解決 ----

function resolveRawConfig(cwd: string): {
  raw: Record<string, unknown>
  source: string
} {
  const { path, source } = configCandidate(cwd)
  if (process.env.RAGUEL_CONFIG) {
    return { raw: readJsonObject(path), source }
  }
  if (!existsSync(path)) return { raw: {}, source: "defaults" }
  // config.json はあるが raguel が無いときは内蔵の既定値で動く
  const raguel = readJsonObject(path).raguel
  if (raguel === undefined) return { raw: {}, source: "defaults" }
  if (!isPlainObject(raguel)) {
    throw new Error(
      `設定ファイルの raguel はオブジェクトである必要があります: ${path}`
    )
  }
  return { raw: raguel, source }
}

// 廃止したキーと廃止したルール ID は、後継を名指しする文言で拒む(§6.12.2)
function assertNoRetiredKeys(
  raw: Record<string, unknown>,
  source: string
): void {
  for (const { path, reason } of ABOLISHED_KEYS) {
    if (hasPath(raw, path.split("."))) {
      throw new Error(`${path} は廃止した(${source})。${reason}`)
    }
  }
  const rules = raw.rules
  if (!isPlainObject(rules)) return
  for (const [ruleId, successors] of Object.entries(RETIRED_RULE_IDS)) {
    if (ruleId in rules) {
      throw new Error(
        `ルール ID ${ruleId} は廃止した(${source})。${successors.join(" と ")} に書き分けてください。`
      )
    }
  }
}

function hasPath(obj: Record<string, unknown>, keys: string[]): boolean {
  let cur: unknown = obj
  for (const key of keys) {
    if (!isPlainObject(cur) || !(key in cur)) return false
    cur = cur[key]
  }
  return true
}

// ---- 読み直し ----

/**
 * 呼ぶたびに設定の出所になりうるファイル(RAGUEL_CONFIG のファイルとプロジェクトルートの config.json)の
 * パス・有無・mtime を前回の読み込みと比べ、違えば loadConfig で読み直して build の結果を作り直す関数を返す。
 * 読み込みか build が失敗したら例外を投げ、前の結果には戻さない(次の呼び出しで読み直しを試す)。
 */
export function createConfigReloader<T>(
  build: (loaded: LoadedConfig) => T,
  cwd: string = process.cwd()
): () => T {
  let stamp: string | undefined
  let current: T | undefined
  return () => {
    const next = configStamp(cwd)
    if (current === undefined || next !== stamp) {
      current = undefined // 失敗したら前の結果に戻さない
      current = build(loadConfig(cwd))
      stamp = next
    }
    return current
  }
}

function configStamp(cwd: string): string {
  const paths = [configCandidate(cwd).path, projectConfigPath(cwd)]
  return JSON.stringify(
    paths.map((p) => {
      const stat = statSync(p, { throwIfNoEntry: false })
      return [p, stat ? stat.mtimeMs : null]
    })
  )
}

function readJsonObject(path: string): Record<string, unknown> {
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
    parsed = JSON.parse(text)
  } catch (err) {
    throw new Error(
      `設定ファイルの JSON パースに失敗しました: ${path} (${(err as Error).message})`
    )
  }

  if (!isPlainObject(parsed)) {
    throw new Error(
      `設定ファイルのルートはオブジェクトである必要があります: ${path}`
    )
  }
  return parsed
}

// ---- 深いマージ(オブジェクトは再帰、配列は利用者の値で置換、undefined は既定値を保つ) ----

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

// ---- 和集合と保護パスの既定の除外(§6.12.2) ----

/** params の表で merge: "union" と宣言したパラメータを、既定値との和集合にする */
function withUnionParams(config: RaguelConfig): RaguelConfig {
  const rules = { ...config.rules }
  for (const spec of RULE_SPECS) {
    for (const param of spec.params) {
      const value = rules[spec.id]?.[param.name]
      if (param.merge !== "union" || !Array.isArray(value)) continue
      rules[spec.id] = {
        ...rules[spec.id],
        [param.name]: [...new Set([...(param.default as string[]), ...value])]
      }
    }
  }
  return { ...config, rules }
}

/**
 * code/protected-paths の globs から、excludeDefaults に挙げた既定の glob を取り除く。
 * 利用者が globs に自分で書いた glob は取り除かない
 */
function withProtectedGlobs(
  config: RaguelConfig,
  raw: Record<string, unknown>
): RaguelConfig {
  const id = "code/protected-paths"
  const settings = config.rules[id]
  const excluded = settings?.excludeDefaults
  if (!settings || !Array.isArray(excluded) || excluded.length === 0)
    return config
  const rawRules = isPlainObject(raw.rules) ? raw.rules : {}
  const rawSettings = rawRules[id]
  const userGlobs =
    isPlainObject(rawSettings) && Array.isArray(rawSettings.globs)
      ? (rawSettings.globs as string[])
      : []
  const globs = (settings.globs as string[]).filter(
    (g) =>
      !(
        excluded.includes(g) &&
        DEFAULT_PROTECTED_GLOBS.includes(g) &&
        !userGlobs.includes(g)
      )
  )
  return { ...config, rules: { ...config.rules, [id]: { ...settings, globs } } }
}

// ---- configHash(マージ後の設定をキーの順に正規化した JSON の sha256 hex) ----

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
