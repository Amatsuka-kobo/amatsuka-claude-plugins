/**
 * common/injection-marker — プロンプトインジェクション徴候の検出(sealed, 既定 ask)。
 * 成果物本文に埋め込まれた「これまでの指示を無視して」等の日英徴候パターンを検出する。
 */

import type { Finding, Rule } from "../../core/types.js"
import { getSeverity, truncateExcerpt } from "../util.js"

const RULE_ID = "common/injection-marker"

interface MarkerPattern {
  name: string
  regex: RegExp
}

const PATTERNS: MarkerPattern[] = [
  {
    name: "ignore-instructions-ja",
    regex:
      /(これまでの|今までの|以前の|上記の)(指示|命令|プロンプト)(を)?(すべて|全て)?無視/
  },
  {
    name: "ignore-instructions-en",
    regex: /ignore\s+(all\s+)?(the\s+)?(previous|prior|above)\s+instructions?/i
  },
  {
    name: "disregard-instructions-en",
    regex: /disregard\s+(all\s+)?(previous|prior|above)\s+(instructions|rules)/i
  },
  { name: "system-prompt-forgery", regex: /system\s*prompt/i },
  { name: "system-tag-forgery", regex: /<\s*\/?\s*system\s*>/i },
  { name: "role-hijack-ja", regex: /あなたは(今から|これから)/ },
  { name: "role-hijack-en", regex: /you are now\s+/i },
  {
    name: "new-persona-en",
    regex: /forget\s+(all\s+)?(your\s+)?(previous\s+)?instructions?/i
  }
]

export const injectionMarkerRule: Rule = {
  id: RULE_ID,
  appliesTo: "all",
  sealed: true,
  defaultSeverity: "ask",
  check(artifact, ctx): Finding[] {
    const settings = ctx.config.rules[RULE_ID]
    const severity = getSeverity(settings, "ask")

    const findings: Finding[] = []
    const lines = artifact.content.split("\n")

    for (let i = 0; i < lines.length; i++) {
      const line = lines[i]
      for (const pattern of PATTERNS) {
        if (pattern.regex.test(line)) {
          findings.push({
            ruleId: RULE_ID,
            severity,
            message: `プロンプトインジェクションの徴候(${pattern.name})を検出しました`,
            evidence: {
              location: `${i + 1} 行目`,
              excerpt: truncateExcerpt(line)
            }
          })
        }
      }
    }

    return findings
  }
}
