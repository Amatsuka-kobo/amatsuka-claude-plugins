import type { ChildProcess } from "node:child_process"
import { describe, expect, it, vi } from "vitest"
import {
  buildEnv,
  buildEvalArgs,
  buildSpawnOptions,
  buildTextArgs,
  callClaudeText,
  describeEnvironment,
  ISOLATION_ARGS,
  killThenSettle,
  type SpawnFn
} from "../lib/claude-cli.js"
import { FakeChildProcess } from "./helpers/fake-child-process.js"

function asChild(child: FakeChildProcess): ChildProcess {
  return child as unknown as ChildProcess
}

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

describe("isolation arguments", () => {
  it("buildEvalArgs は現行の並びの末尾へ隔離引数を足す", () => {
    expect(buildEvalArgs("query", "sonnet")).toEqual([
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
  })

  it("buildTextArgs は model の後ろへ隔離引数を足す", () => {
    expect(buildTextArgs("opus")).toEqual([
      "-p",
      "--output-format",
      "text",
      "--model",
      "opus",
      "--setting-sources",
      "project",
      "--strict-mcp-config",
      "--settings",
      '{"disableAllHooks":true}',
      "--no-session-persistence"
    ])
  })
})

describe("buildEnv", () => {
  it("CLAUDECODE を落とす", () => {
    expect(buildEnv({ CLAUDECODE: "1", PATH: "/bin" })).toEqual({
      PATH: "/bin"
    })
  })

  it("CLAUDE_CONFIG_DIR を足さない", () => {
    expect(buildEnv({ PATH: "/bin" })).not.toHaveProperty("CLAUDE_CONFIG_DIR")
  })
})

describe("buildSpawnOptions", () => {
  it("渡された cwd と buildEnv の結果を返す", () => {
    expect(
      buildSpawnOptions("/tmp/prompt-smith", {
        CLAUDECODE: "1",
        PATH: "/bin"
      })
    ).toEqual({ cwd: "/tmp/prompt-smith", env: { PATH: "/bin" } })
  })
})

describe("killThenSettle", () => {
  it("未終了なら SIGKILL 後の close を待つ", () => {
    const child = new FakeChildProcess()
    const settle = vi.fn()

    killThenSettle(asChild(child), settle)

    expect(child.killSignals).toEqual(["SIGKILL"])
    expect(settle).not.toHaveBeenCalled()
    child.emit("close", null, "SIGKILL")
    expect(settle).toHaveBeenCalledOnce()
  })

  it("終了済みなら即座に settle する", () => {
    const child = new FakeChildProcess()
    child.exitCode = 0
    const settle = vi.fn()

    killThenSettle(asChild(child), settle)

    expect(settle).toHaveBeenCalledOnce()
    expect(child.killSignals).toEqual([])
  })
})

describe("callClaudeText", () => {
  it("stdio を指定せず、prompt を stdin へ書く", async () => {
    const child = new FakeChildProcess()
    const cleanup = vi.fn(async () => {})
    let spawnOptions: unknown
    const spawnFn = fakeSpawn(child, (command, args, options) => {
      expect(command).toBe("claude")
      expect(args).toEqual(buildTextArgs("sonnet"))
      spawnOptions = options
      queueMicrotask(() => {
        child.stdout.emit("data", "response")
        child.exitCode = 0
        child.emit("close", 0, null)
      })
    })

    await expect(
      callClaudeText("prompt", "sonnet", 300, {
        spawn: spawnFn,
        createWorkspace: async () => ({
          dir: "/tmp/isolated",
          cleanup
        })
      })
    ).resolves.toBe("response")

    expect(spawnOptions).toMatchObject({ cwd: "/tmp/isolated" })
    expect(spawnOptions).not.toHaveProperty("stdio")
    expect(child.stdinWrites).toEqual(["prompt"])
    expect(child.stdinEnded).toBe(true)
    expect(cleanup).toHaveBeenCalledOnce()
  })

  it("タイムアウト時は close を待ってから reject と cleanup を行う", async () => {
    vi.useFakeTimers()
    try {
      const child = new FakeChildProcess()
      const cleanup = vi.fn(async () => {})
      const result = callClaudeText("prompt", undefined, 1, {
        spawn: fakeSpawn(child),
        createWorkspace: async () => ({
          dir: "/tmp/isolated",
          cleanup
        })
      })
      let rejected = false
      void result.catch(() => {
        rejected = true
      })

      await vi.advanceTimersByTimeAsync(1000)

      expect(child.killSignals).toEqual(["SIGKILL"])
      expect(rejected).toBe(false)
      expect(cleanup).not.toHaveBeenCalled()

      child.signalCode = "SIGKILL"
      child.emit("close", null, "SIGKILL")

      await expect(result).rejects.toThrow("claude -p timed out after 1s")
      expect(cleanup).toHaveBeenCalledOnce()
    } finally {
      vi.useRealTimers()
    }
  })

  it("error で reject しても cleanup を 1 回だけ行う", async () => {
    const child = new FakeChildProcess()
    const cleanup = vi.fn(async () => {})
    const result = callClaudeText("prompt", undefined, 300, {
      spawn: fakeSpawn(child, () => {
        queueMicrotask(() => {
          child.emit("error", new Error("spawn failed"))
        })
      }),
      createWorkspace: async () => ({
        dir: "/tmp/isolated",
        cleanup
      })
    })

    await expect(result).rejects.toThrow("spawn failed")
    expect(cleanup).toHaveBeenCalledOnce()
  })
})

describe("describeEnvironment", () => {
  it("base_url と認証変数の名前を記録する", () => {
    const env = describeEnvironment("claude-opus-5", {
      ANTHROPIC_BASE_URL: "http://127.0.0.1:8317",
      ANTHROPIC_AUTH_TOKEN: "secret-value"
    })
    expect(env).toEqual({
      base_url: "http://127.0.0.1:8317",
      auth_source: "ANTHROPIC_AUTH_TOKEN",
      model: "claude-opus-5"
    })
  })

  it("値そのものは記録しない", () => {
    const env = describeEnvironment(undefined, {
      ANTHROPIC_API_KEY: "sk-do-not-log"
    })
    expect(JSON.stringify(env)).not.toContain("sk-do-not-log")
    expect(env.auth_source).toBe("ANTHROPIC_API_KEY")
  })

  it("未設定なら既定の表記にする", () => {
    expect(describeEnvironment(undefined, {})).toEqual({
      base_url: "(default)",
      auth_source: "(claude.ai login)",
      model: null
    })
  })
})
