/**
 * common/resubmission-loop — 同じ run・同じフェーズでの似た成果物の再提出の検知(sealed, 既定 ask)。
 * 設計書 §6.4.2 の「再提出の判定」。stop には上げない。
 *
 * 比べる相手は、verdict が ASK か STOP、judgeStatus が ok、裁定の記録が無い過去の attempt である。
 * 相手の ask 以上の ruleId がどれも今回のルール層で出ていなければ、修正ありとみなして比べない。
 * 今回のルール層の所見は Rule.check からは見えないので、所見を持つ呼び出し側は
 * resubmissionFindings と findAddressedButSimilar に渡す。
 */

import { computeDigest, digestSimilarity } from "../../casefile/digest.js"
import type {
  Artifact,
  Finding,
  PriorAttempt,
  Rule,
  RuleContext
} from "../../core/types.js"
import { MAX_SIMILARITY_THRESHOLD, ruleParam } from "../params.js"
import { getSeverity } from "../util.js"

const RULE_ID = "common/resubmission-loop"

/** 似ていると判定した過去の attempt。W1-T03 の ResubmissionTarget と同じ形 */
export interface SimilarAttempt {
  attempt: number
  similarity: number
}

function isComparable(prior: PriorAttempt): boolean {
  return (
    (prior.verdict === "ASK" || prior.verdict === "STOP") &&
    prior.judgeStatus === "ok" &&
    !prior.hasRuling &&
    prior.digest !== null
  )
}

/** 今回のルール層の ask 以上の ruleId。このルール自身は数えない */
function askRuleIdsOf(findings: readonly Finding[]): Set<string> {
  return new Set(
    findings
      .filter((f) => f.severity !== "info" && f.ruleId !== RULE_ID)
      .map((f) => f.ruleId)
  )
}

/**
 * 前回の ask 以上の ruleId が空でなく、そのどれも今回出ていなければ修正ありとみなす。
 * 前回このルールだけが出ていた attempt は、指摘の中身が無いので修正ありとみなさない。
 * Jev の内容判定(judge/*)は今回のルール層に出ないので、比べる ID から除く
 */
function isAddressed(prior: PriorAttempt, current: Set<string>): boolean {
  const ids = prior.askRuleIds.filter(
    (id) => id !== RULE_ID && !id.startsWith("judge/")
  )
  return ids.length > 0 && ids.every((id) => !current.has(id))
}

function similarityThreshold(ctx: RuleContext): number {
  return Math.min(
    ruleParam<number>(ctx.config, RULE_ID, "similarityThreshold"),
    MAX_SIMILARITY_THRESHOLD
  )
}

/** 比べられる相手ごとに、閾値以上に似ていれば返す。addressed で修正ありかどうかを選ぶ */
function similarPriors(
  content: string,
  priors: readonly PriorAttempt[],
  current: Set<string> | null,
  threshold: number,
  addressed: boolean
): SimilarAttempt[] {
  const digest = computeDigest(content)
  const out: SimilarAttempt[] = []
  for (const prior of priors) {
    if (!isComparable(prior) || prior.digest === null) continue
    const wasAddressed = current !== null && isAddressed(prior, current)
    if (wasAddressed !== addressed) continue
    const similarity = digestSimilarity(digest, prior.digest)
    if (similarity !== null && similarity >= threshold) {
      out.push({ attempt: prior.attempt, similarity })
    }
  }
  return out
}

/**
 * 修正ありとみなして比較から外した相手のうち、類似度が閾値以上のもの。
 * Jev が有効なとき、前回の指摘への対処を問う対象(Jev の入力 resubmissionTargets)になる
 */
export function findAddressedButSimilar(
  content: string,
  priors: readonly PriorAttempt[],
  currentFindings: readonly Finding[],
  threshold: number
): SimilarAttempt[] {
  return similarPriors(
    content,
    priors,
    askRuleIdsOf(currentFindings),
    Math.min(threshold, MAX_SIMILARITY_THRESHOLD),
    true
  )
}

/**
 * このルールの所見を返す。currentFindings は今回のルール層のほかの所見で、
 * null なら修正ありの判定をせず、比べられる相手をすべて比べる
 */
export function resubmissionFindings(
  artifact: Artifact,
  ctx: RuleContext,
  currentFindings: readonly Finding[] | null
): Finding[] {
  const matched = similarPriors(
    artifact.content,
    ctx.priorAttempts,
    currentFindings === null ? null : askRuleIdsOf(currentFindings),
    similarityThreshold(ctx),
    false
  )
  if (matched.length === 0) return []

  const list = matched
    .map((m) => `試行 ${m.attempt}(類似度 ${m.similarity.toFixed(2)})`)
    .join("、")
  return [
    {
      ruleId: RULE_ID,
      severity: getSeverity(ctx.config.rules[RULE_ID], "ask"),
      message: `過去の提出と似た成果物が再提出されました: ${list}`
    }
  ]
}

export const resubmissionLoopRule: Rule = {
  id: RULE_ID,
  appliesTo: "all",
  sealed: true,
  defaultSeverity: "ask",
  check(artifact, ctx): Finding[] {
    return resubmissionFindings(artifact, ctx, null)
  }
}
