import { describe, expect, it } from "vitest"
import { makeArtifact, makeCtx } from "../../testHelpers.js"
import { maxStepsRule } from "../maxSteps.js"

function check(content: string, ctx = makeCtx()) {
  return maxStepsRule.check(makeArtifact({ kind: "plan", content }), ctx)
}

function stepHeadings(n: number): string {
  return Array.from(
    { length: n },
    (_, i) => `## Step ${i + 1}: 作業 ${i + 1}\n本文`
  ).join("\n")
}

function numberedList(n: number): string {
  return Array.from({ length: n }, (_, i) => `${i + 1}. 手順`).join("\n")
}

describe("maxStepsRule(所見 A9)", () => {
  it("plan だけに当て、既定は info", () => {
    expect(maxStepsRule.appliesTo).toEqual(["plan"])
    expect(maxStepsRule.defaultSeverity).toBe("info")
  })

  it("`## Step N` の見出しを数え、上限を超えたら info を出す", () => {
    expect(check(stepHeadings(15))).toEqual([])
    const findings = check(stepHeadings(25))
    expect(findings).toHaveLength(1)
    expect(findings[0].severity).toBe("info")
    expect(findings[0].message).toContain("実際: 25")
  })

  it("見出しがあれば番号付きリストを数えない", () => {
    expect(check(`${stepHeadings(2)}\n${numberedList(20)}`)).toEqual([])
  })

  it("見出しが無ければ番号付きリストを数える", () => {
    expect(check(numberedList(20))).toHaveLength(1)
  })

  it("設定で limit を調整できる", () => {
    const ctx = makeCtx({ rules: { "plan/max-steps": { limit: 2 } } })
    expect(check(stepHeadings(3), ctx)).toHaveLength(1)
  })
})
