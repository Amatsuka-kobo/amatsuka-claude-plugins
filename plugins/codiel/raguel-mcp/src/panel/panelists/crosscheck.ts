/**
 * 鑑識(crosscheck): 成果物の主張を事実と突合する。両方向必須:
 * 未達(計画にあるのにやっていない)と逸脱(計画にないのにやっている)(docs/DESIGN.md §7)。
 * 参照ファイルの実在確認等は呼び出し側が決定論的に作った factTable で補助する
 * (このパネリスト自身はツールを持たない)。
 */

import type { Artifact, PanelReport } from "../../core/types.js"
import {
  commonHeader,
  formatArtifact,
  formatObjective,
  formatPriorEvidence,
  frameUntrusted
} from "../prompts.js"
import type { JudgeProvider } from "../provider.js"
import { formatRubric, rubricFor } from "../rubrics.js"
import {
  standardPanelResponseSchema,
  toFindings,
  toJsonSchema
} from "../schema.js"

export interface CrosscheckInput {
  artifact: Artifact
  /** 前フェーズの承認済み証拠テキスト。無ければ初回フェーズとして扱う */
  priorEvidence?: string
  /** 「成果物中の参照パス → 実在するか」等、呼び出し側が決定論的に作った事実表 */
  factTable?: string
}

function formatFactTable(factTable?: string): string {
  if (!factTable) {
    return (
      "(事実表なし。決定論的な実在確認は行われていない。成果物内の記述同士の" +
      "内部矛盾のみを確認すること)"
    )
  }
  return frameUntrusted("fact-table", factTable)
}

export async function runCrosscheck(
  input: CrosscheckInput,
  provider: JudgeProvider,
  model: string,
  timeoutMs: number
): Promise<PanelReport> {
  const axes = rubricFor(input.artifact.kind)
  const schema = standardPanelResponseSchema(axes.map((a) => a.key))

  const prompt = [
    commonHeader("鑑識(crosscheck)"),
    "",
    "## 職務",
    "成果物の主張を objective・前フェーズ証拠・事実表と突合し、不整合を洗い出せ。",
    "以下の両方向を必ず確認すること:",
    "- 未達: 計画・主張に書かれているのに、成果物内で実施された形跡がないもの",
    "- 逸脱: 計画・主張に書かれていないのに、成果物内で実施されているもの",
    "事実表にある「実在しない参照」は特に重視すること。",
    "",
    "## objective(この成果物が何のためのものか)",
    formatObjective(input.artifact.objective),
    "",
    "## 成果物",
    formatArtifact(input.artifact.content),
    "",
    "## 前フェーズの承認済み証拠",
    formatPriorEvidence(input.priorEvidence),
    "",
    "## 事実表(参照パスの実在確認など、決定論チェックの結果)",
    formatFactTable(input.factTable),
    "",
    "## ルーブリック(scores はこの軸ごとに 0-100 の整数で評価)",
    formatRubric(axes),
    "",
    "各 finding は severity(info|ask)・confidence(0-100)・message を含めること。",
    "severity は ask までしか使えない。"
  ].join("\n")

  const response = await provider.invoke({
    role: "crosscheck",
    model,
    prompt,
    schema,
    jsonSchema: toJsonSchema(schema),
    timeoutMs
  })

  return {
    panelist: "crosscheck",
    model,
    findings: toFindings(response.findings, "crosscheck"),
    scores: response.scores
  }
}
