import { describe, expect, it } from "vitest"
import { FakeJudgeProvider } from "../../testing/fakeProvider.js"
import { makeArtifact } from "../../testing/fixtures.js"
import { runAdversarial } from "../adversarial.js"

describe("runAdversarial", () => {
  it("findings の ruleId を panel/adversarial に上書きし、PanelReport を返す", async () => {
    const provider = new FakeJudgeProvider()
    provider.set("adversarial", {
      findings: [
        {
          severity: "ask",
          confidence: 80,
          message: "認証トークンの検証漏れの疑い"
        }
      ],
      scores: {
        objective_alignment: 70,
        unintended_changes: 60,
        breaking_changes: 50
      }
    })

    const report = await runAdversarial(
      { artifact: makeArtifact(), ruleFindings: [] },
      provider,
      "haiku",
      5000
    )

    expect(report.panelist).toBe("adversarial")
    expect(report.model).toBe("haiku")
    expect(report.findings).toHaveLength(1)
    expect(report.findings[0].ruleId).toBe("panel/adversarial")
    expect(report.scores.objective_alignment).toBe(70)
  })

  it("プロンプトにセキュリティ観点の攻撃指示と成果物・objective が含まれる", async () => {
    const provider = new FakeJudgeProvider()
    provider.set("adversarial", {
      findings: [],
      scores: {
        objective_alignment: 80,
        unintended_changes: 80,
        breaking_changes: 80
      }
    })

    await runAdversarial(
      { artifact: makeArtifact(), ruleFindings: [] },
      provider,
      "haiku",
      5000
    )

    expect(provider.calls).toHaveLength(1)
    const prompt = provider.calls[0].prompt
    expect(prompt).toContain("セキュリティ観点の攻撃")
    expect(prompt).toContain("ログイン機能を追加する")
    expect(prompt).toContain("export function login")
  })
})
