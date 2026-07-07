import { describe, expect, it } from "vitest"
import { formatRubric, metaRubricFor, rubricFor } from "./rubrics.js"

describe("rubricFor", () => {
  it("kind ごとに異なる軸を返す", () => {
    const kinds = ["decision", "plan", "design", "code"] as const
    for (const kind of kinds) {
      const axes = rubricFor(kind)
      expect(axes.length).toBeGreaterThan(0)
      for (const axis of axes) {
        expect(axis.key).toMatch(/^[a-z_]+$/)
        expect(axis.label.length).toBeGreaterThan(0)
      }
    }
  })

  it("code は objective_alignment を含む", () => {
    const keys = rubricFor("code").map((a) => a.key)
    expect(keys).toContain("objective_alignment")
  })
})

describe("metaRubricFor", () => {
  it("kind 別軸に blast_radius を追加する", () => {
    const keys = metaRubricFor("plan").map((a) => a.key)
    expect(keys).toContain("blast_radius")
    expect(keys.slice(0, -1)).toEqual(rubricFor("plan").map((a) => a.key))
  })
})

describe("formatRubric", () => {
  it("箇条書き文字列を生成する", () => {
    const text = formatRubric(rubricFor("decision"))
    expect(text).toContain("- objective_alignment: 目的整合")
    expect(text.split("\n")).toHaveLength(rubricFor("decision").length)
  })
})
