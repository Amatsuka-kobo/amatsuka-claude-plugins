/**
 * 裁判官(meta): 独立した fresh なサブプロセスで起動し、入力はケースファイルの
 * 証拠テキストのみ(成果物原文は含めない。呼び出し側が連結・抜粋済みのバンドル
 * 文字列を渡す)。全証拠を読み、rubric 全軸 + blast_radius のスコアと rationale
 * (最終根拠文)を出す(docs/DESIGN.md §7、不変条件 4)。
 */

import { z } from "zod"
import type { ArtifactKind, MetaReport } from "../../core/types.js"
import { commonHeader, frameUntrusted } from "../prompts.js"
import type { JudgeProvider } from "../provider.js"
import { formatRubric, metaRubricFor } from "../rubrics.js"
import { scoresSchema, toJsonSchema } from "../schema.js"

function metaResponseSchema(axisKeys: readonly string[]) {
  return z.object({
    scores: scoresSchema(axisKeys),
    rationale: z.string()
  })
}

export async function runMetaPanelist(
  evidenceBundle: string,
  kind: ArtifactKind,
  provider: JudgeProvider,
  model: string,
  timeoutMs: number
): Promise<MetaReport> {
  const axes = metaRubricFor(kind)
  const schema = metaResponseSchema(axes.map((a) => a.key))

  const prompt = [
    commonHeader("裁判官(meta)"),
    "",
    "## 職務",
    "あなたは本件の成果物そのものを見ていない、独立した最終評価者である。",
    "以下のケースファイル証拠(ルール層所見・各パネリストの所見と論証)のみを読み、",
    "ルーブリック各軸のスコアと、判断根拠となる rationale(最終根拠文)を出力せよ。",
    "rationale は人間と次フェーズの AI に向けた説明であり、判定そのものはスコアで表現すること。",
    "",
    "## ケースファイル証拠",
    frameUntrusted("case-evidence", evidenceBundle),
    "",
    "## ルーブリック(blast_radius はこの成果物が間違っていた場合の最悪の被害と可逆性)",
    formatRubric(axes)
  ].join("\n")

  const response = await provider.invoke({
    role: "meta",
    model,
    prompt,
    schema,
    jsonSchema: toJsonSchema(schema),
    timeoutMs
  })

  return {
    model,
    scores: response.scores,
    rationale: response.rationale
  }
}
