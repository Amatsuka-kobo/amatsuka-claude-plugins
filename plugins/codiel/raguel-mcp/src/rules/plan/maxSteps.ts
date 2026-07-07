/**
 * plan/max-steps — ステップ数上限超過の検出(スコープ肥大の兆候、既定 ask)
 */

import type { Finding, Rule } from "../../core/types.js"
import { countStepsFromContent, getSeverity } from "../util.js"

const RULE_ID = "plan/max-steps"
const DEFAULT_LIMIT = 15

export const maxStepsRule: Rule = {
  id: RULE_ID,
  appliesTo: ["plan", "design"],
  sealed: false,
  defaultSeverity: "ask",
  check(artifact, ctx): Finding[] {
    const settings = ctx.config.rules[RULE_ID]
    const severity = getSeverity(settings, "ask")
    const limit =
      typeof settings?.limit === "number" ? settings.limit : DEFAULT_LIMIT

    const stepCount =
      artifact.steps.length > 0
        ? artifact.steps.length
        : countStepsFromContent(artifact.content)

    if (stepCount <= limit) return []

    return [
      {
        ruleId: RULE_ID,
        severity,
        message: `ステップ数が上限(${limit})を超過しています(実際: ${stepCount})。スコープ肥大の兆候の可能性があります`
      }
    ]
  }
}
