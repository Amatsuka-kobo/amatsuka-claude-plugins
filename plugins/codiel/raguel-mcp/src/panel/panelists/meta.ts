/**
 * 裁判官(meta): critical だけで起動する(設計書 §6.6.1)。成果物の原文は見ず、
 * ルール層とパネルの所見・反駁・前フェーズの証拠をまとめた証拠の束と、判例の参考入力を読んで、
 * ルーブリックの全軸と blast_radius_contained のスコアと rationale を出す。
 */

import { z } from "zod"
import type { ArtifactKind, MetaReport, Precedent } from "../../core/types.js"
import {
  commonHeader,
  formatPrecedents,
  frameUntrusted,
  PRECEDENTS_HEADING
} from "../prompts.js"
import type { CallControl, JudgeProvider } from "../provider.js"
import { formatRubric, metaRubricFor } from "../rubrics.js"
import { scoresSchema, toJsonSchema } from "../schema.js"

function metaResponseSchema(axisKeys: readonly string[]) {
  return z.object({
    scores: scoresSchema(axisKeys),
    rationale: z.string()
  })
}

export interface MetaInput {
  /** 呼び出し側がまとめた証拠の束(成果物の原文を含めない) */
  evidenceBundle: string
  kind: ArtifactKind
  precedents: Precedent[]
}

export async function runMetaPanelist(
  input: MetaInput,
  provider: JudgeProvider,
  model: string,
  ctl: CallControl
): Promise<MetaReport> {
  const axes = metaRubricFor(input.kind)
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
    frameUntrusted("case-evidence", input.evidenceBundle),
    "",
    PRECEDENTS_HEADING,
    formatPrecedents(input.precedents),
    "",
    "## ルーブリック(scores はこの軸ごとに付ける)",
    formatRubric(axes)
  ].join("\n")

  const response = await provider.invoke(
    {
      role: "meta",
      model,
      prompt,
      schema,
      jsonSchema: toJsonSchema(schema)
    },
    ctl
  )

  return {
    model,
    scores: response.scores,
    rationale: response.rationale
  }
}
