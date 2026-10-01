import { describe, expect, it } from "vitest"
import { makeArtifact, makeCtx } from "../../testHelpers.js"
import { maxDiffLinesRule } from "../maxDiffLines.js"
import { fileDiff } from "./helpers/diff.js"

function diffWithNAdditions(n: number): string {
  return fileDiff(
    "big.ts",
    Array.from({ length: n }, (_, i) => `line${i}`)
  )
}

describe("maxDiffLinesRule", () => {
  it("上限以下では発火しない", () => {
    const findings = maxDiffLinesRule.check(
      makeArtifact({ content: diffWithNAdditions(500) }),
      makeCtx()
    )
    expect(findings).toEqual([])
  })

  it("上限超過で ask 発火する", () => {
    const findings = maxDiffLinesRule.check(
      makeArtifact({ content: diffWithNAdditions(501) }),
      makeCtx()
    )
    expect(findings).toHaveLength(1)
    expect(findings[0].severity).toBe("ask")
  })

  it("設定で limit を調整できる", () => {
    const findings = maxDiffLinesRule.check(
      makeArtifact({ content: diffWithNAdditions(10) }),
      makeCtx({ rules: { "code/max-diff-lines": { limit: 5 } } })
    )
    expect(findings).toHaveLength(1)
  })
})
