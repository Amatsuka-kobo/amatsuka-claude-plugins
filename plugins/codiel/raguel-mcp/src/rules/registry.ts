/**
 * ルールレジストリ。全ルールモジュールを静的に集約し、
 * kind によるフィルタリングと実行(フェイルクローズド)を提供する。
 */

import { log } from "../core/log.js"
import type {
  Artifact,
  ArtifactKind,
  Finding,
  RaguelConfig,
  Rule,
  RuleContext
} from "../core/types.js"
import { dangerousPatternsRule } from "./code/dangerousPatterns.js"
import { maxDiffLinesRule } from "./code/maxDiffLines.js"
import { newDependencyRule } from "./code/newDependency.js"
import { protectedPathsRule } from "./code/protectedPaths.js"
import { testDeletionRule } from "./code/testDeletion.js"
import { injectionMarkerRule } from "./common/injectionMarker.js"
import { maxSizeRule } from "./common/maxSize.js"
import { resubmissionLoopRule } from "./common/resubmissionLoop.js"
import { secretsRule } from "./common/secrets.js"
import { noAlternativesRule } from "./decision/noAlternatives.js"
import { noRollbackRule } from "./decision/noRollback.js"
import { irreversibleOpsRule } from "./plan/irreversibleOps.js"
import { maxStepsRule } from "./plan/maxSteps.js"
import { scopeKeywordsRule } from "./plan/scopeKeywords.js"

/** 全ルールの静的レジストリ */
export const allRules: Rule[] = [
  // common
  secretsRule,
  injectionMarkerRule,
  resubmissionLoopRule,
  maxSizeRule,
  // code
  protectedPathsRule,
  dangerousPatternsRule,
  maxDiffLinesRule,
  testDeletionRule,
  newDependencyRule,
  // plan / design
  irreversibleOpsRule,
  maxStepsRule,
  scopeKeywordsRule,
  // decision
  noAlternativesRule,
  noRollbackRule
]

function appliesToKind(rule: Rule, kind: ArtifactKind): boolean {
  return rule.appliesTo === "all" || rule.appliesTo.includes(kind)
}

/**
 * kind に該当し、かつ設定で無効化されていないルールを返す。
 * sealed ルールの enabled:false は config 層で拒否済みの前提で、ここでは素直に従う
 */
export function rulesFor(kind: ArtifactKind, config: RaguelConfig): Rule[] {
  return allRules.filter((rule) => {
    if (!appliesToKind(rule, kind)) return false
    if (config.rules[rule.id]?.enabled === false) return false
    return true
  })
}

/**
 * 該当ルールを順に実行し findings を集約する。
 * 1 ルールの例外で全体を落とさない(フェイルクローズド): 例外は severity "ask" の
 * rule-error finding に変換して続行する
 */
export function runRules(artifact: Artifact, ctx: RuleContext): Finding[] {
  const rules = rulesFor(artifact.kind, ctx.config)
  const findings: Finding[] = []

  for (const rule of rules) {
    try {
      findings.push(...rule.check(artifact, ctx))
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      log.warn(`ルール実行中にエラーが発生しました: ${rule.id}`, { message })
      findings.push({
        ruleId: "rule-error",
        severity: "ask",
        message: `ルール "${rule.id}" の実行中にエラーが発生しました: ${message}`,
        evidence: { location: rule.id }
      })
    }
  }

  return findings
}
