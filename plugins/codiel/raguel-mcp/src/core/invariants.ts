/**
 * マージ・zod 検証済みの RaguelConfig に対し、docs/DESIGN.md §10 の不変条件のうち
 * 設定レベルで検証できるものをチェックする。違反はサーバー起動失敗として throw する
 * (フェイルクローズド)。
 */

import type { RaguelConfig } from "./types"

/** 設定で無効化できない sealed ルールの一覧(§10 不変条件 3)。list_rules からも参照する */
export const SEALED_RULES: readonly string[] = [
  "common/secrets",
  "common/injection-marker",
  "common/resubmission-loop",
  "code/protected-paths",
  "code/dangerous-patterns"
]

const RESUBMISSION_LOOP_RULE_ID = "common/resubmission-loop"
// sealed ルールの緩和限度: stopAfter はこれを超えて大きくできない(緩和方向の限度値)
const RESUBMISSION_LOOP_MAX_STOP_AFTER = 5

export function assertInvariants(config: RaguelConfig): void {
  assertSteelmanRequiresAdversarial(config)
  assertSealedRulesEnabled(config)
  assertResubmissionLoopLimit(config)
}

// 不変条件 1: 弁護(steelman)は検察(adversarial)が有効なティアでのみ有効化できる
function assertSteelmanRequiresAdversarial(config: RaguelConfig): void {
  const tiers: ReadonlyArray<readonly [string, readonly string[]]> = [
    ["trivial", config.panel.trivial],
    ["standard", config.panel.standard],
    ["critical", config.panel.critical]
  ]
  for (const [tierName, panelists] of tiers) {
    if (panelists.includes("steelman") && !panelists.includes("adversarial")) {
      throw new Error(
        `panel.${tierName} に steelman が含まれていますが adversarial が含まれていません。` +
          "弁護(steelman)は検察(adversarial)が有効なティアでのみ有効化できます(docs/DESIGN.md §10 不変条件 1)。"
      )
    }
  }
}

// 不変条件 3: sealed ルールは enabled: false で無効化できない
function assertSealedRulesEnabled(config: RaguelConfig): void {
  for (const ruleId of SEALED_RULES) {
    if (config.rules[ruleId]?.enabled === false) {
      throw new Error(
        `sealed ルール "${ruleId}" は設定で無効化できません(docs/DESIGN.md §10 不変条件 3)。` +
          "rules から enabled: false の指定を削除してください。"
      )
    }
  }
}

// sealed ルールの緩和限度: common/resubmission-loop の昇格回数(stopAfter)は 5 が上限
function assertResubmissionLoopLimit(config: RaguelConfig): void {
  const stopAfter = config.rules[RESUBMISSION_LOOP_RULE_ID]?.stopAfter
  if (
    typeof stopAfter === "number" &&
    stopAfter > RESUBMISSION_LOOP_MAX_STOP_AFTER
  ) {
    throw new Error(
      `rules."${RESUBMISSION_LOOP_RULE_ID}".stopAfter は ${RESUBMISSION_LOOP_MAX_STOP_AFTER} を超えて緩和できません` +
        `(sealed ルールの緩和限度)。指定値: ${stopAfter}`
    )
  }
}
