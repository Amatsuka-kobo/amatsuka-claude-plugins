import { describe, expect, it, vi } from "vitest"
import {
  type ImproveOptions,
  improveDescription,
  MissingDescriptionTagError
} from "../improve-description.js"
import { byteLength, LENGTH_FLOOR } from "../lib/defaults.js"
import {
  blindHistory,
  parseImproveTimeout,
  runLoop,
  selectBest
} from "../run-loop.js"
import { MeasurementFailedError, runEval } from "../run-trigger-eval.js"

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

describe("parseImproveTimeout", () => {
  it("CLI の --improve-timeout を秒数へ変換し、未指定時は 300 を返す", () => {
    expect(parseImproveTimeout("480")).toBe(480)
    expect(parseImproveTimeout(undefined)).toBe(300)
  })
})

describe("既定モデル", () => {
  it("runEval は model 未指定時に sonnet を使い、環境情報へ記録する", async () => {
    const runSingleQuery = vi.fn(async (_options: { model?: string }) => ({
      status: "triggered" as const
    }))

    const result = await runEval(
      {
        evalSet: [{ query: "positive", should_trigger: true }],
        skillName: "s",
        skillContent: "body",
        description: "description",
        runsPerQuery: 1,
        numWorkers: 1,
        timeout: 30,
        triggerThreshold: 0.5
      },
      { runSingleQuery }
    )

    expect(runSingleQuery.mock.calls[0]?.[0].model).toBe("sonnet")
    expect(result.environment.model).toBe("sonnet")
  })

  it("improveDescription は model 未指定時に sonnet を使う", async () => {
    const callClaude = vi
      .fn()
      .mockResolvedValue("<new_description>improved</new_description>")

    await improveDescription({
      skillName: "s",
      skillContent: "body",
      currentDescription: "current",
      budget: LENGTH_FLOOR,
      evalResults: {
        results: [],
        summary: { total: 0, passed: 0, failed: 0 }
      },
      history: [],
      testResults: null,
      callClaude
    })

    expect(callClaude.mock.calls[0]?.[1]).toBe("sonnet")
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
    errors: 0,
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
      errors: 0,
      pass: true
    })),
    summary: { total: queries.length, passed: queries.length, failed: 0 }
  })

  const resultWithPassPredicate = (
    queries: { query: string; should_trigger: boolean }[],
    predicate: (
      query: { query: string; should_trigger: boolean },
      index: number
    ) => boolean
  ) => {
    const results = queries.map((q, index) => ({
      ...q,
      trigger_rate: predicate(q, index) ? 1 : 0,
      triggers: predicate(q, index) ? 3 : 0,
      runs: 3,
      errors: 0,
      pass: predicate(q, index)
    }))
    const passed = results.filter((result) => result.pass).length
    return {
      ...allPass(queries),
      results,
      summary: {
        total: queries.length,
        passed,
        failed: queries.length - passed
      }
    }
  }

  it("model 未指定時に sonnet を測定へ渡す", async () => {
    const runEval = vi.fn(async ({ evalSet: queries }) => allPass(queries))

    await runLoop({
      evalSet,
      skillName: "s",
      skillContent: "body",
      originalDescription: "start",
      holdout: 0,
      maxIterations: 1,
      runEval,
      improveDescription: vi.fn()
    })

    expect(runEval.mock.calls[0]?.[0].model).toBe("sonnet")
  })

  it("結果 JSON に環境情報を記録し、トークン値を含めない", async () => {
    const token = "loop-secret-token"
    const previousApiKey = process.env.ANTHROPIC_API_KEY
    const previousBaseUrl = process.env.ANTHROPIC_BASE_URL
    process.env.ANTHROPIC_API_KEY = token
    delete process.env.ANTHROPIC_BASE_URL
    let iterationEnvironment: unknown

    try {
      const result = await runLoop({
        evalSet,
        skillName: "s",
        skillContent: "body",
        originalDescription: "start",
        holdout: 0,
        maxIterations: 1,
        model: "claude-opus-5",
        runEval: vi.fn(async ({ evalSet: queries }) => allPass(queries)),
        improveDescription: vi.fn(),
        onIteration: (partial) => {
          iterationEnvironment = partial.environment
        }
      })

      expect(result.environment).toEqual({
        base_url: "(default)",
        auth_source: "ANTHROPIC_API_KEY",
        model: "claude-opus-5"
      })
      expect(Object.keys(result.environment)).toEqual([
        "base_url",
        "auth_source",
        "model"
      ])
      expect(iterationEnvironment).toEqual(result.environment)
      expect(JSON.stringify(result)).not.toContain(token)
    } finally {
      if (previousApiKey === undefined) {
        delete process.env.ANTHROPIC_API_KEY
      } else {
        process.env.ANTHROPIC_API_KEY = previousApiKey
      }
      if (previousBaseUrl === undefined) {
        delete process.env.ANTHROPIC_BASE_URL
      } else {
        process.env.ANTHROPIC_BASE_URL = previousBaseUrl
      }
    }
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

  it("train 満点なら holdout 未満点でも反復 1 で打ち切る", async () => {
    const runEval = vi.fn(async ({ evalSet: queries }) =>
      resultWithPassPredicate(queries, (_, index) => index < 12)
    )
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
    expect(result.exit_reason).toBe("all_passed (iteration 1)")
    expect(improve).not.toHaveBeenCalled()
  })

  it("holdout 満点なら train 未満点でも反復 1 で打ち切る", async () => {
    const runEval = vi.fn(async ({ evalSet: queries }) =>
      resultWithPassPredicate(queries, (_, index) => index >= 12)
    )
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
    expect(result.exit_reason).toBe("holdout_maxed (iteration 1)")
    expect(improve).not.toHaveBeenCalled()
  })

  it("holdout 満点後に train スコアが上がっても最良説明は変わらない", () => {
    const history = [record(1, 5, 8), record(2, 12, 7)]
    expect(selectBest(history, true).description).toBe("desc-1")
  })

  it("train と holdout が未満点なら max-iterations まで継続する", async () => {
    const runEval = vi.fn(async ({ evalSet: queries }) =>
      resultWithPassPredicate(queries, () => false)
    )
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
    expect(result.exit_reason).toBe("max_iterations (3)")
    expect(improve).toHaveBeenCalledTimes(2)
  })

  it("holdout 0 でも train 満点なら all_passed で打ち切る", async () => {
    const runEval = vi.fn(async ({ evalSet: queries }) => allPass(queries))
    const improve = vi.fn()
    const result = await runLoop({
      evalSet,
      skillName: "s",
      skillContent: "body",
      originalDescription: "start",
      holdout: 0,
      maxIterations: 5,
      model: "claude-opus-5",
      runEval,
      improveDescription: improve
    })

    expect(result.iterations_run).toBe(1)
    expect(result.exit_reason).toBe("all_passed (iteration 1)")
    expect(result.best_test_score).toBeNull()
    expect(improve).not.toHaveBeenCalled()
  })

  it("holdout により train が空になる構成を拒否する", async () => {
    await expect(
      runLoop({
        evalSet: [
          { query: "positive", should_trigger: true },
          { query: "negative", should_trigger: false }
        ],
        skillName: "s",
        skillContent: "body",
        originalDescription: "start",
        holdout: 1,
        maxIterations: 1,
        model: "claude-opus-5",
        runEval: vi.fn(async ({ evalSet: queries }) => allPass(queries)),
        improveDescription: vi.fn()
      })
    ).rejects.toThrow(/lower --holdout or add more questions/)
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
        errors: 0,
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

  it("反復 2 の測定不能は打ち切り理由として記録し、反復 1 を最良結果にする", async () => {
    const notAllPass = (
      queries: { query: string; should_trigger: boolean }[]
    ) => ({
      ...allPass(queries),
      results: queries.map((q) => ({
        ...q,
        trigger_rate: 0,
        triggers: 0,
        runs: 3,
        errors: 0,
        pass: false
      })),
      summary: { total: queries.length, passed: 0, failed: queries.length }
    })
    const runEval = vi.fn(async ({ evalSet: queries }) => {
      if (runEval.mock.calls.length === 2) {
        throw new MeasurementFailedError("all runs ended in errors")
      }
      return notAllPass(queries)
    })
    const improve = vi.fn(async () => "improved description")
    const result = await runLoop({
      evalSet,
      skillName: "s",
      skillContent: "body",
      originalDescription: "start",
      holdout: 0,
      maxIterations: 3,
      model: "claude-opus-5",
      runEval,
      improveDescription: improve
    })
    expect(result.exit_reason).toBe(
      "measurement_failed (iteration 2): all runs ended in errors"
    )
    expect(result.best_description).toBe("start")
    expect(result.iterations_run).toBe(1)
  })

  it("反復 1 の測定不能は再 throw する", async () => {
    const error = new MeasurementFailedError("all runs ended in errors")
    const runEval = vi.fn(async () => {
      throw error
    })
    await expect(
      runLoop({
        evalSet,
        skillName: "s",
        skillContent: "body",
        originalDescription: "start",
        holdout: 0,
        maxIterations: 3,
        model: "claude-opus-5",
        runEval,
        improveDescription: vi.fn()
      })
    ).rejects.toBe(error)
  })

  it("description タグの欠落時は最良結果を返して打ち切る", async () => {
    const failing = (
      queries: { query: string; should_trigger: boolean }[]
    ) => ({
      ...allPass(queries),
      results: queries.map((q) => ({
        ...q,
        trigger_rate: 0,
        triggers: 0,
        runs: 3,
        errors: 0,
        pass: false
      })),
      summary: { total: queries.length, passed: 0, failed: queries.length }
    })
    const runEval = vi.fn(async ({ evalSet: queries }) => failing(queries))
    const improve = vi.fn(async () => {
      throw new MissingDescriptionTagError()
    })
    const result = await runLoop({
      evalSet,
      skillName: "s",
      skillContent: "body",
      originalDescription: "start",
      holdout: 0,
      maxIterations: 3,
      model: "claude-opus-5",
      runEval,
      improveDescription: improve
    })
    expect(result.exit_reason).toMatch(
      /^improve_failed \(iteration 1\): Neither of the two responses/
    )
    expect(result.best_description).toBe("start")
    expect(result.iterations_run).toBe(1)
  })

  it("description 改善の通常エラー時は最良結果を返して打ち切る", async () => {
    const failing = (
      queries: { query: string; should_trigger: boolean }[]
    ) => ({
      ...allPass(queries),
      results: queries.map((q) => ({
        ...q,
        trigger_rate: 0,
        triggers: 0,
        runs: 3,
        errors: 0,
        pass: false
      })),
      summary: { total: queries.length, passed: 0, failed: queries.length }
    })
    const runEval = vi.fn(async ({ evalSet: queries }) => failing(queries))
    const improve = vi.fn(async () => {
      throw new Error("claude -p timed out after 300s")
    })
    const result = await runLoop({
      evalSet,
      skillName: "s",
      skillContent: "body",
      originalDescription: "start",
      holdout: 0,
      maxIterations: 3,
      model: "claude-opus-5",
      runEval,
      improveDescription: improve
    })
    expect(result.exit_reason).toMatch(/^improve_failed \(iteration 1\):/)
    expect(result.exit_reason).toContain("claude -p timed out after 300s")
    expect(result.best_description).toBe("start")
    expect(result.iterations_run).toBe(1)
  })

  it("improveTimeout を改善呼び出しへ渡す", async () => {
    const failing = (
      queries: { query: string; should_trigger: boolean }[]
    ) => ({
      ...allPass(queries),
      results: queries.map((q) => ({
        ...q,
        trigger_rate: 0,
        triggers: 0,
        runs: 3,
        errors: 0,
        pass: false
      })),
      summary: { total: queries.length, passed: 0, failed: queries.length }
    })
    const runEval = vi.fn(async ({ evalSet: queries }) => failing(queries))
    const improve = vi.fn(async (_options: ImproveOptions) => "next")
    await runLoop({
      evalSet,
      skillName: "s",
      skillContent: "body",
      originalDescription: "start",
      holdout: 0,
      maxIterations: 2,
      improveTimeout: 480,
      model: "claude-opus-5",
      runEval,
      improveDescription: improve
    })
    expect(improve.mock.calls[0]?.[0].timeoutSeconds).toBe(480)
  })

  it("改善予算を最新案ではなく最良 description のバイト数に結び付ける", async () => {
    const bestDescription = "a".repeat(700)
    const latestDescription = "b".repeat(1000)
    let evaluation = 0
    const runEval = vi.fn(async ({ evalSet: queries }) => {
      evaluation += 1
      return resultWithPassPredicate(
        queries,
        (_, index) => index < (evaluation === 1 ? 5 : 1)
      )
    })
    const improve = vi
      .fn(async (_options: ImproveOptions) => latestDescription)
      .mockResolvedValueOnce(latestDescription)
      .mockResolvedValueOnce("third description")

    await runLoop({
      evalSet,
      skillName: "s",
      skillContent: "body",
      originalDescription: bestDescription,
      holdout: 0,
      maxIterations: 3,
      model: "claude-opus-5",
      runEval,
      improveDescription: improve
    })

    expect(byteLength(latestDescription)).toBe(1000)
    expect(improve.mock.calls[1]?.[0].budget).toBe(
      Math.max(byteLength(bestDescription), LENGTH_FLOOR)
    )
  })

  it("最良 description が短いとき改善予算に床を適用する", async () => {
    const runEval = vi.fn(async ({ evalSet: queries }) =>
      resultWithPassPredicate(queries, () => false)
    )
    const improve = vi.fn(async (_options: ImproveOptions) => "next")

    await runLoop({
      evalSet,
      skillName: "s",
      skillContent: "body",
      originalDescription: "short",
      holdout: 0,
      maxIterations: 2,
      model: "claude-opus-5",
      runEval,
      improveDescription: improve
    })

    expect(improve.mock.calls[0]?.[0].budget).toBe(LENGTH_FLOOR)
  })

  it("同じ UTF-8 バイト数なら日本語と英語で同じ改善予算になる", async () => {
    const captureBudget = async (description: string): Promise<number> => {
      const runEval = vi.fn(async ({ evalSet: queries }) =>
        resultWithPassPredicate(queries, () => false)
      )
      const improve = vi.fn(async (_options: ImproveOptions) => "next")
      await runLoop({
        evalSet,
        skillName: "s",
        skillContent: "body",
        originalDescription: description,
        holdout: 0,
        maxIterations: 2,
        model: "claude-opus-5",
        runEval,
        improveDescription: improve
      })
      return improve.mock.calls[0]?.[0].budget ?? -1
    }

    const japanese = "あ".repeat(300)
    const english = "x".repeat(900)
    expect(byteLength(japanese)).toBe(900)
    expect(byteLength(english)).toBe(900)
    await expect(captureBudget(japanese)).resolves.toBe(900)
    await expect(captureBudget(english)).resolves.toBe(900)
  })

  it("改善モデルに test スコアを渡さない", async () => {
    const mixed = (queries: { query: string; should_trigger: boolean }[]) => ({
      ...allPass(queries),
      results: queries.map((q, i) => ({
        ...q,
        trigger_rate: i % 2,
        triggers: i % 2,
        runs: 3,
        errors: 0,
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
