/**
 * common/resubmission-loop — 同一 runId 内での近似成果物の再提出(暴走)検知(sealed, 既定 ask→stop 昇格)。
 *
 * NOTE(統合時の注意): computeSubmissionDigest は「今回提出された成果物のダイジェストを
 * 過去分と比較する」ためだけでなく、pipeline が評価完了後に「今回の提出を次回以降の
 * priorSubmissions として永続化する」ためにも使うヘルパーとして export している。
 * pipeline 側は評価が確定した後の実際の verdict を使って
 * `computeSubmissionDigest(artifact.content, attempt, verdict)` を呼び、
 * casefile store に SubmissionDigest を追記してから次回呼び出し時に
 * `ctx.priorSubmissions` として供給すること(このルール自身は保存を行わない)。
 */

import { createHash } from "node:crypto"
import type {
  Finding,
  Rule,
  Severity,
  SubmissionDigest,
  Verdict
} from "../../core/types.js"
import { getSeverity, truncateExcerpt } from "../util.js"

const RULE_ID = "common/resubmission-loop"

const DEFAULT_SIMILARITY_THRESHOLD = 0.85
/** 緩和方向(閾値を上げる = 似ていると判定しにくくする)には限度を設ける(sealed ルール) */
const MAX_SIMILARITY_THRESHOLD = 0.95
const DEFAULT_STOP_AFTER = 3
const SHINGLE_SIZE = 5

/** 空白圧縮 + 小文字化による正規化 */
function normalize(content: string): string {
  return content.trim().replace(/\s+/g, " ").toLowerCase()
}

/** FNV-1a 32bit。決定論的でハッシュ集合の要素として十分な分散を持つ */
function fnv1a32(str: string): number {
  let hash = 0x811c9dc5
  for (let i = 0; i < str.length; i++) {
    hash ^= str.charCodeAt(i)
    hash = Math.imul(hash, 0x01000193)
  }
  return hash >>> 0
}

/**
 * 提出内容のダイジェストを計算する。
 * sha256: 正規化後テキストの完全一致判定に使う
 * shingleHashes: 文字 5-gram のハッシュ集合。Jaccard 類似度(近似一致判定)に使う
 */
export function computeSubmissionDigest(
  content: string,
  attempt: number,
  verdict: Verdict
): SubmissionDigest {
  const normalized = normalize(content)
  const sha256 = createHash("sha256").update(normalized).digest("hex")

  const shingles = new Set<number>()
  if (normalized.length >= SHINGLE_SIZE) {
    for (let i = 0; i + SHINGLE_SIZE <= normalized.length; i++) {
      shingles.add(fnv1a32(normalized.slice(i, i + SHINGLE_SIZE)))
    }
  } else if (normalized.length > 0) {
    // 短すぎる内容は全体を1つのシングルとして扱う
    shingles.add(fnv1a32(normalized))
  }

  return { attempt, verdict, sha256, shingleHashes: [...shingles] }
}

/** Jaccard 類似度(0〜1)。両方空集合なら 1(完全一致とみなす) */
export function similarity(
  a: number[] | Set<number>,
  b: number[] | Set<number>
): number {
  const setA = a instanceof Set ? a : new Set(a)
  const setB = b instanceof Set ? b : new Set(b)
  if (setA.size === 0 && setB.size === 0) return 1
  let intersection = 0
  for (const x of setA) {
    if (setB.has(x)) intersection++
  }
  const union = setA.size + setB.size - intersection
  return union === 0 ? 0 : intersection / union
}

export const resubmissionLoopRule: Rule = {
  id: RULE_ID,
  appliesTo: "all",
  sealed: true,
  defaultSeverity: "ask",
  check(artifact, ctx): Finding[] {
    const settings = ctx.config.rules[RULE_ID]
    const baseSeverity = getSeverity(settings, "ask")

    const configuredThreshold =
      typeof settings?.similarityThreshold === "number"
        ? settings.similarityThreshold
        : DEFAULT_SIMILARITY_THRESHOLD
    const similarityThreshold = Math.min(
      configuredThreshold,
      MAX_SIMILARITY_THRESHOLD
    )
    const stopAfter =
      typeof settings?.stopAfter === "number"
        ? settings.stopAfter
        : DEFAULT_STOP_AFTER

    const priorAskOrStop = ctx.priorSubmissions.filter(
      (s) => s.verdict === "ASK" || s.verdict === "STOP"
    )
    if (priorAskOrStop.length === 0) return []

    // 比較用の現在提出ダイジェスト。attempt/verdict は比較には使わないためプレースホルダでよい
    const current = computeSubmissionDigest(artifact.content, 0, "ASK")

    const matchedAttempts: number[] = []
    for (const prior of priorAskOrStop) {
      const exactMatch = current.sha256 === prior.sha256
      const nearMatch =
        similarity(current.shingleHashes, prior.shingleHashes) >=
        similarityThreshold
      if (exactMatch || nearMatch) {
        matchedAttempts.push(prior.attempt)
      }
    }

    if (matchedAttempts.length === 0) return []

    const severity: Severity =
      matchedAttempts.length >= stopAfter ? "stop" : baseSeverity

    return [
      {
        ruleId: RULE_ID,
        severity,
        message: `過去の提出(試行 ${matchedAttempts.join(", ")})と類似した成果物が再提出されました(${matchedAttempts.length} 回一致)`,
        evidence: { excerpt: truncateExcerpt(artifact.content) }
      }
    ]
  }
}
