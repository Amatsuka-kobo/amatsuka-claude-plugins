import { describe, expect, it } from "vitest"
import { FakeJudgeProvider } from "../../testing/fakeProvider.js"
import { makeArtifact } from "../../testing/fixtures.js"
import { runCrosscheck } from "../crosscheck.js"

describe("runCrosscheck", () => {
  it("factTable / priorEvidence 未指定でも実行できる(初回フェーズ)", async () => {
    const provider = new FakeJudgeProvider()
    provider.set("crosscheck", {
      findings: [],
      scores: {
        objective_alignment: 80,
        unintended_changes: 80,
        breaking_changes: 80
      }
    })

    const report = await runCrosscheck(
      { artifact: makeArtifact() },
      provider,
      "haiku",
      5000
    )

    expect(report.panelist).toBe("crosscheck")
    const prompt = provider.calls[0].prompt
    expect(prompt).toContain("初回フェーズ")
    expect(prompt).toContain("事実表なし")
  })

  it("factTable / priorEvidence 指定時はプロンプトに両方向の指示と内容が含まれる", async () => {
    const provider = new FakeJudgeProvider()
    provider.set("crosscheck", {
      findings: [
        {
          severity: "ask",
          confidence: 90,
          message: "計画にあった移行手順が未実施"
        }
      ],
      scores: {
        objective_alignment: 60,
        unintended_changes: 60,
        breaking_changes: 60
      }
    })

    const report = await runCrosscheck(
      {
        artifact: makeArtifact(),
        priorEvidence: "前フェーズでは移行手順を計画済み",
        factTable: "src/login.ts -> 実在する"
      },
      provider,
      "haiku",
      5000
    )

    expect(report.findings[0].ruleId).toBe("panel/crosscheck")
    const prompt = provider.calls[0].prompt
    expect(prompt).toContain("未達")
    expect(prompt).toContain("逸脱")
    expect(prompt).toContain("前フェーズでは移行手順を計画済み")
    expect(prompt).toContain("src/login.ts -> 実在する")
  })
})
