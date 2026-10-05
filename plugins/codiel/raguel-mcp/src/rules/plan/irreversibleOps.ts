/**
 * plan/irreversible-ops — 不可逆な操作への言及の検出(既定 info)。設計書 §6.4.2(A8)。
 * 語は語幹で一致させる。判定を動かさず、Jev の文脈判定の手がかりになる。
 */

import type { Finding, Rule } from "../../core/types.js"
import { ruleParam } from "../params.js"
import {
  escapeRegExp,
  getSeverity,
  isAsciiWord,
  truncateExcerpt
} from "../util.js"

const RULE_ID = "plan/irreversible-ops"

/**
 * 語幹一致の正規表現を作る。ASCII の語は語頭の境界から始まり、後ろに語の文字が続いてもよい
 * (`deploy` は deployment に、`migration` は migrations に一致する)。語の間の空白は `-` とも一致させる
 * (`force push` は force-push に一致する)。ASCII でない語(片仮名・漢字)は部分一致にする
 */
export function stemMatcher(keyword: string): RegExp | null {
  const kw = keyword.trim()
  if (kw === "") return null
  if (!isAsciiWord(kw)) return new RegExp(escapeRegExp(kw))
  const body = kw.split(/\s+/).map(escapeRegExp).join("[-\\s]+")
  return new RegExp(`\\b${body}\\w*`, "i")
}

/** 語のうち本文に現れるものと、最初に現れた行(0 始まり) */
export function findKeywords(
  content: string,
  keywords: string[]
): { matched: string[]; firstLine: number } {
  const lines = content.split("\n")
  const matched: string[] = []
  let firstLine = -1
  for (const kw of keywords) {
    const re = stemMatcher(kw)
    if (!re) continue
    const at = lines.findIndex((l) => re.test(l))
    if (at < 0) continue
    matched.push(kw)
    if (firstLine < 0 || at < firstLine) firstLine = at
  }
  return { matched, firstLine }
}

export const irreversibleOpsRule: Rule = {
  id: RULE_ID,
  appliesTo: ["plan", "design"],
  sealed: false,
  defaultSeverity: "info",
  check(artifact, ctx): Finding[] {
    const severity = getSeverity(ctx.config.rules[RULE_ID], "info")
    const keywords = ruleParam<string[]>(ctx.config, RULE_ID, "keywords")
    const { matched, firstLine } = findKeywords(artifact.content, keywords)
    if (matched.length === 0) return []

    return [
      {
        ruleId: RULE_ID,
        severity,
        message: `不可逆な操作を示す語を検出しました: ${matched.join(", ")}`,
        evidence: {
          line: firstLine + 1,
          excerpt: truncateExcerpt(artifact.content.split("\n")[firstLine])
        }
      }
    ]
  }
}
