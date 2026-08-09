import { describe, expect, it, vi } from "vitest"
import type { ImproveOptions } from "../improve-description.js"
import { blindHistory, runLoop, selectBest } from "../run-loop.js"

const record = (iteration: number, train: number, test: number) => ({
  iteration,
  description: `desc-${iteration}`,
  train_passed: train,
  train_failed: 12 - train,
  train_total: 12,
  train_results: [],
  test_passed: test,
  test_failed: 8 - test,
  test_total: 8,
  test_results: [],
  passed: train,
  failed: 12 - train,
  total: 12,
  results: []
})

describe("selectBest", () => {
  it("test スコアで選ぶ", () => {
    const history = [record(1, 12, 4), record(2, 8, 7)]
    expect(selectBest(history, true).iteration).toBe(2)
  })

  it("test が無いときは train スコアで選ぶ", () => {
    const history = [record(1, 12, 0), record(2, 8, 0)]
    expect(selectBest(history, false).iteration).toBe(1)
  })

  it("同点なら先に来たものを選ぶ", () => {
    const history = [record(1, 10, 5), record(2, 9, 5)]
    expect(selectBest(history, true).iteration).toBe(1)
  })
})

describe("blindHistory", () => {
  it("test_ で始まるキーを落とす", () => {
    const [blinded] = blindHistory([record(1, 10, 5)])
    expect(blinded).not.toHaveProperty("test_passed")
    expect(blinded).not.toHaveProperty("test_results")
    expect(blinded).toHaveProperty("train_passed")
    expect(blinded).toHaveProperty("description")
  })
})

describe("runLoop", () => {
  const evalSet = [
    ...Array.from({ length: 10 }, (_, i) => ({
      query: `pos-${i}`,
      should_trigger: true
    })),
    ...Array.from({ length: 10 }, (_, i) => ({
      query: `neg-${i}`,
      should_trigger: false
    }))
  ]

  const allPass = (queries: { query: string; should_trigger: boolean }[]) => ({
    skill_name: "s",
    description: "d",
    environment: {
      base_url: "(default)",
      auth_source: "(claude.ai login)",
      model: null
    },
    results: queries.map((q) => ({
      ...q,
      trigger_rate: 1,
      triggers: 3,
      runs: 3,
      pass: true
    })),
    summary: { total: queries.length, passed: queries.length, failed: 0 }
  })

  it("train が全問合格したら打ち切る", async () => {
    const runEval = vi.fn(async ({ evalSet: queries }) => allPass(queries))
    const improve = vi.fn()
    const result = await runLoop({
      evalSet,
      skillName: "s",
      skillContent: "body",
      originalDescription: "start",
      holdout: 0.4,
      maxIterations: 5,
      model: "claude-opus-5",
      runEval,
      improveDescription: improve
    })
    expect(result.iterations_run).toBe(1)
    expect(result.exit_reason).toContain("all_passed")
    expect(improve).not.toHaveBeenCalled()
  })

  it("max-iterations で打ち切る", async () => {
    const failing = (
      queries: { query: string; should_trigger: boolean }[]
    ) => ({
      ...allPass(queries),
      results: queries.map((q) => ({
        ...q,
        trigger_rate: 0,
        triggers: 0,
        runs: 3,
        pass: false
      })),
      summary: { total: queries.length, passed: 0, failed: queries.length }
    })
    const runEval = vi.fn(async ({ evalSet: queries }) => failing(queries))
    const improve = vi.fn(async () => "next description")
    const result = await runLoop({
      evalSet,
      skillName: "s",
      skillContent: "body",
      originalDescription: "start",
      holdout: 0.4,
      maxIterations: 3,
      model: "claude-opus-5",
      runEval,
      improveDescription: improve
    })
    expect(result.iterations_run).toBe(3)
    expect(result.exit_reason).toContain("max_iterations")
    expect(improve).toHaveBeenCalledTimes(2)
  })

  it("改善モデルに test スコアを渡さない", async () => {
    const mixed = (queries: { query: string; should_trigger: boolean }[]) => ({
      ...allPass(queries),
      results: queries.map((q, i) => ({
        ...q,
        trigger_rate: i % 2,
        triggers: i % 2,
        runs: 3,
        pass: i % 2 === 0
      })),
      summary: { total: queries.length, passed: 1, failed: queries.length - 1 }
    })
    const runEval = vi.fn(async ({ evalSet: queries }) => mixed(queries))
    const improve = vi.fn(async (_options: ImproveOptions) => "next")
    await runLoop({
      evalSet,
      skillName: "s",
      skillContent: "body",
      originalDescription: "start",
      holdout: 0.4,
      maxIterations: 2,
      model: "claude-opus-5",
      runEval,
      improveDescription: improve
    })
    const passedHistory = improve.mock.calls[0][0].history
    expect(JSON.stringify(passedHistory)).not.toContain("test_passed")
  })

  it("holdout 0 のとき test を作らない", async () => {
    const runEval = vi.fn(async ({ evalSet: queries }) => allPass(queries))
    const result = await runLoop({
      evalSet,
      skillName: "s",
      skillContent: "body",
      originalDescription: "start",
      holdout: 0,
      maxIterations: 1,
      model: "claude-opus-5",
      runEval,
      improveDescription: vi.fn()
    })
    expect(result.test_size).toBe(0)
    expect(result.best_test_score).toBeNull()
  })
})
