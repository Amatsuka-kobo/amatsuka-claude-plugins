/**
 * 検察(adversarial): 「この成果物はなぜ失敗するか」を全力で攻撃する。
 * セキュリティ観点の攻撃を必ず含めることを職務指示に含む(docs/DESIGN.md §7)。
 */

import type { Artifact, Finding, PanelReport } from "../../core/types.js"
import {
  commonHeader,
  formatArtifact,
  formatObjective,
  formatRuleFindings
} from "../prompts.js"
import type { JudgeProvider } from "../provider.js"
import { formatRubric, rubricFor } from "../rubrics.js"
import {
  standardPanelResponseSchema,
  toFindings,
  toJsonSchema
} from "../schema.js"

export interface AdversarialInput {
  artifact: Artifact
  ruleFindings: Finding[]
}

export async function runAdversarial(
  input: AdversarialInput,
  provider: JudgeProvider,
  model: string,
  timeoutMs: number
): Promise<PanelReport> {
  const axes = rubricFor(input.artifact.kind)
  const schema = standardPanelResponseSchema(axes.map((a) => a.key))

  const prompt = [
    commonHeader("検察(adversarial)"),
    "",
    "## 職務",
    "この成果物はなぜ失敗するかを全力で攻撃せよ。具体的な失敗シナリオ・悪用シナリオを挙げること。",
    "セキュリティ観点の攻撃(権限昇格・機密情報の漏洩・プロンプトインジェクション・",
    "破壊的操作・サプライチェーン汚染等)を必ず 1 件以上含めること。",
    "",
    "## objective(この成果物が何のためのものか)",
    formatObjective(input.artifact.objective),
    "",
    "## 成果物",
    formatArtifact(input.artifact.content),
    "",
    "## ルール層の既存所見(参考。ここに挙がっていない観点を優先して攻撃すること)",
    formatRuleFindings(input.ruleFindings),
    "",
    "## ルーブリック(scores はこの軸ごとに 0-100 の整数で評価)",
    formatRubric(axes),
    "",
    "各 finding は severity(info|ask)・confidence(0-100)・message を含めること。",
    "severity は ask までしか使えない(最終判定・STOP はルール層の専権であり、あなたの職責ではない)。"
  ].join("\n")

  const response = await provider.invoke({
    role: "adversarial",
    model,
    prompt,
    schema,
    jsonSchema: toJsonSchema(schema),
    timeoutMs
  })

  return {
    panelist: "adversarial",
    model,
    findings: toFindings(response.findings, "adversarial"),
    scores: response.scores
  }
}
