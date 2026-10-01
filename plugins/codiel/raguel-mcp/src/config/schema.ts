/**
 * RaguelConfig(src/core/types.ts)に対応する zod のスキーマ(設計書 §6.12.2)。
 * オブジェクトはすべて厳格にし、未知のキー・未登録のルール ID・未知のパラメータを拒む。
 * ルールのパラメータのスキーマは rules/params.ts の表から作る。
 */

import { z } from "zod"
import type { RaguelConfig } from "../core/types"
import { RULE_SPECS } from "../rules/params"

const severitySchema = z.enum(["info", "ask", "stop"])

const ruleSettingsShape = Object.fromEntries(
  RULE_SPECS.map((spec) => [
    spec.id,
    z
      .strictObject({
        enabled: z.boolean().optional(),
        severity: severitySchema.optional(),
        ...Object.fromEntries(
          spec.params.map((p) => [p.name, p.schema.optional()])
        )
      })
      .optional()
  ])
)

const storageSchema = z.strictObject({
  casesDir: z.string().min(1),
  projectId: z.string().min(1).optional(),
  retention: z.strictObject({
    maxRuns: z.number().int().positive(),
    maxDays: z.number().int().positive()
  })
})

const contextJudgeSchema = z.strictObject({
  model: z.string().min(1).optional(),
  timeoutMs: z.number().int().positive(),
  thresholds: z.strictObject({
    lower: z.number().min(0).max(1),
    raise: z.number().min(0).max(1)
  })
})

const precedentSchema = z.strictObject({
  seedCatalog: z.boolean(),
  topN: z.number().int().positive()
})

const subjectSchema = z.strictObject({
  ignoreUncommitted: z.array(z.string().min(1))
})

export const configSchema = z.strictObject({
  version: z.literal(1),
  onError: z.literal("ASK"),
  storage: storageSchema,
  contextJudge: contextJudgeSchema,
  precedent: precedentSchema,
  subject: subjectSchema,
  rules: z.strictObject(ruleSettingsShape)
})

/** configSchema の検証を通った値を RaguelConfig として返す(ルールの表から作る部分は推論の型が緩いため) */
export function parseConfig(
  value: unknown
): { success: true; data: RaguelConfig } | { success: false; error: string } {
  const result = configSchema.safeParse(value)
  if (!result.success) {
    return { success: false, error: z.prettifyError(result.error) }
  }
  return { success: true, data: result.data as RaguelConfig }
}
