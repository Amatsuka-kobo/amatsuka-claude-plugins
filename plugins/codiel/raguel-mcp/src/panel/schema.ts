/**
 * パネリスト応答の zod スキーマ共通部品。
 * ruleId は LLM に出させず、ランナー/各パネリストが `panel/<名前>` に強制上書きする。
 * severity はパネル発なので "info" | "ask" のみ許可し、STOP を排除する(不変条件 9)。
 */

import { z } from "zod"
import type { Finding, PanelistName } from "../core/types.js"

export const panelSeveritySchema = z.enum(["info", "ask"])

export const rawFindingSchema = z.object({
  severity: panelSeveritySchema,
  confidence: z.number().min(0).max(100),
  message: z.string(),
  evidence: z
    .object({
      location: z.string().optional(),
      excerpt: z.string().optional()
    })
    .optional()
})
export type RawFinding = z.infer<typeof rawFindingSchema>

/** ルーブリック軸キーの集合から scores 用スキーマを組み立てる */
export function scoresSchema(axisKeys: readonly string[]) {
  const shape: Record<string, z.ZodNumber> = {}
  for (const key of axisKeys) shape[key] = z.number().min(0).max(100)
  return z.object(shape)
}

/** findings + scores からなる標準パネル応答スキーマ(多くのパネリストが共有) */
export function standardPanelResponseSchema(axisKeys: readonly string[]) {
  return z.object({
    findings: z.array(rawFindingSchema),
    scores: scoresSchema(axisKeys)
  })
}
export type StandardPanelResponse = z.infer<
  ReturnType<typeof standardPanelResponseSchema>
>

/** LLM の生 findings を Finding[] へ変換し、ruleId を panel/<name> に強制上書きする */
export function toFindings(
  raw: readonly RawFinding[],
  panelist: PanelistName
): Finding[] {
  return raw.map((f) => ({
    ruleId: `panel/${panelist}`,
    severity: f.severity,
    confidence: f.confidence,
    message: f.message,
    evidence: f.evidence
  }))
}

/** zod スキーマから claude CLI --json-schema 用の JSON Schema オブジェクトを生成する */
export function toJsonSchema(schema: z.ZodType): object {
  return z.toJSONSchema(schema) as object
}
