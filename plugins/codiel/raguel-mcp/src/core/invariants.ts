/**
 * マージと zod の検証を通った RaguelConfig に、設計書 §6.12.3 の検査を当てる。
 * 違反は読み込みエラーとして throw する(フェイルクローズド)。
 * 型と列挙の値(thresholds の 0〜1 など)は config/schema.ts が拒む。
 */

import { globFixedPart, isNegatedGlob } from "../config/paths"
import {
  DEFAULT_PROTECTED_GLOBS,
  MAX_SIMILARITY_THRESHOLD,
  RULE_SPECS,
  STOP_CAPABLE_RULE_IDS
} from "../rules/params"
import type { RaguelConfig, Severity } from "./types"

/** 設定で無効にできず、severity を既定より軽くできないルール。list_rules からも参照する */
export const SEALED_RULES: readonly string[] = RULE_SPECS.filter(
  (spec) => spec.sealed
).map((spec) => spec.id)

/** contextJudge.timeoutMs の上限(R21) */
export const MAX_TIMEOUT_MS = 1800000

const SEVERITY_RANK: Record<Severity, number> = { info: 0, ask: 1, stop: 2 }

/**
 * allowPatterns が一致してはならない見本の秘密情報。
 * 見本そのものが秘密情報の検出に掛からないよう、実行時に組み立てる
 */
const SAMPLE_SECRETS: readonly string[] = [
  `sk-ant-api03-${"A1b2C3d4".repeat(12)}`,
  `AKIA${"ABCDEFGHIJ234567"}`,
  `ghp_${"a1B2c3D4e5".repeat(4)}`.slice(0, 40),
  `-----BEGIN ${"RSA PRIVATE"} KEY-----`
]

export function assertInvariants(config: RaguelConfig): void {
  assertRuleSeverities(config)
  assertAllowPatterns(config)
  assertResubmissionThreshold(config)
  assertProtectedPathsParams(config)
  assertIgnoreUncommitted(config)
  assertTimeLimits(config)
  assertContextJudgeThresholds(config)
}

// sealed ルールの無効化と severity の引き下げ、STOP を出せないルールの stop
function assertRuleSeverities(config: RaguelConfig): void {
  for (const spec of RULE_SPECS) {
    const settings = config.rules[spec.id]
    if (spec.sealed && settings?.enabled === false) {
      throw new Error(
        `sealed ルール "${spec.id}" は設定で無効にできません。rules から enabled: false を削除してください。`
      )
    }
    const severity = settings?.severity
    if (severity === undefined) continue
    if (
      spec.sealed &&
      SEVERITY_RANK[severity] < SEVERITY_RANK[spec.defaultSeverity]
    ) {
      throw new Error(
        `sealed ルール "${spec.id}" の severity は既定の ${spec.defaultSeverity} より軽くできません(指定値: ${severity})。`
      )
    }
    if (severity === "stop" && !STOP_CAPABLE_RULE_IDS.includes(spec.id)) {
      throw new Error(
        `ルール "${spec.id}" は severity: stop にできません。STOP を出せるのは ${STOP_CAPABLE_RULE_IDS.join("・")} だけです。`
      )
    }
  }
}

// common/secrets.allowPatterns は正しい正規表現で、空文字列と見本の秘密情報に一致しない
function assertAllowPatterns(config: RaguelConfig): void {
  const patterns = config.rules["common/secrets"]?.allowPatterns
  if (!Array.isArray(patterns)) return
  for (const pattern of patterns as string[]) {
    let re: RegExp
    try {
      re = new RegExp(pattern)
    } catch (err) {
      throw new Error(
        `rules."common/secrets".allowPatterns の正規表現が不正です: ${pattern}(${(err as Error).message})`
      )
    }
    if (re.test("")) {
      throw new Error(
        `rules."common/secrets".allowPatterns に空文字列に一致する正規表現は置けません: ${pattern}`
      )
    }
    if (SAMPLE_SECRETS.some((sample) => re.test(sample))) {
      throw new Error(
        `rules."common/secrets".allowPatterns が内蔵の見本の秘密情報に一致します。秘密情報の検出を外す正規表現は置けません: ${pattern}`
      )
    }
  }
}

// common/resubmission-loop.similarityThreshold の緩和の限度
function assertResubmissionThreshold(config: RaguelConfig): void {
  const threshold =
    config.rules["common/resubmission-loop"]?.similarityThreshold
  if (typeof threshold === "number" && threshold > MAX_SIMILARITY_THRESHOLD) {
    throw new Error(
      `rules."common/resubmission-loop".similarityThreshold は ${MAX_SIMILARITY_THRESHOLD} を超えられません(指定値: ${threshold})。`
    )
  }
}

// code/protected-paths の excludeDefaults と generated(R20)
function assertProtectedPathsParams(config: RaguelConfig): void {
  const settings = config.rules["code/protected-paths"]
  const excluded = settings?.excludeDefaults
  if (Array.isArray(excluded)) {
    for (const glob of excluded as string[]) {
      if (!DEFAULT_PROTECTED_GLOBS.includes(glob)) {
        throw new Error(
          `rules."code/protected-paths".excludeDefaults に既定の glob と一致しない文字列があります: ${glob}。` +
            `外せるのは ${DEFAULT_PROTECTED_GLOBS.join("・")} だけです。`
        )
      }
    }
  }
  const generated = settings?.generated
  if (Array.isArray(generated)) {
    for (const glob of generated as string[]) {
      if (isNegatedGlob(glob)) {
        throw new Error(
          `rules."code/protected-paths".generated に否定の glob は置けません: ${glob}。` +
            "否定は指定した範囲の外すべてに一致します。除く範囲でなく含める範囲を書いてください(例: dist/**)。"
        )
      }
      if (globFixedPart(glob) === "") {
        throw new Error(
          `rules."code/protected-paths".generated に固定部の無い glob は置けません: ${glob}。` +
            "ワイルドカードより前にディレクトリを書いてください(例: dist/**)。"
        )
      }
    }
  }
}

// subject.ignoreUncommitted の glob には固定部が要る(§6.2.2 の手順 3)。作業ツリー全体を検査から外させない
function assertIgnoreUncommitted(config: RaguelConfig): void {
  for (const glob of config.subject.ignoreUncommitted) {
    if (isNegatedGlob(glob)) {
      throw new Error(
        `subject.ignoreUncommitted に否定の glob は置けません: ${glob}。` +
          "否定は指定した範囲の外すべてに一致します。除く範囲でなく含める範囲を書いてください(例: docs/chat/**)。"
      )
    }
    if (globFixedPart(glob) === "") {
      throw new Error(
        `subject.ignoreUncommitted に固定部の無い glob は置けません: ${glob}。` +
          "ワイルドカードより前にディレクトリを書いてください(例: docs/chat/**)。"
      )
    }
  }
}

// Jev の問い合わせの時間の上限(R21、R19)
function assertTimeLimits(config: RaguelConfig): void {
  const { timeoutMs } = config.contextJudge
  if (timeoutMs > MAX_TIMEOUT_MS) {
    throw new Error(
      `contextJudge.timeoutMs は ${MAX_TIMEOUT_MS} を超えられません(指定値: ${timeoutMs})。`
    )
  }
}

// contextJudge.thresholds は lower < raise(0〜1 の範囲はスキーマが拒む)
function assertContextJudgeThresholds(config: RaguelConfig): void {
  const { lower, raise } = config.contextJudge.thresholds
  if (lower >= raise) {
    throw new Error(
      `contextJudge.thresholds.lower(${lower})は raise(${raise})より小さくしてください。`
    )
  }
}
