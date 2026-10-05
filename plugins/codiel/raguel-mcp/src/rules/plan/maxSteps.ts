/**
 * plan/max-steps — ステップ数の上限超過の検出(スコープの肥大の兆候、既定 info)。設計書 §6.4.2(A9)。
 * plan だけに当てる。`## Step N` の見出しを優先して数え、無ければ番号付きリストを数える。
 */

import type { Finding, Rule } from "../../core/types.js"
import { ruleParam } from "../params.js"
import { getSeverity } from "../util.js"

const RULE_ID = "plan/max-steps"

function countSteps(content: string): number {
  const lines = content.split("\n")
  const headings = lines.filter((l) => /^#+\s*Step\s*\d+/.test(l)).length
  if (headings > 0) return headings
  return lines.filter((l) => /^\s*\d+[.)]\s+/.test(l)).length
}

export const maxStepsRule: Rule = {
  id: RULE_ID,
  appliesTo: ["plan"],
  sealed: false,
  defaultSeverity: "info",
  check(artifact, ctx): Finding[] {
    const severity = getSeverity(ctx.config.rules[RULE_ID], "info")
    const limit = ruleParam<number>(ctx.config, RULE_ID, "limit")
    const steps = countSteps(artifact.content)
    if (steps <= limit) return []

    return [
      {
        ruleId: RULE_ID,
        severity,
        message: `ステップ数が上限(${limit})を超えています(実際: ${steps})。スコープが膨らんでいないか確かめてください`
      }
    ]
  }
}
