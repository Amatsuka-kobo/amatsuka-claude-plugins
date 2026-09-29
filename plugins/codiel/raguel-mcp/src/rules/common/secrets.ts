/**
 * common/secrets — API キー・トークン・秘密鍵の混入の検出(sealed, 既定 stop)。設計書 §6.4.2。
 * 既知の形の正規表現と、語を `/` と `.` で区切った部分のエントロピーの 2 つで見る。
 * 見出し行(Artifact.headingLines)は位置で外し、抜粋と maskSecrets では一致したトークンを伏せる。
 */

import type { Finding, Rule } from "../../core/types.js"
import { ruleParam } from "../params.js"
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
  // 直前が英数字でないときだけ一致させる(`task-` のような語の中の `sk-` を拾わない)
  { name: "llm-api-key", regex: /(?<![A-Za-z0-9])sk-[A-Za-z0-9_-]{20,}/g },
  { name: "private-key-block", regex: /-----BEGIN [A-Z ]*PRIVATE KEY-----/g },
  {
    name: "jwt",
    regex: /eyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{5,}\.[A-Za-z0-9_-]{5,}/g
  },
  { name: "slack-token", regex: /xox[bpars]-[A-Za-z0-9-]+/g },
  {
    name: "generic-secret-assignment",
    regex: /(?:api[_-]?key|token|secret|password)\s*[:=]\s*['"][^'"]{16,}['"]/gi
  },
  // URL に埋め込んだ認証情報(所見 A2)
  {
    name: "url-credentials",
    regex: /[a-z][a-z0-9+.-]*:\/\/[^\s:/@]+:[^\s@/]+@/gi
  }
]

/** PEM の秘密鍵は本体の行ごと伏せる(本体の行は 1 行ずつでは既知の形に当たらない) */
const PEM_BLOCK_RE =
  /-----BEGIN [A-Z ]*PRIVATE KEY-----[\s\S]*?(?:-----END [A-Z ]*PRIVATE KEY-----|$)/g

/**
 * lockfile 由来・URL など、エントロピーの判定で誤検知しやすい文脈。
 * 既知の形の照合はこの文脈の行でも行う(URL と本物の鍵が同じ行にあっても見逃さない)。
 */
function isEntropyExemptLine(line: string): boolean {
  if (/integrity:|sha512-|sha256-|resolution:/.test(line)) return true
  if (line.includes("node_modules/")) return true
  if (line.includes("://")) return true
  return false
}

const WORD_RE = /[A-Za-z0-9+/=_.-]+/g
const ENTROPY_MIN_LENGTH = 20
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

/**
 * 英大文字・英小文字・数字の 3 種をすべて含む 20 文字以上の部分だけを測る。
 * パスや slug は小文字・数字・`-` で書かれることが多く、この条件で外れる(所見 A1)
 */
function isHighEntropyPart(part: string): boolean {
  if (part.length < ENTROPY_MIN_LENGTH) return false
  if (!/[A-Z]/.test(part) || !/[a-z]/.test(part) || !/[0-9]/.test(part))
    return false
  return shannonEntropy(part) > ENTROPY_THRESHOLD
}

interface SecretToken {
  /** 既知の形の名前。エントロピーで拾ったものは "high-entropy" */
  name: string
  start: number
  end: number
}

/** 1 行の中の秘密情報らしいトークンの位置を返す */
function findSecretTokens(line: string): SecretToken[] {
  const tokens: SecretToken[] = []
  for (const { name, regex } of KNOWN_PATTERNS) {
    for (const m of line.matchAll(regex)) {
      tokens.push({ name, start: m.index, end: m.index + m[0].length })
    }
  }
  if (isEntropyExemptLine(line)) return tokens
  for (const m of line.matchAll(WORD_RE)) {
    let offset = m.index
    for (const part of m[0].split(/[/.]/)) {
      if (isHighEntropyPart(part)) {
        tokens.push({
          name: "high-entropy",
          start: offset,
          end: offset + part.length
        })
      }
      offset += part.length + 1
    }
  }
  return tokens
}

/** 先頭 4 文字だけを残し、残りを `*` にする。改行は残して行の数を変えない */
function maskToken(token: string): string {
  return token.slice(0, 4) + token.slice(4).replace(/[^\n]/g, "*")
}

function maskLine(line: string): string {
  let out = line
  // 後ろのトークンから置き換える。置き換えは長さを変えないので、前のトークンの位置はずれない
  const tokens = findSecretTokens(line).sort((a, b) => b.start - a.start)
  for (const { start, end } of tokens) {
    out =
      out.slice(0, start) + maskToken(out.slice(start, end)) + out.slice(end)
  }
  return out
}

/**
 * 秘密情報らしいトークンを伏せ字にした本文を返す。行の数と各行の長さは変えない。
 * ケースファイルの submission.txt、Jev への送信、応答の抜粋はこの関数を通す(計画書 §2)
 */
export function maskSecrets(text: string): string {
  return text
    .replace(PEM_BLOCK_RE, maskToken)
    .split("\n")
    .map(maskLine)
    .join("\n")
}

function compileAllowPatterns(patterns: string[]): RegExp[] {
  const compiled: RegExp[] = []
  for (const pattern of patterns) {
    try {
      compiled.push(new RegExp(pattern))
    } catch {
      // 不正な正規表現は設定の読み込み(core/invariants.ts)で拒む。ここでは除外に使わない
    }
  }
  return compiled
}

/** 一致した行の前後 1 行を、行番号を付けて伏せ字の本文から切り出す */
function excerptAround(maskedLines: string[], index: number): string {
  const from = Math.max(0, index - 1)
  const to = Math.min(maskedLines.length - 1, index + 1)
  const out: string[] = []
  for (let i = from; i <= to; i++) out.push(`${i + 1}: ${maskedLines[i]}`)
  return truncateExcerpt(out.join("\n"))
}

export const secretsRule: Rule = {
  id: RULE_ID,
  appliesTo: "all",
  sealed: true,
  defaultSeverity: "stop",
  check(artifact, ctx): Finding[] {
    const severity = getSeverity(ctx.config.rules[RULE_ID], "stop")
    const allow = compileAllowPatterns(
      ruleParam<string[]>(ctx.config, RULE_ID, "allowPatterns")
    )
    const skip = new Set(artifact.headingLines)
    const lines = artifact.content.split("\n")
    let maskedLines: string[] | null = null

    const findings: Finding[] = []
    for (let i = 0; i < lines.length; i++) {
      if (skip.has(i)) continue
      const line = lines[i]
      for (const token of findSecretTokens(line)) {
        // allowPatterns は行ではなくトークンに当てる(所見 A3)
        const text = line.slice(token.start, token.end)
        if (allow.some((re) => re.test(text))) continue
        maskedLines ??= maskSecrets(artifact.content).split("\n")
        findings.push({
          ruleId: RULE_ID,
          severity,
          message:
            token.name === "high-entropy"
              ? "高エントロピーな文字列を検出しました(秘密情報の可能性)"
              : `既知の秘密情報パターン(${token.name})を検出しました`,
          evidence: {
            location: `${i + 1} 行目`,
            line: i + 1,
            excerpt: excerptAround(maskedLines, i)
          }
        })
      }
    }
    return findings
  }
}
