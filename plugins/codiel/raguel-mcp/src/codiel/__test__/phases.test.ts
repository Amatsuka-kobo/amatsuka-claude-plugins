import { describe, expect, it } from "vitest"
// 2 者比較テスト(設計書 §6.14 の 1 本目)。テスト時だけ codiel の src を相対パスで読む。
import { GATED, STAGES } from "../../../../src/codiel-state"
import { findPhase, GATED_PHASES, priorPhasesOf } from "../phases"

describe("フェーズの表と codiel の STAGES・GATED の一致", () => {
  it("ゲート付きフェーズの名前の集合が GATED と等しい", () => {
    expect(new Set(GATED_PHASES.map((e) => e.phase))).toEqual(GATED)
  })

  it("ステージ番号が STAGES の添字と等しい", () => {
    for (const e of GATED_PHASES) {
      expect(
        STAGES.findIndex((s) => s.includes(e.phase)),
        e.phase
      ).toBe(e.stage)
    }
  })

  it("STAGES のゲート付きフェーズが表と同じ順で並ぶ", () => {
    const fromCodiel = STAGES.flat().filter((p) => GATED.has(p))
    expect(GATED_PHASES.map((e) => e.phase)).toEqual(fromCodiel)
  })

  it("kind とツールの組が食い違わない", () => {
    for (const e of GATED_PHASES) expect(e.tool).toBe(`evaluate_${e.kind}`)
  })
})

describe("priorPhasesOf", () => {
  it("test-spec と dev-plan は互いに前フェーズにならない", () => {
    expect(priorPhasesOf("test-spec")).not.toContain("dev-plan")
    expect(priorPhasesOf("dev-plan")).not.toContain("test-spec")
  })

  it("ステージ番号がより小さいゲート付きフェーズをすべて返す", () => {
    expect(priorPhasesOf("intent")).toEqual([])
    expect(priorPhasesOf("test-code")).toEqual([
      "intent",
      "design",
      "test-spec",
      "dev-plan"
    ])
    expect(priorPhasesOf("fix-loop")).toHaveLength(8)
  })

  it("ゲートの無いフェーズは表に無く、空配列を返す", () => {
    expect(findPhase("review")).toBeUndefined()
    expect(priorPhasesOf("review")).toEqual([])
  })
})
