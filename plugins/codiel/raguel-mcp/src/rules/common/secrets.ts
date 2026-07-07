/**
 * common/secrets — APIキー・トークン・秘密鍵の混入検出(sealed, 既定 stop)。
 * (a) 既知パターン正規表現カタログ + (b) シャノンエントロピーによる高エントロピー文字列検出、の2段構え。
 */

import type { Finding, Rule } from "../../core/types.js"
import { getSeverity, truncateExcerpt } from "../util.js"

const RULE_ID = "common/secrets"

interface KnownPattern {
  name: string
  regex: RegExp
}

const KNOWN_PATTERNS: KnownPattern[] = [
  { name: "aws-access-key", regex: /AKIA[0-9A-Z]{16}/g },
  { name: "github-token", regex: /gh[pousr]_[A-Za-z0-9]{36,}/g },
  { name: "github-pat", regex: /github_pat_[A-Za-z0-9_]{20,}/g },
  { name: "llm-api-key", regex: /sk-[A-Za-z0-9_-]{20,}/g },
  { name: "private-key-block", regex: /-----BEGIN [A-Z ]*PRIVATE KEY-----/g },
  {
    name: "jwt",
    regex: /eyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{5,}\.[A-Za-z0-9_-]{5,}/g
  },
  { name: "slack-token", regex: /xox[bpars]-[A-Za-z0-9-]+/g },
  {
    name: "generic-secret-assignment",
    regex: /(?:api[_-]?key|token|secret|password)\s*[:=]\s*['"][^'"]{16,}['"]/gi
  }
]

/** lockfile 由来・git ハッシュ等、既知の偽陽性文脈 */
function isBuiltinFalsePositiveContext(line: string): boolean {
  if (/integrity:|sha512-|sha256-|resolution:/.test(line)) return true
  if (line.includes("node_modules/")) return true
  if (line.includes("://")) return true // URL 断片は誤検知しやすいため entropy スキャン対象外
  return false
}

function isAllowedByConfig(line: string, allowPatterns: string[]): boolean {
  for (const pattern of allowPatterns) {
    try {
      if (new RegExp(pattern).test(line)) return true
    } catch {
      // 不正な正規表現は無視(設定ミスで検査自体を壊さない)
    }
  }
  return false
}

const ENTROPY_TOKEN_RE = /[A-Za-z0-9+/=_-]{20,}/g
const HEX_40_OR_64_RE = /^[0-9a-f]{40}$|^[0-9a-f]{64}$/i
const ENTROPY_THRESHOLD = 4.0

function shannonEntropy(s: string): number {
  const freq = new Map<string, number>()
  for (const ch of s) freq.set(ch, (freq.get(ch) ?? 0) + 1)
  let entropy = 0
  for (const count of freq.values()) {
    const p = count / s.length
    entropy -= p * Math.log2(p)
  }
  return entropy
}

export const secretsRule: Rule = {
  id: RULE_ID,
  appliesTo: "all",
  sealed: true,
  defaultSeverity: "stop",
  check(artifact, ctx): Finding[] {
    const settings = ctx.config.rules[RULE_ID]
    const severity = getSeverity(settings, "stop")
    const allowPatterns = Array.isArray(settings?.allowPatterns)
      ? (settings.allowPatterns as string[])
      : []

    const findings: Finding[] = []
    const lines = artifact.content.split("\n")

    for (let i = 0; i < lines.length; i++) {
      const line = lines[i]
      if (
        isBuiltinFalsePositiveContext(line) ||
        isAllowedByConfig(line, allowPatterns)
      ) {
        continue
      }

      for (const pattern of KNOWN_PATTERNS) {
        pattern.regex.lastIndex = 0
        let match: RegExpExecArray | null
        // biome-ignore lint/suspicious/noAssignInExpressions: while-exec の定石
        while ((match = pattern.regex.exec(line))) {
          findings.push({
            ruleId: RULE_ID,
            severity,
            message: `既知の秘密情報パターン(${pattern.name})を検出しました`,
            evidence: {
              location: `${i + 1} 行目`,
              excerpt: truncateExcerpt(line)
            }
          })
        }
      }

      ENTROPY_TOKEN_RE.lastIndex = 0
      let tokenMatch: RegExpExecArray | null
      // biome-ignore lint/suspicious/noAssignInExpressions: while-exec の定石
      while ((tokenMatch = ENTROPY_TOKEN_RE.exec(line))) {
        const token = tokenMatch[0]
        if (HEX_40_OR_64_RE.test(token)) continue // git ハッシュ等
        if (shannonEntropy(token) > ENTROPY_THRESHOLD) {
          findings.push({
            ruleId: RULE_ID,
            severity,
            message: "高エントロピーな文字列を検出しました(秘密情報の可能性)",
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
