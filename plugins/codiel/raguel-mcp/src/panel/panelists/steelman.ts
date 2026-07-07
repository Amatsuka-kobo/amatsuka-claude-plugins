/**
 * 弁護(steelman): 成果物の最強の擁護論を構築し、検察(adversarial)の所見に
 * 個別に反駁する。反駁できなかった所見は明示的に concede させる(docs/DESIGN.md §7)。
 * 不変条件1: steelman は adversarial が有効なティアでのみ有効化できる(検証は呼び出し側)。
 */

import { z } from "zod"
import type { Artifact, Finding, PanelReport } from "../../core/types.js"
import { commonHeader, formatArtifact, formatObjective } from "../prompts.js"
import type { JudgeProvider } from "../provider.js"
import { formatRubric, rubricFor } from "../rubrics.js"
import {
  rawFindingSchema,
  scoresSchema,
  toFindings,
  toJsonSchema
} from "../schema.js"

export interface SteelmanInput {
  artifact: Artifact
  /** 検察(adversarial)の所見。この順序・添字で verdicts を対応させる */
  adversarialFindings: Finding[]
}

export interface SteelmanVerdict {
  /** adversarialFindings 内での添字(0 始まり) */
  findingIndex: number
  rebuttal: string
  outcome: "rebutted" | "conceded"
}
export type SteelmanVerdicts = SteelmanVerdict[]

export interface SteelmanOutcome {
  report: PanelReport
  verdicts: SteelmanVerdicts
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

function formatAdversarialFindings(findings: readonly Finding[]): string {
  if (findings.length === 0) return "(検察の所見なし)"
  return findings
    .map(
      (f, i) =>
        `[${i}] (confidence: ${f.confidence ?? "?"}) ${f.message}` +
        (f.evidence?.location ? ` (evidence: ${f.evidence.location})` : "")
    )
    .join("\n")
}

export async function runSteelman(
  input: SteelmanInput,
  provider: JudgeProvider,
  model: string,
  timeoutMs: number
): Promise<SteelmanOutcome> {
  const axes = rubricFor(input.artifact.kind)
  const schema = steelmanResponseSchema(axes.map((a) => a.key))

  const prompt = [
    commonHeader("弁護(steelman)"),
    "",
    "## 職務",
    "成果物の最強の擁護論(defenseArgument)を構築せよ。",
    "さらに、以下の検察(adversarial)の所見それぞれに個別に反駁を試みること。",
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
    "## 検察(adversarial)の所見(添字付き)",
    formatAdversarialFindings(input.adversarialFindings),
    "",
    "## ルーブリック(scores はこの軸ごとに 0-100 の整数で評価)",
    formatRubric(axes),
    "",
    "findings フィールドには、検察への反駁とは別に、あなた自身が追加で挙げたい所見があれば",
    "含めてよい(通常は空配列でよい)。severity は ask までしか使えない。"
  ].join("\n")

  const response = await provider.invoke({
    role: "steelman",
    model,
    prompt,
    schema,
    jsonSchema: toJsonSchema(schema),
    timeoutMs
  })

  const report: PanelReport = {
    panelist: "steelman",
    model,
    findings: toFindings(response.findings, "steelman"),
    scores: response.scores
  }

  return { report, verdicts: response.verdicts }
}
