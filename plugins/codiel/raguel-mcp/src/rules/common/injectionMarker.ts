/**
 * common/injection-marker — プロンプトインジェクションの徴候の検出(sealed, 既定 ask)。設計書 §6.4.2。
 * 成果物の本文に埋め込まれた「これまでの指示を無視して」などの日英の徴候を検出する。
 */

import type { Finding, Rule } from "../../core/types.js"
import { getSeverity, truncateExcerpt } from "../util.js"
import { maskSecrets } from "./secrets.js"

const RULE_ID = "common/injection-marker"

interface MarkerPattern {
  name: string
  regex: RegExp
}

/** system prompt と同じ行にあるときだけ偽装とみなす命令の語(所見 A12) */
const COMMAND_WORD_RE =
  /\b(?:ignore|disregard|forget|override|obey)\b|無視|従え|忘れ/i

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
  { name: "system-tag-forgery", regex: /<\s*\/?\s*system\s*>/i },
  { name: "role-hijack-ja", regex: /あなたは(今から|これから)/ },
  { name: "role-hijack-en", regex: /you are now\s+/i },
  {
    name: "new-persona-en",
    regex: /forget\s+(all\s+)?(your\s+)?(previous\s+)?instructions?/i
  }
]

function matchedPatterns(line: string): string[] {
  const names = PATTERNS.filter((p) => p.regex.test(line)).map((p) => p.name)
  if (/system\s*prompt/i.test(line) && COMMAND_WORD_RE.test(line)) {
    names.push("system-prompt-forgery")
  }
  return names
}

export const injectionMarkerRule: Rule = {
  id: RULE_ID,
  appliesTo: "all",
  sealed: true,
  defaultSeverity: "ask",
  check(artifact, ctx): Finding[] {
    const severity = getSeverity(ctx.config.rules[RULE_ID], "ask")

    const findings: Finding[] = []
    const lines = artifact.content.split("\n")

    for (let i = 0; i < lines.length; i++) {
      for (const name of matchedPatterns(lines[i])) {
        findings.push({
          ruleId: RULE_ID,
          severity,
          message: `プロンプトインジェクションの徴候(${name})を検出しました`,
          evidence: {
            location: `${i + 1} 行目`,
            line: i + 1,
            excerpt: truncateExcerpt(maskSecrets(lines[i]))
          }
        })
      }
    }

    return findings
  }
}
