import { describe, expect, it } from "vitest"
import { makeArtifact, makeCtx } from "../../testHelpers.js"
import { maxStepsRule } from "../maxSteps.js"

describe("maxStepsRule", () => {
  it("steps 配列が上限以下では発火しない", () => {
    const findings = maxStepsRule.check(
      makeArtifact({ kind: "plan", steps: ["a", "b", "c"] }),
      makeCtx()
    )
    expect(findings).toEqual([])
  })

  it("steps 配列が上限超過で ask 発火する", () => {
    const findings = maxStepsRule.check(
      makeArtifact({
        kind: "plan",
        steps: Array.from({ length: 16 }, (_, i) => `step ${i}`)
      }),
      makeCtx()
    )
    expect(findings).toHaveLength(1)
    expect(findings[0].severity).toBe("ask")
  })

  it("steps が空なら本文の番号付きリストから推定する", () => {
    const content = Array.from(
      { length: 20 },
      (_, i) => `${i + 1}. do something`
    ).join("\n")
    const findings = maxStepsRule.check(
      makeArtifact({ kind: "plan", content, steps: [] }),
      makeCtx()
    )
    expect(findings).toHaveLength(1)
  })

  it("steps が空ならチェックボックスからも推定する", () => {
    const content = Array.from({ length: 20 }, () => "- [ ] task").join("\n")
    const findings = maxStepsRule.check(
      makeArtifact({ kind: "plan", content, steps: [] }),
      makeCtx()
    )
    expect(findings).toHaveLength(1)
  })

  it("設定で limit を調整できる", () => {
    const findings = maxStepsRule.check(
      makeArtifact({ kind: "plan", steps: ["a", "b", "c"] }),
      makeCtx({ rules: { "plan/max-steps": { limit: 2 } } })
    )
    expect(findings).toHaveLength(1)
  })
})
