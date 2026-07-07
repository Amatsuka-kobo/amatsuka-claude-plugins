/**
 * decision/no-rollback — 不可逆な判断なのに rollback 記載がないことの検出(既定 ask)
 */

import type { Finding, Rule } from "../../core/types.js"
import {
  getSeverity,
  IRREVERSIBLE_KEYWORDS,
  keywordMatches,
  mentionsRollback,
  truncateExcerpt
} from "../util.js"

const RULE_ID = "decision/no-rollback"

export const noRollbackRule: Rule = {
  id: RULE_ID,
  appliesTo: ["decision"],
  sealed: false,
  defaultSeverity: "ask",
  check(artifact, ctx): Finding[] {
    const settings = ctx.config.rules[RULE_ID]
    const severity = getSeverity(settings, "ask")
    const keywords = Array.isArray(settings?.keywords)
      ? (settings.keywords as string[])
      : IRREVERSIBLE_KEYWORDS

    const mentionsIrreversible = keywords.some((k) =>
      keywordMatches(artifact.content, k)
    )
    if (!mentionsIrreversible) return []

    const hasRollbackPlan =
      typeof artifact.context.rollbackPlan === "string" &&
      artifact.context.rollbackPlan.trim().length > 0
    if (hasRollbackPlan) return []

    if (mentionsRollback(artifact.content)) return []

    return [
      {
        ruleId: RULE_ID,
        severity,
        message:
          "不可逆な操作に言及していますが rollback / 切り戻し計画の記載がありません",
        evidence: { excerpt: truncateExcerpt(artifact.content) }
      }
    ]
  }
}
