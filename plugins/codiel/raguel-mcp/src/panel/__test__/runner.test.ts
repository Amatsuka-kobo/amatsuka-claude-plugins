import { describe, expect, it } from "vitest"
import type { RaguelConfig } from "../../core/types.js"
import { JudgeError } from "../provider.js"
import { runMeta, runPanel } from "../runner.js"
import { FakeJudgeProvider } from "../testing/fakeProvider.js"
import { makeArtifact } from "../testing/fixtures.js"

function makeConfig(overrides: Partial<RaguelConfig> = {}): RaguelConfig {
  return {
    version: 1,
    onError: "ASK",
    storage: {
      casesDir: "/tmp/raguel-test-cases",
      retention: { maxRuns: 200, maxDays: 90 }
    },
    judge: {
      provider: "claude-cli",
      model: "haiku",
      timeoutMs: 5000,
      canStop: false,
      maxConcurrency: 4,
      thresholds: { proceed: 80, confidence: 60, maxVariance: 30 }
    },
    weight: { tiers: { standard: 30, critical: 70 } },
    panel: {
      trivial: [],
      standard: ["adversarial"],
      critical: [
        "adversarial",
        "steelman",
        "crosscheck",
        "assumption",
        "precedent"
      ],
      perPanelist: {}
    },
    precedent: { seedCatalog: true, topN: 5 },
    rules: {},
    ...overrides
  }
}

const standardScores = {
  objective_alignment: 80,
  unintended_changes: 80,
  breaking_changes: 80
}

describe("runPanel", () => {
  it("wave 順序: steelman は adversarial の findings を受け取ってから実行される", async () => {
    const provider = new FakeJudgeProvider()
    provider.set("adversarial", {
      findings: [{ severity: "ask", confidence: 80, message: "検察の所見A" }],
      scores: standardScores
    })
    provider.set("steelman", {
      verdicts: [{ findingIndex: 0, rebuttal: "反駁", outcome: "rebutted" }],
      defenseArgument: "擁護論",
      findings: [],
      scores: standardScores
    })

    const outcome = await runPanel(
      {
        artifact: makeArtifact(),
        ruleFindings: [],
        panelists: ["adversarial", "steelman"],
        precedents: []
      },
      provider,
      makeConfig()
    )

    expect(provider.calls.map((c) => c.role)).toEqual([
      "adversarial",
      "steelman"
    ])
    expect(provider.calls[1].prompt).toContain("検察の所見A")
    expect(outcome.reports.map((r) => r.panelist)).toEqual([
      "adversarial",
      "steelman"
    ])
    expect(outcome.steelmanVerdicts).toEqual([
      { findingIndex: 0, rebuttal: "反駁", outcome: "rebutted" }
    ])
    expect(outcome.errorFindings).toHaveLength(0)
  })

  it("adversarial 失敗時は steelman をスキップし errorFindings を生成する", async () => {
    const provider = new FakeJudgeProvider()
    provider.set(
      "adversarial",
      new JudgeError("timeout", "adversarial がタイムアウトした")
    )
    provider.set("steelman", {
      verdicts: [],
      defenseArgument: "擁護論",
      findings: [],
      scores: standardScores
    })

    const outcome = await runPanel(
      {
        artifact: makeArtifact(),
        ruleFindings: [],
        panelists: ["adversarial", "steelman"],
        precedents: []
      },
      provider,
      makeConfig()
    )

    expect(outcome.reports).toHaveLength(0)
    expect(provider.calls.map((c) => c.role)).toEqual(["adversarial"])
    expect(outcome.errorFindings).toHaveLength(1)
    expect(outcome.errorFindings[0].ruleId).toBe("panel/adversarial-error")
    expect(outcome.errorFindings[0].severity).toBe("ask")
    expect(outcome.steelmanVerdicts).toBeUndefined()
  })

  it("precedents が空なら precedent パネリストは不実施(エラーにしない)", async () => {
    const provider = new FakeJudgeProvider()
    // "precedent" の canned 応答をあえて未登録にし、呼ばれたら FakeJudgeProvider が
    // provider-none エラーを投げて即座に検知できるようにする

    const outcome = await runPanel(
      {
        artifact: makeArtifact(),
        ruleFindings: [],
        panelists: ["precedent"],
        precedents: []
      },
      provider,
      makeConfig()
    )

    expect(provider.calls).toHaveLength(0)
    expect(outcome.reports).toHaveLength(0)
    expect(outcome.errorFindings).toHaveLength(0)
  })

  it("precedents が非空なら precedent パネリストを実行する", async () => {
    const provider = new FakeJudgeProvider()
    provider.set("precedent", {
      evaluations: [],
      scores: standardScores
    })

    const outcome = await runPanel(
      {
        artifact: makeArtifact(),
        ruleFindings: [],
        panelists: ["precedent"],
        precedents: [
          {
            id: "seed-001",
            source: "seed",
            kind: "code",
            outcome: "rejected",
            summary: "失敗判例",
            firedRules: [],
            changedPaths: [],
            lesson: "教訓"
          }
        ]
      },
      provider,
      makeConfig()
    )

    expect(provider.calls.map((c) => c.role)).toEqual(["precedent"])
    expect(outcome.reports).toHaveLength(1)
  })

  it("パネル応答の severity 'stop' は zod で拒否され、フェイルクローズドの error finding になる", async () => {
    const provider = new FakeJudgeProvider()
    provider.set("adversarial", {
      findings: [{ severity: "stop", confidence: 90, message: "危険な変更" }],
      scores: standardScores
    })

    const outcome = await runPanel(
      {
        artifact: makeArtifact(),
        ruleFindings: [],
        panelists: ["adversarial"],
        precedents: []
      },
      provider,
      makeConfig()
    )

    expect(outcome.reports).toHaveLength(0)
    expect(
      outcome.reports
        .flatMap((r) => r.findings)
        .some((f) => f.severity === "stop")
    ).toBe(false)
    expect(outcome.errorFindings).toHaveLength(1)
    expect(outcome.errorFindings[0].ruleId).toBe("panel/adversarial-error")
  })

  it("wave1 の複数パネリストは並列に(同一 Promise.allSettled で)実行される", async () => {
    const provider = new FakeJudgeProvider()
    provider.set("adversarial", { findings: [], scores: standardScores })
    provider.set("assumption", { findings: [], scores: standardScores })

    const outcome = await runPanel(
      {
        artifact: makeArtifact(),
        ruleFindings: [],
        panelists: ["adversarial", "assumption"],
        precedents: []
      },
      provider,
      makeConfig()
    )

    expect(outcome.reports.map((r) => r.panelist).sort()).toEqual([
      "adversarial",
      "assumption"
    ])
  })

  it("perPanelist の model 上書きが解決される", async () => {
    const provider = new FakeJudgeProvider()
    provider.set("adversarial", { findings: [], scores: standardScores })

    const outcome = await runPanel(
      {
        artifact: makeArtifact(),
        ruleFindings: [],
        panelists: ["adversarial"],
        precedents: []
      },
      provider,
      makeConfig({
        panel: {
          trivial: [],
          standard: ["adversarial"],
          critical: [],
          perPanelist: { adversarial: { model: "sonnet" } }
        }
      })
    )

    expect(outcome.reports[0].model).toBe("sonnet")
  })
})

describe("runMeta", () => {
  it("失敗時は throw する(呼び出し側が onError 処理を行う)", async () => {
    const provider = new FakeJudgeProvider()
    provider.set("meta", new JudgeError("nonzero-exit", "meta 失敗"))

    await expect(
      runMeta("evidence bundle", "code", provider, makeConfig())
    ).rejects.toMatchObject({ name: "JudgeError", reason: "nonzero-exit" })
  })

  it("成功時は MetaReport を返す", async () => {
    const provider = new FakeJudgeProvider()
    provider.set("meta", {
      scores: {
        objective_alignment: 80,
        unintended_changes: 80,
        breaking_changes: 80,
        blast_radius: 70
      },
      rationale: "総合的に問題なし"
    })

    const meta = await runMeta(
      "evidence bundle",
      "code",
      provider,
      makeConfig()
    )
    expect(meta.rationale).toBe("総合的に問題なし")
  })
})
