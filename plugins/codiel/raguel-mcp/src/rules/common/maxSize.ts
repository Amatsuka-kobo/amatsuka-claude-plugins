/**
 * common/max-size — 成果物のサイズの上限の超過の検出(sealed でない, 既定 ask)
 */

import type { Finding, Rule } from "../../core/types.js"
import { ruleParam } from "../params.js"
import { getSeverity } from "../util.js"

const RULE_ID = "common/max-size"

export const maxSizeRule: Rule = {
  id: RULE_ID,
  appliesTo: "all",
  sealed: false,
  defaultSeverity: "ask",
  check(artifact, ctx): Finding[] {
    const severity = getSeverity(ctx.config.rules[RULE_ID], "ask")
    const limit = ruleParam<number>(ctx.config, RULE_ID, "limit")

    if (artifact.content.length <= limit) return []

    return [
      {
        ruleId: RULE_ID,
        severity,
        message: `成果物のサイズが上限(${limit} 文字)を超過しています(実際: ${artifact.content.length} 文字)`
      }
    ]
  }
}
