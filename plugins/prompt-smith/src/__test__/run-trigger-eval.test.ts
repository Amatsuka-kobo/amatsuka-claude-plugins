import { describe, expect, it, vi } from "vitest"
import { ISOLATION_ARGS, type SpawnFn } from "../lib/claude-cli.js"
import type { Sandbox } from "../lib/sandbox.js"
import {
  aggregateOutcomes,
  assertMeasurable,
  MeasurementFailedError,
  type QueryOutcome,
  type RunSingleQueryOptions,
  runEval,
  runSingleQuery
} from "../run-trigger-eval.js"
import { FakeChildProcess } from "./helpers/fake-child-process.js"

function fakeSpawn(
  child: FakeChildProcess,
  onSpawn: (
    command: string,
    args: readonly string[] | undefined,
    options: unknown
  ) => void = () => {}
): SpawnFn {
  return ((
    command: string,
    args?: readonly string[],
    options?: unknown
  ): FakeChildProcess => {
    onSpawn(command, args, options)
    return child
  }) as unknown as SpawnFn
}

function options(
  child: FakeChildProcess,
  cleanup = vi.fn(async () => {}),
  overrides: Partial<RunSingleQueryOptions> = {}
): RunSingleQueryOptions {
  return {
    query: "query",
    skillName: "my-skill",
    skillContent: "---\nname: my-skill\ndescription: old\n---\nbody\n",
    description: "measured",
    timeout: 30,
    model: "sonnet",
    spawn: fakeSpawn(child),
    createSandbox: async (): Promise<Sandbox> => ({
      dir: "/tmp/prompt-smith-eval",
      cleanup
    }),
    ...overrides
  }
}

function spawnWithResult(
  child: FakeChildProcess,
  result: Record<string, unknown>,
  onSpawn: (
    command: string,
    args: readonly string[] | undefined,
    options: unknown
  ) => void = () => {}
): SpawnFn {
  return fakeSpawn(child, (command, args, options) => {
    onSpawn(command, args, options)
    queueMicrotask(() => {
      child.stdout.emit("data", `${JSON.stringify(result)}\n`)
      child.signalCode = "SIGKILL"
      child.emit("close", null, "SIGKILL")
    })
  })
}

describe("runSingleQuery", () => {
  it("隔離引数、sandbox cwd、stdio を spawn へ渡す", async () => {
    const child = new FakeChildProcess()
    let spawnArgs: readonly string[] | undefined
    let spawnOptions: unknown
    const outcome = await runSingleQuery(
      options(child, undefined, {
        spawn: spawnWithResult(
          child,
          { type: "result", is_error: false },
          (command, args, passedOptions) => {
            expect(command).toBe("claude")
            spawnArgs = args
            spawnOptions = passedOptions
          }
        )
      })
    )

    expect(outcome).toEqual({ status: "not_triggered" })
    expect(spawnArgs).toEqual([
      "-p",
      "query",
      "--output-format",
      "stream-json",
      "--verbose",
      "--include-partial-messages",
      "--model",
      "sonnet",
      ...ISOLATION_ARGS
    ])
    expect(spawnOptions).toMatchObject({
      cwd: "/tmp/prompt-smith-eval",
      stdio: ["ignore", "pipe", "ignore"]
    })
  })

  it("subtype が success でも is_error: true を error にする", async () => {
    const child = new FakeChildProcess()
    const spawn = spawnWithResult(child, {
      type: "result",
      subtype: "success",
      is_error: true,
      result: "authentication failed"
    })

    await expect(
      runSingleQuery(options(child, undefined, { spawn }))
    ).resolves.toEqual({
      status: "error",
      message: "authentication failed"
    })
  })

  it("空の result を持つ is_error: true も error にする", async () => {
    const child = new FakeChildProcess()
    const spawn = spawnWithResult(child, {
      type: "result",
      subtype: "success",
      is_error: true,
      result: ""
    })

    await expect(
      runSingleQuery(options(child, undefined, { spawn }))
    ).resolves.toEqual({
      status: "error",
      message: ""
    })
  })

  it("error イベントを error にする", async () => {
    const child = new FakeChildProcess()
    const spawn = fakeSpawn(child, () => {
      queueMicrotask(() => {
        child.emit("error", new Error("spawn failed"))
        child.signalCode = "SIGKILL"
        child.emit("close", null, "SIGKILL")
      })
    })

    await expect(
      runSingleQuery(options(child, undefined, { spawn }))
    ).resolves.toEqual({
      status: "error",
      message: "spawn failed"
    })
  })

  it("判定前の非ゼロ終了を error にする", async () => {
    const child = new FakeChildProcess()
    const spawn = fakeSpawn(child, () => {
      queueMicrotask(() => {
        child.exitCode = 1
        child.emit("close", 1, null)
      })
    })

    await expect(
      runSingleQuery(options(child, undefined, { spawn }))
    ).resolves.toEqual({
      status: "error",
      message: "claude -p exited 1"
    })
  })

  it("is_error: false の完走を not_triggered にする", async () => {
    const child = new FakeChildProcess()
    const spawn = spawnWithResult(child, {
      type: "result",
      is_error: false
    })

    await expect(
      runSingleQuery(options(child, undefined, { spawn }))
    ).resolves.toEqual({
      status: "not_triggered"
    })
  })

  it("タイムアウトを not_triggered にする", async () => {
    vi.useFakeTimers()
    try {
      const child = new FakeChildProcess()
      const result = runSingleQuery(options(child, undefined, { timeout: 1 }))

      await vi.advanceTimersByTimeAsync(1000)
      expect(child.killSignals).toEqual(["SIGKILL"])

      child.signalCode = "SIGKILL"
      child.emit("close", null, "SIGKILL")

      await expect(result).resolves.toEqual({ status: "not_triggered" })
    } finally {
      vi.useRealTimers()
    }
  })

  it("判定後の close を待ってから cleanup する", async () => {
    const child = new FakeChildProcess()
    const events: string[] = []
    child.on("close", () => events.push("close"))
    const cleanup = vi.fn(async () => {
      events.push("cleanup")
    })
    const spawn = spawnWithResult(child, {
      type: "result",
      is_error: true,
      result: "failed"
    })

    await runSingleQuery(options(child, cleanup, { spawn }))

    expect(events).toEqual(["close", "cleanup"])
    expect(cleanup).toHaveBeenCalledOnce()
  })

  it("spawn が例外を投げても cleanup する", async () => {
    const child = new FakeChildProcess()
    const cleanup = vi.fn(async () => {})
    const throwingSpawn = (() => {
      throw new Error("spawn threw")
    }) as SpawnFn

    await expect(
      runSingleQuery(options(child, cleanup, { spawn: throwingSpawn }))
    ).rejects.toThrow("spawn threw")
    expect(cleanup).toHaveBeenCalledOnce()
  })
})

describe("aggregateOutcomes", () => {
  it("error を runs から除外し errors に数える", () => {
    const evalSet = [
      { query: "positive", should_trigger: true },
      { query: "negative", should_trigger: false }
    ]
    const jobs = [
      evalSet[0],
      evalSet[0],
      evalSet[0],
      evalSet[1],
      evalSet[1],
      evalSet[1]
    ]
    const outcomes: QueryOutcome[] = [
      { status: "triggered" },
      { status: "not_triggered" },
      { status: "error", message: "failed" },
      { status: "not_triggered" },
      { status: "not_triggered" },
      { status: "error", message: "failed" }
    ]

    expect(aggregateOutcomes(evalSet, jobs, outcomes, 0.5)).toEqual({
      results: [
        {
          query: "positive",
          should_trigger: true,
          trigger_rate: 0.5,
          triggers: 1,
          runs: 2,
          errors: 1,
          pass: true
        },
        {
          query: "negative",
          should_trigger: false,
          trigger_rate: 0,
          triggers: 0,
          runs: 2,
          errors: 1,
          pass: true
        }
      ],
      errors: 2
    })
  })
})

describe("assertMeasurable", () => {
  const result = {
    query: "query",
    should_trigger: true,
    trigger_rate: 0.5,
    triggers: 1,
    runs: 2,
    errors: 1,
    pass: true
  }

  it("1 問の全実行が error なら throw する", () => {
    expect(() =>
      assertMeasurable([{ ...result, trigger_rate: 0, triggers: 0, runs: 0 }])
    ).toThrow(MeasurementFailedError)
    expect(() =>
      assertMeasurable([{ ...result, trigger_rate: 0, triggers: 0, runs: 0 }])
    ).toThrow(/apiKeyHelper.*awsAuthRefresh.*settings.*env.*環境変数/s)
  })

  it("部分失敗なら throw しない", () => {
    expect(() => assertMeasurable([result])).not.toThrow()
  })
})

describe("runEval", () => {
  const evalSet = [
    { query: "positive", should_trigger: true },
    { query: "negative", should_trigger: false }
  ]
  const baseOptions = {
    evalSet,
    skillName: "my-skill",
    skillContent: "skill",
    description: "description",
    runsPerQuery: 3,
    numWorkers: 1,
    timeout: 30,
    triggerThreshold: 0.5,
    model: "sonnet"
  }

  it("第 2 引数の runSingleQuery を使って 3 値を集計する", async () => {
    const outcomes: QueryOutcome[] = [
      { status: "triggered" },
      { status: "not_triggered" },
      { status: "error", message: "partial" },
      { status: "not_triggered" },
      { status: "triggered" },
      { status: "not_triggered" }
    ]
    const injected = vi.fn(async () => outcomes.shift() as QueryOutcome)

    const result = await runEval(baseOptions, { runSingleQuery: injected })

    expect(injected).toHaveBeenCalledTimes(6)
    expect(result.results).toMatchObject([
      { query: "positive", triggers: 1, runs: 2, errors: 1 },
      { query: "negative", triggers: 1, runs: 3, errors: 0 }
    ])
    expect(result.errors).toBe(1)
  })

  it("1 問の全実行が error なら結果を返さない", async () => {
    const outcomes: QueryOutcome[] = [
      { status: "triggered" },
      { status: "not_triggered" },
      { status: "triggered" },
      { status: "error", message: "failed 1" },
      { status: "error", message: "failed 2" },
      { status: "error", message: "failed 3" }
    ]
    const injected = vi.fn(async () => outcomes.shift() as QueryOutcome)

    await expect(
      runEval(baseOptions, { runSingleQuery: injected })
    ).rejects.toThrow(MeasurementFailedError)
  })
})
