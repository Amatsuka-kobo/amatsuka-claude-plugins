import { describe, expect, it } from "vitest"
import type { Precedent } from "../../../core/types.js"
import { FakeJudgeProvider } from "../../testing/fakeProvider.js"
import { makeArtifact } from "../../testing/fixtures.js"
import { runPrecedent } from "../precedent.js"

const rejectedPrecedent: Precedent = {
  id: "seed-001",
  source: "seed",
  kind: "code",
  outcome: "rejected",
  summary: "存在しない API を呼び出して失敗した",
  firedRules: ["code/dangerous-patterns"],
  changedPaths: [],
  lesson: "API の実在を確認すること"
}

const approvedPrecedent: Precedent = {
  id: "project-002",
  source: "project",
  kind: "code",
  outcome: "approved",
  summary: "同種のログイン機能追加が承認された",
  firedRules: [],
  changedPaths: [],
  lesson: "小規模な認証追加は低リスク"
}

describe("runPrecedent", () => {
  it("該当する失敗判例のみ finding 化し、message に判例 id を含める", async () => {
    const provider = new FakeJudgeProvider()
    provider.set("precedent", {
      evaluations: [
        {
          precedentId: "seed-001",
          applies: true,
          confidence: 85,
          rationale: "同様に存在しない API を仮定している"
        },
        {
          precedentId: "project-002",
          applies: true,
          confidence: 90,
          rationale: "同型の低リスク変更"
        }
      ],
      scores: {
        objective_alignment: 80,
        unintended_changes: 80,
        breaking_changes: 80
      }
    })

    const report = await runPrecedent(
      {
        artifact: makeArtifact(),
        precedents: [rejectedPrecedent, approvedPrecedent]
      },
      provider,
      "haiku",
      5000
    )

    expect(report.findings).toHaveLength(1)
    expect(report.findings[0].ruleId).toBe("panel/precedent")
    expect(report.findings[0].message).toContain("seed-001")
    // approved 判例は findings 化されない
    expect(report.findings.some((f) => f.message.includes("project-002"))).toBe(
      false
    )
  })

  it("applies: false の失敗判例は finding 化されない", async () => {
    const provider = new FakeJudgeProvider()
    provider.set("precedent", {
      evaluations: [
        {
          precedentId: "seed-001",
          applies: false,
          confidence: 20,
          rationale: "本件には該当しない"
        }
      ],
      scores: {
        objective_alignment: 80,
        unintended_changes: 80,
        breaking_changes: 80
      }
    })

    const report = await runPrecedent(
      { artifact: makeArtifact(), precedents: [rejectedPrecedent] },
      provider,
      "haiku",
      5000
    )

    expect(report.findings).toHaveLength(0)
  })
})
