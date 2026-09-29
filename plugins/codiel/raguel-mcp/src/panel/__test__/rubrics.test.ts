import { describe, expect, it } from "vitest"
import { formatRubric, metaRubricFor, rubricFor } from "../rubrics.js"

describe("rubricFor(所見 C2 の軸の名前)", () => {
  it("kind ごとの軸は設計書 §6.6.2 の表のとおり", () => {
    const keys = (kind: Parameters<typeof rubricFor>[0]) =>
      rubricFor(kind).map((a) => a.key)
    expect(keys("decision")).toEqual([
      "objective_alignment",
      "risk_awareness",
      "reversibility",
      "alternatives_considered"
    ])
    expect(keys("plan")).toEqual([
      "objective_alignment",
      "scope_fit",
      "procedure_completeness",
      "risk_controlled"
    ])
    expect(keys("design")).toEqual([
      "requirement_coverage",
      "appropriate_complexity",
      "consistency"
    ])
    expect(keys("code")).toEqual([
      "objective_alignment",
      "no_unintended_changes",
      "no_breaking_changes"
    ])
  })

  it("旧版の、高い点が問題を表すと読める軸の名前を持たない", () => {
    const all = (["decision", "plan", "design", "code"] as const).flatMap((k) =>
      metaRubricFor(k).map((a) => a.key)
    )
    for (const old of [
      "risk",
      "over_engineering",
      "unintended_changes",
      "breaking_changes",
      "blast_radius",
      "scope_appropriateness"
    ]) {
      expect(all).not.toContain(old)
    }
  })
})

describe("metaRubricFor", () => {
  it("kind の軸に blast_radius_contained を足す", () => {
    const keys = metaRubricFor("plan").map((a) => a.key)
    expect(keys.at(-1)).toBe("blast_radius_contained")
    expect(keys.slice(0, -1)).toEqual(rubricFor("plan").map((a) => a.key))
  })
})

describe("formatRubric", () => {
  it("軸ごとに 1 行の箇条書きにする", () => {
    const text = formatRubric(rubricFor("decision"))
    expect(text).toContain("- objective_alignment: 目的に沿っている")
    expect(text.split("\n")).toHaveLength(rubricFor("decision").length)
  })
})
