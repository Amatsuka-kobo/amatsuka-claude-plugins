/**
 * 判定の合成規則(設計書 2026-10-01-codiel-run-speedup-design.md §4.5)。
 * 上から順に評価し、最初に該当した行で確定する。決定論の純関数。
 * 1. ルール層に stop がある → STOP
 * 2. 設定の読み込みエラーか内部エラー → ASK(degraded)
 * 3. ルール層か Jev に ask がある → ASK
 * 4. それ以外 → PROCEED
 * 個々のルールの例外は rule-error の ask(rules/registry.ts)なので、3 の通常の ASK になる。
 */

import type { DegradedReason, Finding, JudgeStatus, Verdict } from "./types.js"

export interface SynthesisInput {
  /** ルール層の所見(前フェーズの改竄の casefile/tampered と、Jev が補正・追加した所見を含む) */
  ruleFindings: Finding[]
  /** 設定の読み込みエラーと内部エラー(kernel・config) */
  degradedReasons?: DegradedReason[]
}

export interface SynthesisResult {
  verdict: Verdict
  judgeStatus: JudgeStatus
  /** judgeStatus が degraded のときだけ中身がある */
  degradedReasons: DegradedReason[]
  findings: Finding[]
  /** 当てた行の記録 */
  reasons: string[]
  /** ASK と STOP のとき、人が判断することを 1 文で(所見 D6) */
  decisionPoint?: string
}

function uniqueIds(findings: readonly Finding[]): string {
  return [...new Set(findings.map((f) => f.ruleId))].join("、")
}

export function synthesize(input: SynthesisInput): SynthesisResult {
  const findings = [...input.ruleFindings]
  const result = (
    verdict: Verdict,
    reason: string,
    extra: Partial<
      Pick<SynthesisResult, "judgeStatus" | "degradedReasons" | "decisionPoint">
    > = {}
  ): SynthesisResult => ({
    verdict,
    judgeStatus: extra.judgeStatus ?? "ok",
    degradedReasons: extra.degradedReasons ?? [],
    findings,
    reasons: [reason],
    ...(extra.decisionPoint ? { decisionPoint: extra.decisionPoint } : {})
  })

  // 1. ルール層の stop。障害があっても judgeStatus は ok のまま
  const stops = findings.filter((f) => f.severity === "stop")
  if (stops.length > 0) {
    return result(
      "STOP",
      `rule-stop: ルール層の stop(${uniqueIds(stops)})により STOP`,
      {
        decisionPoint: `ルール層の stop の所見(${uniqueIds(stops)})を解消して再提出するか、誤検知として裁定するかを判断する。`
      }
    )
  }

  // 2. 設定の読み込みエラーか内部エラー
  const degradedReasons = input.degradedReasons ?? []
  if (degradedReasons.length > 0) {
    const sources = [...new Set(degradedReasons.map((r) => r.source))].join(
      "、"
    )
    return result(
      "ASK",
      `degraded: 基盤の障害(${degradedReasons.map((r) => `${r.source}: ${r.reason}`).join("、")})により ASK`,
      {
        judgeStatus: "degraded",
        degradedReasons,
        decisionPoint: `判定の基盤に障害があり(${sources})審査が欠けているので、人が成果物を確かめて進めるか、再評価するかを判断する。`
      }
    )
  }

  // 3. ルール層か Jev の ask
  const asks = findings.filter((f) => f.severity === "ask")
  if (asks.length > 0) {
    return result("ASK", `ask: ask の所見(${uniqueIds(asks)})により ASK`, {
      decisionPoint: `ask の所見(${uniqueIds(asks)})が妥当か、成果物を直すべきかを判断する。`
    })
  }

  // 4. PROCEED
  return result("PROCEED", "pass: ask 以上の所見が無いため PROCEED")
}
