/**
 * 弁護(steelman): 成果物の擁護論を組み、adversarial と crosscheck の所見に 1 件ずつ
 * 反駁するか認める(設計書 §6.6.1)。反駁された所見は合成で info に下がる(§6.6.3 の 2)。
 * steelman 自身の所見は info として残り、判定を動かさない。
 */

import { z } from "zod"
import type { Artifact, Finding, PanelReport } from "../../core/types.js"
import type { SteelmanVerdict, TargetPanelist } from "../../core/verdict.js"
import { commonHeader, formatArtifact, formatObjective } from "../prompts.js"
import type { CallControl, JudgeProvider } from "../provider.js"
import { formatRubric, rubricFor } from "../rubrics.js"
import {
  rawFindingSchema,
  scoresSchema,
  toFindings,
  toJsonSchema
} from "../schema.js"

/** 反駁の対象の所見。findingIndex はそのパネリストの findings の中の添字 */
export interface SteelmanTarget {
  panelist: TargetPanelist
  findingIndex: number
  finding: Finding
}

export interface SteelmanInput {
  artifact: Artifact
  /** この順の通し番号をプロンプトに載せ、応答の findingIndex と対応させる */
  targets: SteelmanTarget[]
}

export interface SteelmanOutcome {
  report: PanelReport
  verdicts: SteelmanVerdict[]
}

function steelmanResponseSchema(axisKeys: readonly string[]) {
  return z.object({
    verdicts: z.array(
      z.object({
        findingIndex: z.number().int().min(0),
        rebuttal: z.string(),
        outcome: z.enum(["rebutted", "conceded"])
      })
    ),
    defenseArgument: z.string(),
    findings: z.array(rawFindingSchema),
    scores: scoresSchema(axisKeys)
  })
}

function formatTargets(targets: readonly SteelmanTarget[]): string {
  if (targets.length === 0) return "(反駁の対象の所見なし)"
  return targets
    .map(
      ({ panelist, finding }, i) =>
        `[${i}] ${panelist} (confidence: ${finding.confidence ?? "?"}) ${finding.message}` +
        (finding.evidence?.location
          ? ` (evidence: ${finding.evidence.location})`
          : "")
    )
    .join("\n")
}

export async function runSteelman(
  input: SteelmanInput,
  provider: JudgeProvider,
  model: string,
  ctl: CallControl
): Promise<SteelmanOutcome> {
  const axes = rubricFor(input.artifact.kind)
  const schema = steelmanResponseSchema(axes.map((a) => a.key))

  const prompt = [
    commonHeader("弁護(steelman)"),
    "",
    "## 職務",
    "成果物の最強の擁護論(defenseArgument)を構築せよ。",
    "さらに、以下の検察(adversarial)と鑑識(crosscheck)の所見それぞれに個別に反駁を試みること。",
    '反駁できなかった所見は outcome を "conceded" とし、無理に反駁しようとしないこと',
    '(反駁できた場合のみ "rebutted")。verdicts は所見の添字([0], [1], ...)と 1 対 1 で対応させ、',
    "すべての所見に対して 1 件ずつ出力すること。",
    "",
    "## objective(この成果物が何のためのものか)",
    formatObjective(input.artifact.objective),
    "",
    "## 成果物",
    formatArtifact(input.artifact.content),
    "",
    "## 反駁の対象の所見(添字付き)",
    formatTargets(input.targets),
    "",
    "## ルーブリック(scores はこの軸ごとに付ける)",
    formatRubric(axes),
    "",
    "findings フィールドには、反駁とは別に、あなた自身が追加で挙げたい所見があれば",
    "含めてよい(通常は空配列でよい)。severity は ask までしか使えない。"
  ].join("\n")

  const response = await provider.invoke(
    {
      role: "steelman",
      model,
      prompt,
      schema,
      jsonSchema: toJsonSchema(schema)
    },
    ctl
  )

  const report: PanelReport = {
    panelist: "steelman",
    model,
    findings: toFindings(response.findings, "steelman"),
    scores: response.scores
  }

  // 通し番号を元のパネリストと添字に戻す。範囲外の番号は捨てる(反駁されなかった扱い)
  const verdicts: SteelmanVerdict[] = []
  for (const v of response.verdicts) {
    const target = input.targets[v.findingIndex]
    if (!target) continue
    verdicts.push({
      panelist: target.panelist,
      findingIndex: target.findingIndex,
      outcome: v.outcome,
      rebuttal: v.rebuttal
    })
  }

  return { report, verdicts }
}
