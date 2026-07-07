import { describe, expect, it } from "vitest"
import type { Finding } from "../../core/types.js"
import { FakeJudgeProvider } from "../testing/fakeProvider.js"
import { makeArtifact } from "../testing/fixtures.js"
import { runSteelman } from "./steelman.js"

const adversarialFindings: Finding[] = [
  {
    ruleId: "panel/adversarial",
    severity: "ask",
    confidence: 80,
    message: "認証トークンの検証漏れの疑い"
  }
]

describe("runSteelman", () => {
  it("PanelReport と SteelmanVerdicts を両方返す", async () => {
    const provider = new FakeJudgeProvider()
    provider.set("steelman", {
      verdicts: [
        {
          findingIndex: 0,
          rebuttal: "既存ミドルウェアで検証済み",
          outcome: "rebutted"
        }
      ],
      defenseArgument: "この変更は最小限のログイン処理を追加するのみである",
      findings: [],
      scores: {
        objective_alignment: 75,
        unintended_changes: 70,
        breaking_changes: 65
      }
    })

    const outcome = await runSteelman(
      { artifact: makeArtifact(), adversarialFindings },
      provider,
      "sonnet",
      5000
    )

    expect(outcome.report.panelist).toBe("steelman")
    expect(outcome.verdicts).toEqual([
      {
        findingIndex: 0,
        rebuttal: "既存ミドルウェアで検証済み",
        outcome: "rebutted"
      }
    ])
  })

  it("プロンプトに添字付きの検察所見が埋め込まれる", async () => {
    const provider = new FakeJudgeProvider()
    provider.set("steelman", {
      verdicts: [
        { findingIndex: 0, rebuttal: "反論不可", outcome: "conceded" }
      ],
      defenseArgument: "擁護論",
      findings: [],
      scores: {
        objective_alignment: 50,
        unintended_changes: 50,
        breaking_changes: 50
      }
    })

    await runSteelman(
      { artifact: makeArtifact(), adversarialFindings },
      provider,
      "sonnet",
      5000
    )

    const prompt = provider.calls[0].prompt
    expect(prompt).toContain("[0]")
    expect(prompt).toContain("認証トークンの検証漏れの疑い")
    expect(prompt).toContain("conceded")
  })
})
