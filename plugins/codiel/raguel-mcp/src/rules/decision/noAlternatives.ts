/**
 * decision/no-alternatives — 代替案の検討が記載されていないことの検出(既定 info)
 */

import type { Finding, Rule } from "../../core/types.js"
import { getSeverity } from "../util.js"

const RULE_ID = "decision/no-alternatives"

const ALTERNATIVE_KEYWORDS = [
  "案",
  "alternative",
  "option",
  "比較",
  "選択肢",
  "代替"
]

export const noAlternativesRule: Rule = {
  id: RULE_ID,
  appliesTo: ["decision"],
  sealed: false,
  defaultSeverity: "info",
  check(artifact, ctx): Finding[] {
    const settings = ctx.config.rules[RULE_ID]
    const severity = getSeverity(settings, "info")

    const optionsConsidered = artifact.context.optionsConsidered
    if (Array.isArray(optionsConsidered) && optionsConsidered.length > 0) {
      return []
    }

    const lowerContent = artifact.content.toLowerCase()
    const mentionsAlternatives = ALTERNATIVE_KEYWORDS.some((k) =>
      lowerContent.includes(k.toLowerCase())
    )
    if (mentionsAlternatives) return []

    return [
      {
        ruleId: RULE_ID,
        severity,
        message: "代替案の検討が記載されていません"
      }
    ]
  }
}
