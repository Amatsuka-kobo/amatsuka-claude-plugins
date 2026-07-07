/**
 * ルール実装間で共有する小さなヘルパー群。
 * 特定ルールに固有でないロジック(severity 解決・キーワード照合・抜粋切り詰め)のみ置く。
 */

import {
  MAX_EXCERPT_LENGTH,
  type RuleSettings,
  type Severity
} from "../core/types.js"

/** 設定から severity を解決する。未指定なら defaultSeverity を返す */
export function getSeverity(
  settings: RuleSettings | undefined,
  defaultSeverity: Severity
): Severity {
  const configured = settings?.severity
  return configured === "info" || configured === "ask" || configured === "stop"
    ? configured
    : defaultSeverity
}

/** 証拠抜粋を MAX_EXCERPT_LENGTH で切り詰める(インジェクション踏み台防止) */
export function truncateExcerpt(text: string): string {
  return text.length > MAX_EXCERPT_LENGTH
    ? text.slice(0, MAX_EXCERPT_LENGTH)
    : text
}

/** 正規表現メタ文字をエスケープする */
export function escapeRegExp(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")
}

/** ASCII のみで構成された語かどうか(単語境界照合を使うかの判定に使う) */
export function isAsciiWord(s: string): boolean {
  return /^[A-Za-z0-9 _-]+$/.test(s)
}

/**
 * キーワード照合。ASCII 語は単語境界を考慮した正規表現、
 * 日本語語はそのまま includes で照合する(§ CLAUDE.md 指示どおり)
 */
export function keywordMatches(content: string, keyword: string): boolean {
  if (keyword.length === 0) return false
  if (isAsciiWord(keyword)) {
    const pattern = escapeRegExp(keyword).replace(/\s+/g, "\\s+")
    return new RegExp(`\\b${pattern}\\b`, "i").test(content)
  }
  return content.includes(keyword)
}

/** plan/irreversible-ops と decision/no-rollback が共有する既定キーワード集 */
export const IRREVERSIBLE_KEYWORDS = [
  "本番",
  "production",
  "deploy",
  "drop table",
  "force push",
  "削除",
  "migration",
  "rm -rf"
]

/** rollback / 切り戻しへの言及があるかの本文チェック */
export function mentionsRollback(content: string): boolean {
  return /rollback|切り戻し|ロールバック|復旧/i.test(content)
}

/** 本文中の箇条書き・番号付きリストからステップ数を推定する(plan/max-steps 用) */
export function countStepsFromContent(content: string): number {
  const lines = content.split("\n")
  let count = 0
  for (const line of lines) {
    if (/^\s*(\d+[.)]|[-*]\s*\[[ xX]\])\s+/.test(line)) count++
  }
  return count
}
