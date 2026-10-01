/**
 * code/max-diff-lines — diff の変更行数の上限超過の検出(既定 ask)
 */

import type { Finding, Rule } from "../../core/types.js"
import { ruleParam } from "../params.js"
import { getSeverity } from "../util.js"
import { parseDiff } from "./diffParse.js"

const RULE_ID = "code/max-diff-lines"

export const maxDiffLinesRule: Rule = {
  id: RULE_ID,
  appliesTo: ["code"],
  sealed: false,
  defaultSeverity: "ask",
  check(artifact, ctx): Finding[] {
    const severity = getSeverity(ctx.config.rules[RULE_ID], "ask")
    const limit = ruleParam<number>(ctx.config, RULE_ID, "limit")
    const total = parseDiff(artifact.content).totalChangedLines
    if (total <= limit) return []

    return [
      {
        ruleId: RULE_ID,
        severity,
        message: `diff の変更行数が上限(${limit} 行)を超えています(実際: ${total} 行)`
      }
    ]
  }
}
