/**
 * 検察(adversarial): 成果物がどう失敗するかを攻める。セキュリティと、成果物が暗黙に置く前提を
 * 必ず点検するが、具体的な失敗の筋書きがあるものだけを所見にする(設計書 §6.6.2)。
 * 判例の検索結果を参考入力として受け取る(§6.11)。
 */

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
  formatPrecedents,
  formatRuleFindings,
  PRECEDENTS_HEADING
} from "../prompts.js"
import type { CallControl, JudgeProvider } from "../provider.js"
import { formatRubric, rubricFor } from "../rubrics.js"
import {
  standardPanelResponseSchema,
  toFindings,
  toJsonSchema
} from "../schema.js"

export interface AdversarialInput {
  artifact: Artifact
  ruleFindings: Finding[]
  precedents: Precedent[]
}

export async function runAdversarial(
  input: AdversarialInput,
  provider: JudgeProvider,
  model: string,
  ctl: CallControl
): Promise<PanelReport> {
  const axes = rubricFor(input.artifact.kind)
  const schema = standardPanelResponseSchema(axes.map((a) => a.key))

  const prompt = [
    commonHeader("検察(adversarial)"),
    "",
    "## 職務",
    "この成果物がどう失敗するかを攻めよ。次の 2 つは必ず点検すること。",
    "- セキュリティ: 権限・機密情報・インジェクション・破壊的操作・サプライチェーン",
    "- 成果物が暗黙に置いている前提: 崩れたときに何が起きるか",
    "所見にするのは、具体的な失敗の筋書き(何がどの条件でどう壊れるか)を書けるものだけにすること。",
    "筋書きを書けない懸念は所見にしない。該当が無ければ findings は空の配列でよい。",
    "",
    "## objective(この成果物が何のためのものか)",
    formatObjective(input.artifact.objective),
    "",
    "## 成果物",
    formatArtifact(input.artifact.content),
    "",
    "## ルール層の既存所見(参考。ここに挙がっていない観点を優先して点検すること)",
    formatRuleFindings(input.ruleFindings),
    "",
    PRECEDENTS_HEADING,
    formatPrecedents(input.precedents),
    "",
    "## ルーブリック(scores はこの軸ごとに付ける)",
    formatRubric(axes),
    "",
    "各 finding は severity(info|ask)・confidence(0-100)・message を含めること。",
    "severity は ask までしか使えない(STOP はルール層だけが出す)。"
  ].join("\n")

  const response = await provider.invoke(
    {
      role: "adversarial",
      model,
      prompt,
      schema,
      jsonSchema: toJsonSchema(schema)
    },
    ctl
  )

  return {
    panelist: "adversarial",
    model,
    findings: toFindings(response.findings, "adversarial"),
    scores: response.scores
  }
}
