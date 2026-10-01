import { describe, expect, it } from "vitest"
import type { Precedent } from "../../../core/types.js"
import {
  FakeJudgeProvider,
  makeCtl
} from "../../__test__/helpers/fakeProvider.js"
import { makeArtifact } from "../../__test__/helpers/fixtures.js"
import { PRECEDENTS_HEADING, SCORE_SCALE } from "../../prompts.js"
import { runAdversarial } from "../adversarial.js"

const scores = {
  objective_alignment: 80,
  no_unintended_changes: 80,
  no_breaking_changes: 80
}

const precedent: Precedent = {
  id: "p-001",
  source: "project",
  kind: "code",
  phase: "implement",
  outcome: "incident",
  ruling: "revise",
  summary: "認証の抜けで事故",
  firedRules: [],
  changedPaths: [],
  lesson: "認証の経路を確かめる",
  recordedAt: "2026-09-01T00:00:00.000Z"
}

describe("runAdversarial", () => {
  it("findings の ruleId を panel/adversarial に上書きし、PanelReport を返す", async () => {
    const provider = new FakeJudgeProvider()
    provider.set("adversarial", {
      findings: [
        { severity: "ask", confidence: 80, message: "認証トークンの検証漏れ" }
      ],
      scores: { ...scores, objective_alignment: 70 }
    })

    const report = await runAdversarial(
      { artifact: makeArtifact(), ruleFindings: [], precedents: [] },
      provider,
      "haiku",
      makeCtl()
    )

    expect(report.panelist).toBe("adversarial")
    expect(report.model).toBe("haiku")
    expect(report.findings[0].ruleId).toBe("panel/adversarial")
    expect(report.scores.objective_alignment).toBe(70)
  })

  it("職務はセキュリティと暗黙の前提の点検で、筋書きの無い懸念は所見にせず 0 件を許す", async () => {
    const provider = new FakeJudgeProvider()
    provider.set("adversarial", { findings: [], scores })

    await runAdversarial(
      { artifact: makeArtifact(), ruleFindings: [], precedents: [] },
      provider,
      "haiku",
      makeCtl()
    )

    const prompt = provider.calls[0].prompt
    expect(prompt).not.toContain("必ず 1 件以上")
    expect(prompt).toContain(
      "権限・機密情報・インジェクション・破壊的操作・サプライチェーン"
    )
    expect(prompt).toContain("暗黙に置いている前提")
    expect(prompt).toContain("具体的な失敗の筋書き")
    expect(prompt).toContain("空の配列でよい")
    expect(prompt).toContain(SCORE_SCALE)
    expect(prompt).toContain("ログイン機能を追加する")
    expect(prompt).toContain("export function login")
  })

  it("判例を日付・outcome・ruling を添えて参考入力に載せる", async () => {
    const provider = new FakeJudgeProvider()
    provider.set("adversarial", { findings: [], scores })

    await runAdversarial(
      { artifact: makeArtifact(), ruleFindings: [], precedents: [precedent] },
      provider,
      "haiku",
      makeCtl()
    )

    const prompt = provider.calls[0].prompt
    expect(prompt).toContain(PRECEDENTS_HEADING)
    expect(prompt).toContain("2026-09-01")
    expect(prompt).toContain("outcome: incident")
    expect(prompt).toContain("ruling: revise")
    expect(prompt).toContain("認証の経路を確かめる")
  })

  it("CallControl をそのままプロバイダーへ渡す", async () => {
    const provider = new FakeJudgeProvider()
    provider.set("adversarial", { findings: [], scores })
    const ctl = makeCtl({ timeoutMs: 1234 })

    await runAdversarial(
      { artifact: makeArtifact(), ruleFindings: [], precedents: [] },
      provider,
      "haiku",
      ctl
    )

    expect(provider.calls[0].ctl).toBe(ctl)
  })
})
