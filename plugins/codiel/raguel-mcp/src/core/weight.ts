/**
 * 重さ判定(§6)。パネル構成の選択に使う完全に決定論的なスコアリング。
 * 昇格のみ原則: ルール層の findings が示す重さは下回れない(floors で床を記録する)。
 */

import { parseDiff } from "../rules/code/diffParse.js"
import { DEFAULT_PROTECTED_GLOBS } from "../rules/code/protectedPaths.js"
import { IRREVERSIBLE_KEYWORDS, keywordMatches } from "../rules/util.js"
import type {
  Artifact,
  ArtifactKind,
  Finding,
  RaguelConfig,
  WeightResult,
  WeightTier
} from "./types.js"

const KIND_BASE: Record<ArtifactKind, number> = {
  decision: 10,
  plan: 10,
  design: 15,
  code: 20
}

const TIER_RANK: Record<WeightTier, number> = {
  trivial: 0,
  standard: 1,
  critical: 2
}

function maxTier(a: WeightTier, b: WeightTier): WeightTier {
  return TIER_RANK[a] >= TIER_RANK[b] ? a : b
}

/** 本文中の箇条書き・番号付きリストからステップ数を推定する(plan/max-steps と同じヒューリスティック) */
function countStepsFromContent(content: string): number {
  const lines = content.split("\n")
  let count = 0
  for (const line of lines) {
    if (/^\s*(\d+[.)]|[-*]\s*\[[ xX]\])\s+/.test(line)) count++
  }
  return count
}

function firstSegment(pattern: string): string {
  return pattern.split("/")[0] ?? ""
}

function hasWildcard(segment: string): boolean {
  return /[*?[\]{}]/.test(segment)
}

/** 保護 glob の先頭セグメントがワイルドカードを含まない場合のみ「近接」判定の対象にする */
function protectedTopDirs(globs: string[]): Set<string> {
  const dirs = new Set<string>()
  for (const glob of globs) {
    const segment = firstSegment(glob)
    if (segment && !hasWildcard(segment)) dirs.add(segment)
  }
  return dirs
}

function hasFinding(findings: Finding[], ruleId: string): boolean {
  return findings.some((f) => f.ruleId === ruleId)
}

export function computeWeight(
  artifact: Artifact,
  ruleFindings: Finding[],
  config: RaguelConfig
): WeightResult {
  const factors: Record<string, number> = {}
  const floors: string[] = []

  if (artifact.kind === "code") {
    const parsed = parseDiff(artifact.content)
    const totalChangedLines =
      parsed.files.length > 0
        ? parsed.totalChangedLines
        : artifact.content.split("\n").length

    const diffLinesFactor = Math.min(40, Math.floor(totalChangedLines / 50) * 5)
    if (diffLinesFactor > 0) factors["diff-lines"] = diffLinesFactor

    const changedFilesFactor = Math.min(20, artifact.changedPaths.length * 2)
    if (changedFilesFactor > 0) factors["changed-files"] = changedFilesFactor

    const protectedSettings = config.rules["code/protected-paths"]
    const protectedGlobs = Array.isArray(protectedSettings?.globs)
      ? (protectedSettings.globs as string[])
      : DEFAULT_PROTECTED_GLOBS
    const topDirs = protectedTopDirs(protectedGlobs)
    const isNearProtected = artifact.changedPaths.some((path) =>
      topDirs.has(firstSegment(path))
    )
    if (isNearProtected) factors["protected-path-proximity"] = 25
  }

  const mentionsIrreversible = IRREVERSIBLE_KEYWORDS.some((keyword) =>
    keywordMatches(artifact.content, keyword)
  )
  if (mentionsIrreversible) factors["irreversible-keyword"] = 20

  if (hasFinding(ruleFindings, "code/new-dependency")) {
    factors["new-dependency"] = 15
  }

  factors["kind-base"] = KIND_BASE[artifact.kind]

  if (artifact.kind === "plan") {
    const stepCount =
      artifact.steps.length > 0
        ? artifact.steps.length
        : countStepsFromContent(artifact.content)
    if (stepCount > 5) {
      factors["plan-steps"] = (stepCount - 5) * 2
    }
  }

  const score = Object.values(factors).reduce((sum, v) => sum + v, 0)

  const tiers = config.weight.tiers
  let tier: WeightTier =
    score >= tiers.critical
      ? "critical"
      : score >= tiers.standard
        ? "standard"
        : "trivial"

  // 昇格のみ原則(1): ルール findings に severity ask 以上が1つでもあれば最低 standard
  if (ruleFindings.some((f) => f.severity === "ask" || f.severity === "stop")) {
    if (TIER_RANK[tier] < TIER_RANK.standard) {
      floors.push("rule-ask-floor:standard")
    }
    tier = maxTier(tier, "standard")
  }

  // 昇格のみ原則(2): protected-paths / irreversible-ops の発火(severity 問わず)があれば critical
  if (
    hasFinding(ruleFindings, "code/protected-paths") ||
    hasFinding(ruleFindings, "plan/irreversible-ops")
  ) {
    if (TIER_RANK[tier] < TIER_RANK.critical) {
      floors.push("rule-fire-floor:critical")
    }
    tier = maxTier(tier, "critical")
  }

  return { tier, score, factors, floors }
}
