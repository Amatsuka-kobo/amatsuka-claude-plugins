/**
 * 重さ判定(設計書 §6.5)。パネル構成の選択に使う決定論のスコアリング。
 * tier は下限(床)で上げることはあっても、下げることはない。
 */

import {
  classifyPath,
  DEFAULT_TESTS_DIR,
  globFixedPart
} from "../config/paths.js"
import { parseDiff } from "../rules/code/diffParse.js"
import { ruleParam } from "../rules/params.js"
import { countStepsFromContent } from "../rules/util.js"
import type {
  Artifact,
  Finding,
  RaguelConfig,
  WeightResult,
  WeightTier
} from "./types.js"

const TIER_RANK: Record<WeightTier, number> = {
  trivial: 0,
  standard: 1,
  critical: 2
}

function maxTier(a: WeightTier, b: WeightTier): WeightTier {
  return TIER_RANK[a] >= TIER_RANK[b] ? a : b
}

export interface WeightOptions {
  /** 生成物と E2E のレポートの判定に使う。省略時は既定の testsDir */
  testsDir?: string
  /** Jev の文脈判定の tier の下限(W1-T03 の tierFloor)。上げる向きにだけ効く */
  contextFloor?: WeightTier
}

/** 保護 glob の固定部が空でなく、パスのセグメント列がその固定部で始まるとき true */
function isNearProtected(path: string, globs: readonly string[]): boolean {
  const segments = path.split("/")
  return globs.some((glob) => {
    const fixed = globFixedPart(glob)
      .split("/")
      .filter((s) => s !== "")
    return (
      fixed.length > 0 &&
      fixed.length <= segments.length &&
      fixed.every((s, i) => s === segments[i])
    )
  })
}

function firesAtAsk(findings: Finding[], ruleId: string): boolean {
  return findings.some(
    (f) =>
      f.ruleId === ruleId && (f.severity === "ask" || f.severity === "stop")
  )
}

export function computeWeight(
  artifact: Artifact,
  ruleFindings: Finding[],
  config: RaguelConfig,
  options: WeightOptions = {}
): WeightResult {
  const testsDir = options.testsDir ?? DEFAULT_TESTS_DIR
  const factors: Record<string, number> = {}
  const floors: string[] = []

  if (artifact.kind === "code") {
    factors["kind-base"] = 20
    // 生成物と E2E のレポートは、行数・ファイル数・近接の対象にしない
    const counted = (p: string): boolean =>
      classifyPath(p, config, testsDir) === "normal"

    const parsed = parseDiff(artifact.content)
    const changedLines =
      parsed.files.length > 0
        ? parsed.files
            .filter((f) => counted(f.path))
            .reduce((sum, f) => sum + f.additions.length + f.deletions.length, 0)
        : artifact.content.split("\n").length
    const linesFactor = Math.min(40, Math.floor(changedLines / 25) * 5)
    if (linesFactor > 0) factors["diff-lines"] = linesFactor

    const paths = artifact.changedPaths.filter(counted)
    const filesFactor = Math.min(20, paths.length * 2)
    if (filesFactor > 0) factors["changed-files"] = filesFactor

    const globs = ruleParam<string[]>(config, "code/protected-paths", "globs")
    if (paths.some((p) => isNearProtected(p, globs))) {
      factors["protected-path-proximity"] = 25
    }

    if (ruleFindings.some((f) => f.ruleId === "code/new-dependency")) {
      factors["new-dependency"] = 15
    }
  } else {
    factors["kind-base"] = 30
    const charsFactor = Math.min(
      30,
      Math.floor(artifact.content.length / 4000) * 5
    )
    if (charsFactor > 0) factors["content-length"] = charsFactor
    if (artifact.kind === "plan") {
      const stepCount = countStepsFromContent(artifact.content)
      if (stepCount > 5) {
        factors["plan-steps"] = Math.min(20, (stepCount - 5) * 2)
      }
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

  const raise = (to: WeightTier, label: string): void => {
    if (TIER_RANK[tier] < TIER_RANK[to]) floors.push(`${label}:${to}`)
    tier = maxTier(tier, to)
  }

  // 文書は最低 standard
  if (artifact.kind !== "code") raise("standard", "kind-floor")

  // ルール層に ask 以上の所見があれば最低 standard
  if (ruleFindings.some((f) => f.severity === "ask" || f.severity === "stop")) {
    raise("standard", "rule-ask-floor")
  }

  // protected-paths か irreversible-ops が ask 以上のときだけ critical
  if (
    firesAtAsk(ruleFindings, "code/protected-paths") ||
    firesAtAsk(ruleFindings, "plan/irreversible-ops")
  ) {
    raise("critical", "rule-fire-floor")
  }

  // Jev の文脈判定の下限(上げる向きだけ)
  if (options.contextFloor !== undefined) {
    raise(options.contextFloor, "context-judge-floor")
  }

  return { tier, score, factors, floors }
}
