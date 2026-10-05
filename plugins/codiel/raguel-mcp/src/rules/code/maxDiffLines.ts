/**
 * code/max-diff-lines — diff の変更行数の上限超過の検出(既定 ask)。バイナリのファイルは数えない
 */

import type { DiffFile, Finding, Rule } from "../../core/types.js"
import { ruleParam } from "../params.js"
import { getSeverity } from "../util.js"
import { parseDiff } from "./diffParse.js"

const RULE_ID = "code/max-diff-lines"

/** NUL を含む行があれば git と同じくバイナリとみなす */
function isBinaryContent(f: DiffFile): boolean {
  return [...f.additions, ...f.deletions].some((l) => l.includes("\0"))
}

export const maxDiffLinesRule: Rule = {
  id: RULE_ID,
  appliesTo: ["code"],
  sealed: false,
  defaultSeverity: "ask",
  check(artifact, ctx): Finding[] {
    const severity = getSeverity(ctx.config.rules[RULE_ID], "ask")
    const limit = ruleParam<number>(ctx.config, RULE_ID, "limit")
    // --text で偽の + 行になったバイナリ(NUL を含むファイル)は数えない。
    // attributes には頼らない(-diff を付けたテキストの大きな変更を外せないように)。
    // 検査(secrets・patternScan)の対象からは外さない
    const total = parseDiff(artifact.content)
      .files.filter((f) => !isBinaryContent(f))
      .reduce((sum, f) => sum + f.additions.length + f.deletions.length, 0)
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
