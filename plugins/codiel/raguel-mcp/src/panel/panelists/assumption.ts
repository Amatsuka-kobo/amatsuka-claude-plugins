/**
 * 前提監査(assumption): 成果物が暗黙に依存する前提を列挙し、検証されていない
 * 重大前提を指摘する。critical ティアのみ起用される想定(docs/DESIGN.md §7)。
 */

import type { Artifact, PanelReport } from "../../core/types.js"
import { commonHeader, formatArtifact, formatObjective } from "../prompts.js"
import type { JudgeProvider } from "../provider.js"
import { formatRubric, rubricFor } from "../rubrics.js"
import {
  standardPanelResponseSchema,
  toFindings,
  toJsonSchema
} from "../schema.js"

export interface AssumptionInput {
  artifact: Artifact
}

export async function runAssumption(
  input: AssumptionInput,
  provider: JudgeProvider,
  model: string,
  timeoutMs: number
): Promise<PanelReport> {
  const axes = rubricFor(input.artifact.kind)
  const schema = standardPanelResponseSchema(axes.map((a) => a.key))

  const prompt = [
    commonHeader("前提監査(assumption)"),
    "",
    "## 職務",
    "この成果物が明示せずに暗黙に依存している前提を列挙せよ。",
    "その中で、検証されていない・検証が難しい・外れた場合の被害が大きい前提を",
    "重大前提として finding にすること(単なる前提の列挙自体は finding にしなくてよい)。",
    "",
    "## objective(この成果物が何のためのものか)",
    formatObjective(input.artifact.objective),
    "",
    "## 成果物",
    formatArtifact(input.artifact.content),
    "",
    "## ルーブリック(scores はこの軸ごとに 0-100 の整数で評価)",
    formatRubric(axes),
    "",
    "各 finding は severity(info|ask)・confidence(0-100)・message を含めること。",
    "severity は ask までしか使えない。"
  ].join("\n")

  const response = await provider.invoke({
    role: "assumption",
    model,
    prompt,
    schema,
    jsonSchema: toJsonSchema(schema),
    timeoutMs
  })

  return {
    panelist: "assumption",
    model,
    findings: toFindings(response.findings, "assumption"),
    scores: response.scores
  }
}
