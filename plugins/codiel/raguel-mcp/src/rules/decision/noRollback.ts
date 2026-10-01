/**
 * decision/no-rollback — 不可逆な判断なのに切り戻しの記載が無いことの検出(既定 info)。設計書 §6.4.2。
 * 語は plan/irreversible-ops と同じ語幹一致で探す
 */

import type { Finding, Rule } from "../../core/types.js"
import { ruleParam } from "../params.js"
import { findKeywords } from "../plan/irreversibleOps.js"
import { getSeverity, mentionsRollback, truncateExcerpt } from "../util.js"

const RULE_ID = "decision/no-rollback"

export const noRollbackRule: Rule = {
  id: RULE_ID,
  appliesTo: ["decision"],
  sealed: false,
  defaultSeverity: "info",
  check(artifact, ctx): Finding[] {
    const severity = getSeverity(ctx.config.rules[RULE_ID], "info")
    const keywords = ruleParam<string[]>(ctx.config, RULE_ID, "keywords")
    const { matched, firstLine } = findKeywords(artifact.content, keywords)
    if (matched.length === 0) return []

    const rollbackPlan = artifact.context.rollbackPlan
    if (typeof rollbackPlan === "string" && rollbackPlan.trim().length > 0) {
      return []
    }
    if (mentionsRollback(artifact.content)) return []

    return [
      {
        ruleId: RULE_ID,
        severity,
        message: `不可逆な操作(${matched.join(", ")})に触れていますが、切り戻しの計画の記載がありません`,
        evidence: {
          line: firstLine + 1,
          excerpt: truncateExcerpt(artifact.content.split("\n")[firstLine])
        }
      }
    ]
  }
}
