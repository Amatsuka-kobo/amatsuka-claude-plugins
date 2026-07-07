/**
 * RaguelConfig(src/core/types.ts)に対応する zod スキーマ。
 * 起動時にマージ済み設定をここで検証する(src/config/loader.ts)。
 */

import { z } from "zod"
import type { RaguelConfig } from "../core/types"

// PanelistName(core/types.ts)と同値のランタイム配列。
// 型のドリフトはファイル末尾のコンパイル時整合チェックで検知する。
const panelistNames = [
  "adversarial",
  "steelman",
  "crosscheck",
  "assumption",
  "precedent"
] as const

const panelistNameSchema = z.enum(panelistNames)
const panelistOrMetaSchema = z.enum([...panelistNames, "meta"])

const severitySchema = z.enum(["info", "ask", "stop"])

// enabled / severity は既定パラメータ、それ以外はルール固有の任意パラメータとして許容する
const ruleSettingsSchema = z.looseObject({
  enabled: z.boolean().optional(),
  severity: severitySchema.optional()
})

const panelistSettingsSchema = z.object({
  model: z.string().min(1).optional()
})

const storageSchema = z.object({
  casesDir: z.string().min(1),
  projectId: z.string().min(1).optional(),
  retention: z.object({
    maxRuns: z.number().int().positive(),
    maxDays: z.number().int().positive()
  })
})

const judgeSchema = z.object({
  provider: z.enum(["claude-cli", "none"]),
  model: z.string().min(1),
  timeoutMs: z.number().positive(),
  canStop: z.boolean(),
  maxConcurrency: z.number().int().positive(),
  thresholds: z.object({
    proceed: z.number().min(0).max(100),
    confidence: z.number().min(0).max(100),
    maxVariance: z.number().min(0).max(100)
  })
})

const weightSchema = z.object({
  tiers: z.object({
    standard: z.number().min(0).max(100),
    critical: z.number().min(0).max(100)
  })
})

const panelSchema = z.object({
  trivial: z.array(panelistNameSchema),
  standard: z.array(panelistNameSchema),
  critical: z.array(panelistNameSchema),
  perPanelist: z.partialRecord(panelistOrMetaSchema, panelistSettingsSchema)
})

const precedentSchema = z.object({
  seedCatalog: z.boolean(),
  topN: z.number().int().positive()
})

export const configSchema = z.object({
  version: z.number().int().positive(),
  // PROCEED は型レベルで排除(不変条件 8)
  onError: z.enum(["ASK", "STOP"]),
  storage: storageSchema,
  judge: judgeSchema,
  weight: weightSchema,
  panel: panelSchema,
  precedent: precedentSchema,
  rules: z.record(z.string(), ruleSettingsSchema)
})

// ---- コンパイル時整合チェック ----
// configSchema の推論型と RaguelConfig が構造的に互換であることを型検査のみで確認する。
// 実行されない関数内に閉じ込め、ランタイムには影響しない。
function _assertConfigSchemaMatchesRaguelConfig(): void {
  const fromSchema: RaguelConfig = null as unknown as z.infer<
    typeof configSchema
  >
  const fromType: z.infer<typeof configSchema> = null as unknown as RaguelConfig
  void fromSchema
  void fromType
}
void _assertConfigSchemaMatchesRaguelConfig
