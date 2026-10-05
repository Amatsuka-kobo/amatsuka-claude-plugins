/**
 * code/test-deletion — テストファイルの削除と skip 化の検出(既定 ask)。設計書 §6.4.2(A11)。
 * JS に加え、Go・Python・Java の命名規則と skip の書き方を見る。
 */

import type { Finding, Rule } from "../../core/types.js"
import { getSeverity, truncateExcerpt } from "../util.js"
import { parseDiff } from "./diffParse.js"
import { isTestPath } from "./patternScan.js"

const RULE_ID = "code/test-deletion"

const SKIP_MARKER_RE =
  /\b(it|describe|test)\.skip\s*\(|\bx(it|describe)\s*\(|@pytest\.mark\.skip\b|@unittest\.skip|\bt\.Skip(Now|f)?\s*\(|@Disabled\b/

export const testDeletionRule: Rule = {
  id: RULE_ID,
  appliesTo: ["code"],
  sealed: false,
  defaultSeverity: "ask",
  check(artifact, ctx): Finding[] {
    const severity = getSeverity(ctx.config.rules[RULE_ID], "ask")
    const findings: Finding[] = []

    for (const file of parseDiff(artifact.content).files) {
      if (file.isDeleted && isTestPath(file.path)) {
        findings.push({
          ruleId: RULE_ID,
          severity,
          message: `テストファイルの削除を検出しました: ${file.path}`,
          evidence: { location: file.path, path: file.path }
        })
      }
      // テストのパスから外へ移す名前の変更も削除とみなす(設計書 §6.4.2)
      const from = file.oldPath
      if (from !== undefined && isTestPath(from) && !isTestPath(file.path)) {
        findings.push({
          ruleId: RULE_ID,
          severity,
          message: `テストファイルをテストのパスの外へ移す名前の変更を検出しました: ${from} → ${file.path}`,
          evidence: { location: from, path: from }
        })
      }
      file.additions.forEach((line, i) => {
        if (!SKIP_MARKER_RE.test(line)) return
        findings.push({
          ruleId: RULE_ID,
          severity,
          message: `テストの skip 化を検出しました: ${file.path}`,
          evidence: {
            location: file.path,
            path: file.path,
            line: file.additionLines[i],
            excerpt: truncateExcerpt(line)
          }
        })
      })
    }

    return findings
  }
}
