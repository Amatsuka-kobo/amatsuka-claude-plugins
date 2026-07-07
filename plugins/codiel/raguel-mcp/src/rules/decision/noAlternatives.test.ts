import { describe, expect, it } from "vitest"
import { makeArtifact, makeCtx } from "../testHelpers.js"
import { noAlternativesRule } from "./noAlternatives.js"

describe("noAlternativesRule", () => {
  it("既定 severity は info", () => {
    const findings = noAlternativesRule.check(
      makeArtifact({ kind: "decision", content: "この方式を採用する" }),
      makeCtx()
    )
    expect(findings).toHaveLength(1)
    expect(findings[0].severity).toBe("info")
  })

  it("optionsConsidered があれば発火しない", () => {
    const findings = noAlternativesRule.check(
      makeArtifact({
        kind: "decision",
        content: "この方式を採用する",
        context: { optionsConsidered: ["案A", "案B"] }
      }),
      makeCtx()
    )
    expect(findings).toEqual([])
  })

  it("本文に代替案への言及があれば発火しない", () => {
    const findings = noAlternativesRule.check(
      makeArtifact({
        kind: "decision",
        content: "他の選択肢も比較したうえでこの方式を採用する"
      }),
      makeCtx()
    )
    expect(findings).toEqual([])
  })

  it("英語の alternative / option への言及でも発火しない", () => {
    const findings = noAlternativesRule.check(
      makeArtifact({
        kind: "decision",
        content: "We considered another option before choosing this."
      }),
      makeCtx()
    )
    expect(findings).toEqual([])
  })
})
