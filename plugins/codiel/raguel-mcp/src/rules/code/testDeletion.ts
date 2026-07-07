/**
 * code/test-deletion — テストファイル削除・skip 化の検出(既定 ask)
 */

import type { Finding, Rule } from "../../core/types.js"
import { getSeverity, truncateExcerpt } from "../util.js"
import { parseDiff } from "./diffParse.js"

const RULE_ID = "code/test-deletion"

const TEST_FILE_RE = /(\.test\.[^./]+$)|(\.spec\.[^./]+$)|(^|\/)__tests__\//
const SKIP_MARKER_RE =
  /\b(it|describe|test)\.skip\s*\(|\bxit\s*\(|@pytest\.mark\.skip\b/

function isTestFile(path: string): boolean {
  return TEST_FILE_RE.test(path)
}

export const testDeletionRule: Rule = {
  id: RULE_ID,
  appliesTo: ["code"],
  sealed: false,
  defaultSeverity: "ask",
  check(artifact, ctx): Finding[] {
    const settings = ctx.config.rules[RULE_ID]
    const severity = getSeverity(settings, "ask")

    const parsed = parseDiff(artifact.content)
    const findings: Finding[] = []

    if (parsed.files.length === 0) {
      // diff でない生コードは skip マーカーのみ全文検査(削除の検出は diff 情報が必要なため不可)
      for (const line of artifact.content.split("\n")) {
        if (SKIP_MARKER_RE.test(line)) {
          findings.push({
            ruleId: RULE_ID,
            severity,
            message: "テストの skip 化を検出しました",
            evidence: { excerpt: truncateExcerpt(line) }
          })
        }
      }
      return findings
    }

    for (const file of parsed.files) {
      if (file.isDeleted && isTestFile(file.path)) {
        findings.push({
          ruleId: RULE_ID,
          severity,
          message: `テストファイルの削除を検出しました: ${file.path}`,
          evidence: { location: file.path }
        })
      }
      for (const line of file.additions) {
        if (SKIP_MARKER_RE.test(line)) {
          findings.push({
            ruleId: RULE_ID,
            severity,
            message: `テストの skip 化を検出しました: ${file.path}`,
            evidence: { location: file.path, excerpt: truncateExcerpt(line) }
          })
        }
      }
    }

    return findings
  }
}
