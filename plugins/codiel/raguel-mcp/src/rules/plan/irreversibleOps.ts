/**
 * plan/irreversible-ops — 不可逆操作への言及検出(既定 ask)
 */

import type { Finding, Rule } from "../../core/types.js"
import {
  getSeverity,
  IRREVERSIBLE_KEYWORDS,
  keywordMatches,
  truncateExcerpt
} from "../util.js"

const RULE_ID = "plan/irreversible-ops"

export const irreversibleOpsRule: Rule = {
  id: RULE_ID,
  appliesTo: ["plan", "design"],
  sealed: false,
  defaultSeverity: "ask",
  check(artifact, ctx): Finding[] {
    const settings = ctx.config.rules[RULE_ID]
    const severity = getSeverity(settings, "ask")
    const keywords = Array.isArray(settings?.keywords)
      ? (settings.keywords as string[])
      : IRREVERSIBLE_KEYWORDS

    const matched = keywords.filter((k) => keywordMatches(artifact.content, k))
    if (matched.length === 0) return []

    return [
      {
        ruleId: RULE_ID,
        severity,
        message: `不可逆操作を示唆するキーワードを検出しました: ${matched.join(", ")}`,
        evidence: { excerpt: truncateExcerpt(artifact.content) }
      }
    ]
  }
}
