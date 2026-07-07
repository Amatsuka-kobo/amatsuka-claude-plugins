import { describe, expect, it } from "vitest"
import { makeArtifact, makeCtx } from "../testHelpers.js"
import { maxSizeRule } from "./maxSize.js"

describe("maxSizeRule", () => {
  it("上限以下では発火しない", () => {
    const findings = maxSizeRule.check(
      makeArtifact({ content: "a".repeat(100) }),
      makeCtx({ rules: { "common/max-size": { limit: 200 } } })
    )
    expect(findings).toEqual([])
  })

  it("上限超過で ask 発火する", () => {
    const findings = maxSizeRule.check(
      makeArtifact({ content: "a".repeat(300) }),
      makeCtx({ rules: { "common/max-size": { limit: 200 } } })
    )
    expect(findings).toHaveLength(1)
    expect(findings[0].severity).toBe("ask")
  })

  it("既定上限は 200000 文字", () => {
    const findings = maxSizeRule.check(
      makeArtifact({ content: "a".repeat(200001) }),
      makeCtx()
    )
    expect(findings).toHaveLength(1)
  })
})
