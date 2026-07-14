import { describe, expect, it } from "vitest"
import { FakeJudgeProvider } from "../../testing/fakeProvider.js"
import { makeArtifact } from "../../testing/fixtures.js"
import { runAssumption } from "../assumption.js"

describe("runAssumption", () => {
  it("前提監査の findings/scores を PanelReport として返す", async () => {
    const provider = new FakeJudgeProvider()
    provider.set("assumption", {
      findings: [
        {
          severity: "ask",
          confidence: 65,
          message: "既存のセッション管理と互換であることが未検証"
        }
      ],
      scores: {
        objective_alignment: 70,
        unintended_changes: 70,
        breaking_changes: 70
      }
    })

    const report = await runAssumption(
      { artifact: makeArtifact() },
      provider,
      "haiku",
      5000
    )

    expect(report.panelist).toBe("assumption")
    expect(report.findings[0].ruleId).toBe("panel/assumption")
    const prompt = provider.calls[0].prompt
    expect(prompt).toContain("前提")
  })
})
