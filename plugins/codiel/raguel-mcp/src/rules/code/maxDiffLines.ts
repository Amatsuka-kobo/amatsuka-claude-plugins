/**
 * code/max-diff-lines — diff 行数上限超過の検出(既定 ask)
 */

import type { Finding, Rule } from "../../core/types.js"
import { getSeverity } from "../util.js"
import { parseDiff } from "./diffParse.js"

const RULE_ID = "code/max-diff-lines"
const DEFAULT_LIMIT = 500

export const maxDiffLinesRule: Rule = {
  id: RULE_ID,
  appliesTo: ["code"],
  sealed: false,
  defaultSeverity: "ask",
  check(artifact, ctx): Finding[] {
    const settings = ctx.config.rules[RULE_ID]
    const severity = getSeverity(settings, "ask")
    const limit =
      typeof settings?.limit === "number" ? settings.limit : DEFAULT_LIMIT

    const parsed = parseDiff(artifact.content)
    // 非 diff(生コード全文)の場合は行数を変更行数の代替として扱う
    const totalChangedLines =
      parsed.files.length > 0
        ? parsed.totalChangedLines
        : artifact.content.split("\n").length

    if (totalChangedLines <= limit) return []

    return [
      {
        ruleId: RULE_ID,
        severity,
        message: `diff の変更行数が上限(${limit} 行)を超過しています(実際: ${totalChangedLines} 行)`
      }
    ]
  }
}
