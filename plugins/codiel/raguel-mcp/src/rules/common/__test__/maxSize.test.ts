import { describe, expect, it } from "vitest"
import { makeArtifact, makeCtx } from "../../testHelpers.js"
import { maxSizeRule } from "../maxSize.js"

describe("maxSizeRule", () => {
  it("上限以下では出ない", () => {
    const findings = maxSizeRule.check(
      makeArtifact({ content: "a".repeat(100) }),
      makeCtx({ rules: { "common/max-size": { limit: 200 } } })
    )
    expect(findings).toEqual([])
  })

  it("上限を超えると ask で出る", () => {
    const findings = maxSizeRule.check(
      makeArtifact({ content: "a".repeat(300) }),
      makeCtx({ rules: { "common/max-size": { limit: 200 } } })
    )
    expect(findings).toHaveLength(1)
    expect(findings[0].severity).toBe("ask")
  })

  it("既定の上限は 200000 文字", () => {
    expect(
      maxSizeRule.check(
        makeArtifact({ content: "a".repeat(200000) }),
        makeCtx()
      )
    ).toEqual([])
    expect(
      maxSizeRule.check(
        makeArtifact({ content: "a".repeat(200001) }),
        makeCtx()
      )
    ).toHaveLength(1)
  })

  it("設定の rules にこのルールが無くても、表の既定値を使う", () => {
    const findings = maxSizeRule.check(
      makeArtifact({ content: "a".repeat(200001) }),
      makeCtx({ rules: {} })
    )
    expect(findings).toHaveLength(1)
  })
})
