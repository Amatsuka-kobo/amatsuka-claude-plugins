/**
 * common/max-size — 成果物サイズ上限超過の検出(sealed でない, 既定 ask)
 */

import type { Finding, Rule } from "../../core/types.js"
import { getSeverity } from "../util.js"

const RULE_ID = "common/max-size"
const DEFAULT_LIMIT = 200000

export const maxSizeRule: Rule = {
  id: RULE_ID,
  appliesTo: "all",
  sealed: false,
  defaultSeverity: "ask",
  check(artifact, ctx): Finding[] {
    const settings = ctx.config.rules[RULE_ID]
    const severity = getSeverity(settings, "ask")
    const limit =
      typeof settings?.limit === "number" ? settings.limit : DEFAULT_LIMIT

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
