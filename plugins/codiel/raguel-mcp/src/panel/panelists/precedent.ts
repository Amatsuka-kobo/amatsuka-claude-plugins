/**
 * 判例調査(precedent): 検索済み判例(決定論検索は別レーン)を受け取り、
 * 「本件は判例 X と同型か、X の失敗理由は本件に当てはまるか」を判例ごとに評価する。
 * 当てはまる失敗判例(rejected / incident)のみ finding 化する。approved 判例は
 * findings にせず参考スコアのみ(§9 昇格のみ原則)。
 */

import { z } from "zod"
import type {
  Artifact,
  Finding,
  PanelReport,
  Precedent
} from "../../core/types.js"
import {
  commonHeader,
  formatArtifact,
  formatObjective,
  frameUntrusted
} from "../prompts.js"
import type { JudgeProvider } from "../provider.js"
import { formatRubric, rubricFor } from "../rubrics.js"
import { scoresSchema, toJsonSchema } from "../schema.js"

export interface PrecedentInput {
  artifact: Artifact
  precedents: Precedent[]
}

function precedentResponseSchema(axisKeys: readonly string[]) {
  return z.object({
    evaluations: z.array(
      z.object({
        precedentId: z.string(),
        applies: z.boolean(),
        confidence: z.number().min(0).max(100),
        rationale: z.string()
      })
    ),
    scores: scoresSchema(axisKeys)
  })
}

function formatPrecedents(precedents: readonly Precedent[]): string {
  const body = precedents
    .map(
      (p) =>
        `- id: ${p.id} / outcome: ${p.outcome} / source: ${p.source}\n` +
        `  summary: ${p.summary}\n` +
        `  firedRules: ${p.firedRules.join(", ") || "(なし)"}\n` +
        `  lesson: ${p.lesson}` +
        (p.recordedAt ? `\n  recordedAt: ${p.recordedAt}` : "")
    )
    .join("\n")
  return frameUntrusted("precedents", body)
}

export async function runPrecedent(
  input: PrecedentInput,
  provider: JudgeProvider,
  model: string,
  timeoutMs: number
): Promise<PanelReport> {
  const axes = rubricFor(input.artifact.kind)
  const schema = precedentResponseSchema(axes.map((a) => a.key))

  const prompt = [
    commonHeader("判例調査(precedent)"),
    "",
    "## 職務",
    "以下の判例それぞれについて、本件がその判例と同型か、判例の失敗理由・教訓が本件にも",
    "当てはまるかを評価せよ。evaluations は判例 1 件ごとに 1 エントリ、precedentId は",
    "判例の id をそのまま使うこと。",
    "",
    "## objective(この成果物が何のためのものか)",
    formatObjective(input.artifact.objective),
    "",
    "## 成果物",
    formatArtifact(input.artifact.content),
    "",
    "## 検索済み判例",
    formatPrecedents(input.precedents),
    "",
    "## ルーブリック(scores はこの軸ごとに 0-100 の整数で評価)",
    formatRubric(axes)
  ].join("\n")

  const response = await provider.invoke({
    role: "precedent",
    model,
    prompt,
    schema,
    jsonSchema: toJsonSchema(schema),
    timeoutMs
  })

  const byId = new Map(input.precedents.map((p) => [p.id, p]))
  const findings: Finding[] = []

  for (const evaluation of response.evaluations) {
    const precedent = byId.get(evaluation.precedentId)
    if (!precedent) continue
    // approved 判例は findings 化しない(昇格のみ原則、§9)
    if (precedent.outcome === "approved") continue
    if (!evaluation.applies) continue

    findings.push({
      ruleId: "panel/precedent",
      severity: "ask",
      confidence: evaluation.confidence,
      message: `判例 ${precedent.id}(${precedent.outcome})に該当: ${evaluation.rationale}`
    })
  }

  return {
    panelist: "precedent",
    model,
    findings,
    scores: response.scores
  }
}
