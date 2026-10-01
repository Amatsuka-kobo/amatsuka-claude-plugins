import { describe, expect, it } from "vitest"
import type { Precedent, RaguelConfig } from "../../core/types.js"
import { synthesize } from "../../core/verdict.js"
import { makeConfig } from "../../rules/testHelpers.js"
import { JudgeError, NoneProvider } from "../provider.js"
import { type PanelDeps, planPanel, runPanel } from "../runner.js"
import { FakeJudgeProvider } from "./helpers/fakeProvider.js"
import { makeArtifact } from "./helpers/fixtures.js"

function claudeConfig(overrides: Partial<RaguelConfig> = {}): RaguelConfig {
  const base = makeConfig()
  return {
    ...base,
    judge: { ...base.judge, provider: "claude" },
    ...overrides
  }
}

function deps(
  providers: PanelDeps["providers"],
  config: RaguelConfig = claudeConfig(),
  extra: Partial<{ deadline: number; signal: AbortSignal }> = {}
): PanelDeps {
  return {
    config,
    providers,
    deadline: extra.deadline ?? Date.now() + 600000,
    signal: extra.signal ?? new AbortController().signal
  }
}

const codeScores = {
  objective_alignment: 90,
  no_unintended_changes: 90,
  no_breaking_changes: 90
}
const designScores = {
  requirement_coverage: 90,
  appropriate_complexity: 90,
  consistency: 90
}
const designMetaScores = { ...designScores, blast_radius_contained: 90 }

function steelmanOk(scores: Record<string, number>, verdicts: unknown[] = []) {
  return { verdicts, defenseArgument: "擁護論", findings: [], scores }
}

const design = makeArtifact({
  kind: "design",
  phase: "design",
  content: "設計書"
})
const intent = makeArtifact({
  kind: "decision",
  phase: "intent",
  content: "判断"
})

describe("planPanel(設計書 §6.6.1、R15)", () => {
  it("code の standard は adversarial だけで meta なし", () => {
    expect(planPanel(makeArtifact(), "standard", true)).toEqual({
      first: ["adversarial"],
      meta: false
    })
  })

  it("文書の standard は前フェーズの証拠があるときだけ crosscheck を足す", () => {
    expect(planPanel(design, "standard", true).first).toEqual([
      "adversarial",
      "crosscheck"
    ])
    expect(planPanel(design, "standard", false).first).toEqual(["adversarial"])
  })

  it("intent は前フェーズを持たないので、証拠が渡っても crosscheck を起動しない", () => {
    expect(planPanel(intent, "standard", true).first).toEqual(["adversarial"])
  })

  it("critical は adversarial と crosscheck と meta", () => {
    expect(planPanel(makeArtifact(), "critical", false)).toEqual({
      first: ["adversarial", "crosscheck"],
      meta: true
    })
  })
})

describe("runPanel の構成", () => {
  it("code の standard: adversarial → steelman の順で、meta は起動しない", async () => {
    const claude = new FakeJudgeProvider()
    claude.set("adversarial", {
      findings: [{ severity: "ask", confidence: 80, message: "検察の所見A" }],
      scores: codeScores
    })
    claude.set(
      "steelman",
      steelmanOk(codeScores, [
        { findingIndex: 0, rebuttal: "反駁", outcome: "rebutted" }
      ])
    )

    const outcome = await runPanel(
      {
        artifact: makeArtifact(),
        tier: "standard",
        ruleFindings: [],
        precedents: [],
        priorEvidence: "前フェーズ"
      },
      deps({ claude })
    )

    expect(claude.calls.map((c) => c.role)).toEqual(["adversarial", "steelman"])
    expect(outcome.launched).toEqual(["adversarial", "steelman"])
    expect(claude.calls[1].prompt).toContain("検察の所見A")
    expect(outcome.steelmanVerdicts).toEqual([
      {
        panelist: "adversarial",
        findingIndex: 0,
        outcome: "rebutted",
        rebuttal: "反駁"
      }
    ])
    expect(outcome.meta).toBeUndefined()
    expect(outcome.degradedReasons).toEqual([])
  })

  it("文書の standard で前フェーズの証拠があれば crosscheck を並列に起動し、steelman が両方の所見に反駁する(R15)", async () => {
    const claude = new FakeJudgeProvider()
    claude.set("adversarial", {
      findings: [{ severity: "ask", confidence: 80, message: "検察の所見" }],
      scores: designScores
    })
    claude.set("crosscheck", {
      findings: [{ severity: "ask", confidence: 90, message: "鑑識の所見" }],
      scores: designScores
    })
    claude.set(
      "steelman",
      steelmanOk(designScores, [
        {
          findingIndex: 1,
          rebuttal: "前フェーズで合意済み",
          outcome: "rebutted"
        }
      ])
    )

    const outcome = await runPanel(
      {
        artifact: design,
        tier: "standard",
        ruleFindings: [],
        precedents: [],
        priorEvidence: "前フェーズの本文"
      },
      deps({ claude })
    )

    expect(outcome.launched).toEqual(["adversarial", "crosscheck", "steelman"])
    const steelmanPrompt = claude.calls[2].prompt
    expect(steelmanPrompt).toContain("検察の所見")
    expect(steelmanPrompt).toContain("鑑識の所見")
    expect(outcome.steelmanVerdicts).toEqual([
      {
        panelist: "crosscheck",
        findingIndex: 0,
        outcome: "rebutted",
        rebuttal: "前フェーズで合意済み"
      }
    ])
    expect(outcome.meta).toBeUndefined()

    // 合成: crosscheck の所見は steelman の反駁で info に下がり、adversarial の所見だけが採用される
    const synthesis = synthesize({
      weightTier: "standard",
      ruleFindings: [],
      panel: outcome,
      config: claudeConfig()
    })
    const cross = synthesis.findings.find(
      (f) => f.ruleId === "panel/crosscheck"
    )
    expect(cross?.severity).toBe("info")
    expect(synthesis.verdict).toBe("ASK")
  })

  it("文書の standard で前フェーズの証拠が無ければ crosscheck を起動しない", async () => {
    const claude = new FakeJudgeProvider()
    claude.set("adversarial", { findings: [], scores: designScores })
    claude.set("steelman", steelmanOk(designScores))

    const outcome = await runPanel(
      { artifact: design, tier: "standard", ruleFindings: [], precedents: [] },
      deps({ claude })
    )
    expect(outcome.launched).toEqual(["adversarial", "steelman"])
  })

  it("intent の standard では crosscheck を起動しない(R15)", async () => {
    const claude = new FakeJudgeProvider()
    claude.set("adversarial", {
      findings: [],
      scores: {
        objective_alignment: 90,
        risk_awareness: 90,
        reversibility: 90,
        alternatives_considered: 90
      }
    })
    claude.set(
      "steelman",
      steelmanOk({
        objective_alignment: 90,
        risk_awareness: 90,
        reversibility: 90,
        alternatives_considered: 90
      })
    )

    const outcome = await runPanel(
      {
        artifact: intent,
        tier: "standard",
        ruleFindings: [],
        precedents: [],
        priorEvidence: "(誤って渡された証拠)"
      },
      deps({ claude })
    )
    expect(outcome.launched).not.toContain("crosscheck")
  })

  it("critical: adversarial と crosscheck → steelman → meta。meta は証拠の束と判例を読み、成果物の原文を読まない", async () => {
    const claude = new FakeJudgeProvider()
    claude.set("adversarial", {
      findings: [{ severity: "ask", confidence: 50, message: "弱い懸念" }],
      scores: designScores
    })
    claude.set("crosscheck", { findings: [], scores: designScores })
    claude.set("steelman", steelmanOk(designScores))
    claude.set("meta", { scores: designMetaScores, rationale: "問題なし" })
    const precedent: Precedent = {
      id: "seed-009",
      source: "seed",
      kind: "design",
      outcome: "rejected",
      summary: "要約",
      firedRules: [],
      changedPaths: [],
      lesson: "判例の教訓"
    }

    const outcome = await runPanel(
      {
        artifact: makeArtifact({
          kind: "design",
          phase: "design",
          content: "成果物の原文ここだけ"
        }),
        tier: "critical",
        ruleFindings: [],
        precedents: [precedent]
      },
      deps({ claude })
    )

    expect(outcome.launched).toEqual([
      "adversarial",
      "crosscheck",
      "steelman",
      "meta"
    ])
    expect(outcome.meta?.rationale).toBe("問題なし")
    const metaPrompt = claude.calls[3].prompt
    expect(metaPrompt).toContain("弱い懸念")
    expect(metaPrompt).toContain("判例の教訓")
    expect(metaPrompt).not.toContain("成果物の原文ここだけ")
    // 判例は adversarial と meta だけに渡す
    expect(claude.calls[0].prompt).toContain("判例の教訓")
    expect(claude.calls[1].prompt).not.toContain("判例の教訓")
    expect(claude.calls[2].prompt).not.toContain("判例の教訓")
  })

  it("CallControl に judge.timeoutMs・締切・signal を渡す", async () => {
    const claude = new FakeJudgeProvider()
    claude.set("adversarial", { findings: [], scores: codeScores })
    claude.set("steelman", steelmanOk(codeScores))
    const controller = new AbortController()
    const deadline = Date.now() + 400000
    const config = claudeConfig()

    await runPanel(
      {
        artifact: makeArtifact(),
        tier: "standard",
        ruleFindings: [],
        precedents: []
      },
      deps({ claude }, config, { deadline, signal: controller.signal })
    )

    for (const call of claude.calls) {
      expect(call.ctl).toEqual({
        timeoutMs: config.judge.timeoutMs,
        deadline,
        signal: controller.signal
      })
    }
  })

  it("perPanelist の provider と model に従ってプロバイダーを選ぶ(codex の既定は model 空)", async () => {
    const claude = new FakeJudgeProvider("claude")
    const codex = new FakeJudgeProvider("codex")
    codex.set("adversarial", { findings: [], scores: codeScores })
    claude.set("steelman", steelmanOk(codeScores))
    const base = claudeConfig()

    const outcome = await runPanel(
      {
        artifact: makeArtifact(),
        tier: "standard",
        ruleFindings: [],
        precedents: []
      },
      deps(
        { claude, codex },
        {
          ...base,
          panel: { perPanelist: { adversarial: { provider: "codex" } } }
        }
      )
    )

    expect(codex.calls.map((c) => [c.role, c.model])).toEqual([
      ["adversarial", ""]
    ])
    expect(claude.calls.map((c) => [c.role, c.model])).toEqual([
      ["steelman", "haiku"]
    ])
    expect(outcome.degradedReasons).toEqual([])
  })
})

describe("runPanel の障害(§6.8)", () => {
  it("code の standard で adversarial が失敗したら steelman を起動せず、degraded の理由を返す(D2)", async () => {
    const claude = new FakeJudgeProvider()
    claude.set("adversarial", new JudgeError("timeout", "タイムアウト"))
    claude.set("steelman", steelmanOk(codeScores))

    const outcome = await runPanel(
      {
        artifact: makeArtifact(),
        tier: "standard",
        ruleFindings: [],
        precedents: []
      },
      deps({ claude })
    )

    expect(claude.calls.map((c) => c.role)).toEqual(["adversarial"])
    expect(outcome.errorFindings.map((f) => [f.ruleId, f.severity])).toEqual([
      ["panel/adversarial-error", "ask"]
    ])
    expect(outcome.degradedReasons).toEqual([
      { source: "adversarial", reason: "timeout" }
    ])

    const synthesis = synthesize({
      weightTier: "standard",
      ruleFindings: [],
      panel: outcome,
      config: claudeConfig()
    })
    expect(synthesis.verdict).toBe("ASK")
    expect(synthesis.judgeStatus).toBe("degraded")
  })

  it("adversarial が失敗し crosscheck だけが成功したら、steelman は crosscheck の所見に反駁する", async () => {
    const claude = new FakeJudgeProvider()
    claude.set("adversarial", new JudgeError("nonzero-exit", "失敗"))
    claude.set("crosscheck", {
      findings: [
        { severity: "ask", confidence: 90, message: "鑑識だけの所見" }
      ],
      scores: designScores
    })
    claude.set(
      "steelman",
      steelmanOk(designScores, [
        { findingIndex: 0, rebuttal: "x", outcome: "conceded" }
      ])
    )

    const outcome = await runPanel(
      {
        artifact: design,
        tier: "standard",
        ruleFindings: [],
        precedents: [],
        priorEvidence: "前フェーズ"
      },
      deps({ claude })
    )

    expect(outcome.launched).toEqual(["adversarial", "crosscheck", "steelman"])
    expect(claude.calls[2].prompt).toContain("[0] crosscheck")
    expect(outcome.steelmanVerdicts[0].panelist).toBe("crosscheck")
  })

  it("critical で meta が失敗したら panel/meta-error と degraded の理由になる", async () => {
    const claude = new FakeJudgeProvider()
    claude.set("adversarial", { findings: [], scores: codeScores })
    claude.set("crosscheck", { findings: [], scores: codeScores })
    claude.set("steelman", steelmanOk(codeScores))
    claude.set("meta", new JudgeError("schema-mismatch", "壊れた応答"))

    const outcome = await runPanel(
      {
        artifact: makeArtifact(),
        tier: "critical",
        ruleFindings: [],
        precedents: []
      },
      deps({ claude })
    )

    expect(outcome.meta).toBeUndefined()
    expect(outcome.errorFindings.map((f) => f.ruleId)).toEqual([
      "panel/meta-error"
    ])
    expect(outcome.degradedReasons).toEqual([
      { source: "meta", reason: "schema-mismatch" }
    ])
  })

  it("provider が none なら LLM を起動せず unavailable の degraded になり、合成は ASK(C5)", async () => {
    const claude = new FakeJudgeProvider()
    const base = makeConfig() // judge.provider は none
    const config: RaguelConfig = {
      ...base,
      // perPanelist で claude を指しても none が優先する
      panel: { perPanelist: { adversarial: { provider: "claude" } } }
    }

    const outcome = await runPanel(
      { artifact: design, tier: "critical", ruleFindings: [], precedents: [] },
      deps({ claude, none: new NoneProvider() }, config)
    )

    expect(claude.calls).toHaveLength(0)
    expect(outcome.reports).toEqual([])
    expect(outcome.degradedReasons).toEqual([
      { source: "adversarial", reason: "unavailable" },
      { source: "crosscheck", reason: "unavailable" },
      { source: "meta", reason: "unavailable" }
    ])

    const synthesis = synthesize({
      weightTier: "critical",
      ruleFindings: [],
      panel: outcome,
      config
    })
    expect(synthesis.verdict).toBe("ASK")
    expect(synthesis.judgeStatus).toBe("degraded")
    expect(synthesis.decisionPoint).toBeDefined()
  })

  it("プロバイダーの実装が渡されていなければ unavailable にする", async () => {
    const outcome = await runPanel(
      {
        artifact: makeArtifact(),
        tier: "standard",
        ruleFindings: [],
        precedents: []
      },
      deps({})
    )
    expect(outcome.degradedReasons).toEqual([
      { source: "adversarial", reason: "unavailable" }
    ])
  })

  it("締切を過ぎていれば起動せず deadline の degraded にする", async () => {
    const claude = new FakeJudgeProvider()
    claude.set("adversarial", { findings: [], scores: codeScores })

    const outcome = await runPanel(
      {
        artifact: makeArtifact(),
        tier: "standard",
        ruleFindings: [],
        precedents: []
      },
      deps({ claude }, claudeConfig(), { deadline: Date.now() + 1000 })
    )

    expect(claude.calls).toHaveLength(0)
    expect(outcome.degradedReasons).toEqual([
      { source: "adversarial", reason: "deadline" }
    ])
  })

  it("signal が abort したら signal.reason を投げる", async () => {
    const controller = new AbortController()
    const claude = new FakeJudgeProvider()
    claude.set("adversarial", () => {
      controller.abort()
      throw controller.signal.reason
    })

    await expect(
      runPanel(
        {
          artifact: makeArtifact(),
          tier: "standard",
          ruleFindings: [],
          precedents: []
        },
        deps({ claude }, claudeConfig(), { signal: controller.signal })
      )
    ).rejects.toMatchObject({ name: "AbortError" })
    expect(claude.calls.map((c) => c.role)).toEqual(["adversarial"])
  })

  it("パネルの応答の severity stop は zod が拒み、panel/<名前>-error になる", async () => {
    const claude = new FakeJudgeProvider()
    claude.set("adversarial", {
      findings: [{ severity: "stop", confidence: 90, message: "危険" }],
      scores: codeScores
    })

    const outcome = await runPanel(
      {
        artifact: makeArtifact(),
        tier: "standard",
        ruleFindings: [],
        precedents: []
      },
      deps({ claude })
    )

    expect(outcome.reports).toHaveLength(0)
    expect(outcome.errorFindings[0].ruleId).toBe("panel/adversarial-error")
    expect(outcome.degradedReasons[0]).toEqual({
      source: "adversarial",
      reason: "internal-error"
    })
  })
})
