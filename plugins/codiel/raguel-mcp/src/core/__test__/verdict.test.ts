/**
 * 合成規則の 4 行(設計書 2026-10-01-codiel-run-speedup-design.md §4.5)。
 * 上から順に評価し、最初に該当した行で確定することを確かめる。
 */

import { describe, expect, it } from "vitest"
import type { Finding } from "../types.js"
import { type SynthesisInput, synthesize } from "../verdict.js"

function finding(ruleId: string, severity: Finding["severity"]): Finding {
  return { ruleId, severity, message: `test ${ruleId}` }
}

function input(overrides: Partial<SynthesisInput> = {}): SynthesisInput {
  return { ruleFindings: [], ...overrides }
}

describe("1 行目: ルール層の stop", () => {
  it("stop があれば STOP。障害と ask があっても judgeStatus は ok", () => {
    const r = synthesize(
      input({
        ruleFindings: [
          finding("code/unsafe-exec", "ask"),
          finding("code/destructive-ops", "stop")
        ],
        degradedReasons: [{ source: "kernel", reason: "internal-error" }]
      })
    )
    expect(r.verdict).toBe("STOP")
    expect(r.judgeStatus).toBe("ok")
    expect(r.degradedReasons).toEqual([])
    expect(r.reasons).toHaveLength(1)
    expect(r.reasons[0]).toMatch(/^rule-stop:/)
    expect(r.decisionPoint).toContain("code/destructive-ops")
    expect(r.findings).toHaveLength(2)
  })
})

describe("2 行目: 設定の読み込みエラーか内部エラー", () => {
  it.each([
    [{ source: "config", reason: "config-error" }],
    [{ source: "kernel", reason: "internal-error" }]
  ])("%j は degraded の ASK で、所見 0 件でも decisionPoint を返す(D6)", (reason) => {
    const r = synthesize(input({ degradedReasons: [reason] }))
    expect(r.verdict).toBe("ASK")
    expect(r.judgeStatus).toBe("degraded")
    expect(r.degradedReasons).toEqual([reason])
    expect(r.findings).toEqual([])
    expect(r.decisionPoint).toContain(reason.source)
    expect(r.reasons[0]).toMatch(/^degraded:/)
  })

  it("障害は ask より先に当たる", () => {
    const r = synthesize(
      input({
        ruleFindings: [finding("code/unsafe-exec", "ask")],
        degradedReasons: [{ source: "kernel", reason: "internal-error" }]
      })
    )
    expect(r.judgeStatus).toBe("degraded")
    expect(r.reasons[0]).toMatch(/^degraded:/)
  })
})

describe("3 行目: ルール層か Jev の ask", () => {
  it.each([
    "code/unsafe-exec",
    "common/injection-marker",
    "judge/code-out-of-scope"
  ])("%s の ask は ASK で、judgeStatus は ok", (ruleId) => {
    const r = synthesize(
      input({
        ruleFindings: [
          finding(ruleId, "ask"),
          finding("plan/max-steps", "info")
        ]
      })
    )
    expect(r.verdict).toBe("ASK")
    expect(r.judgeStatus).toBe("ok")
    expect(r.degradedReasons).toEqual([])
    expect(r.reasons[0]).toMatch(/^ask:/)
    expect(r.decisionPoint).toContain(ruleId)
  })

  it("個々のルールの例外(rule-error の ask)は degraded にせず、通常の ASK にする", () => {
    const r = synthesize(
      input({ ruleFindings: [finding("rule-error", "ask")] })
    )
    expect(r.verdict).toBe("ASK")
    expect(r.judgeStatus).toBe("ok")
    expect(r.degradedReasons).toEqual([])
    expect(r.reasons[0]).toMatch(/^ask:/)
  })
})

describe("4 行目: それ以外", () => {
  it.each([
    [[]],
    [
      [
        finding("plan/scope-keywords", "info"),
        finding("contextJudge/unavailable", "info")
      ]
    ]
  ])("ask 以上が無ければ PROCEED(decisionPoint なし)", (ruleFindings) => {
    const r = synthesize(input({ ruleFindings }))
    expect(r.verdict).toBe("PROCEED")
    expect(r.judgeStatus).toBe("ok")
    expect(r.decisionPoint).toBeUndefined()
    expect(r.reasons[0]).toMatch(/^pass:/)
    expect(r.findings).toEqual(ruleFindings)
  })
})
