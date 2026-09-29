import { spawnSync } from "node:child_process"
import {
  existsSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync
} from "node:fs"
import * as os from "node:os"
import * as path from "node:path"
import { fileURLToPath } from "node:url"
import { afterEach, beforeEach, describe, expect, it } from "vitest"
import { z } from "zod"
import { buildArgs, ClaudeCliProvider } from "../claudeCli.js"
import { JudgeError } from "../provider.js"
import { makeCtl } from "./helpers/fakeProvider.js"

const FAKE_CLAUDE = fileURLToPath(
  new URL("../../testing/fake-claude.mjs", import.meta.url)
)

const responseSchema = z.object({
  message: z.string()
})

const jsonSchema = {
  type: "object",
  properties: { message: { type: "string" } },
  required: ["message"]
}

let dir: string
const envKeys = [
  "RAGUEL_CLAUDE_BIN",
  "FAKE_CLAUDE_MODE",
  "FAKE_CLAUDE_RESPONSE",
  "FAKE_CLAUDE_STDIN_FILE",
  "FAKE_CLAUDE_STATE_FILE",
  "FAKE_CLAUDE_DELAY_MS",
  "FAKE_CLAUDE_TIMELINE_FILE",
  "RAGUEL_ENV_DUMP_FILE"
] as const
const savedEnv: Record<string, string | undefined> = {}

beforeEach(() => {
  dir = mkdtempSync(path.join(os.tmpdir(), "raguel-claudecli-test-"))
  for (const key of envKeys) savedEnv[key] = process.env[key]
  process.env.RAGUEL_CLAUDE_BIN = FAKE_CLAUDE
})

afterEach(() => {
  for (const key of envKeys) {
    if (savedEnv[key] === undefined) delete process.env[key]
    else process.env[key] = savedEnv[key]
  }
  rmSync(dir, { recursive: true, force: true })
})

function makeCall(
  overrides: Partial<{
    role: string
    jsonSchema: object
  }> = {}
) {
  return {
    role: overrides.role ?? "test-role",
    model: "haiku",
    prompt: "テストプロンプト",
    schema: responseSchema,
    jsonSchema: overrides.jsonSchema ?? jsonSchema
  }
}

function callCount(stateFile: string): number {
  return existsSync(stateFile) ? Number(readFileSync(stateFile, "utf8")) : 0
}

describe("buildArgs", () => {
  it("隔離のフラグを含む引数の列を固定する", () => {
    expect(buildArgs({ model: "haiku", jsonSchema })).toEqual([
      "-p",
      "--output-format",
      "json",
      "--model",
      "haiku",
      "--tools",
      "",
      "--disable-slash-commands",
      "--strict-mcp-config",
      "--mcp-config",
      '{"mcpServers":{}}',
      "--setting-sources",
      "project",
      "--no-session-persistence",
      "--json-schema",
      JSON.stringify(jsonSchema)
    ])
  })
})

describe("fake-claude.mjs の起動の検査", () => {
  function runFake(args: string[], cwd: string) {
    return spawnSync(process.execPath, [FAKE_CLAUDE, ...args], {
      cwd,
      input: "x",
      encoding: "utf8",
      env: { ...process.env, FAKE_CLAUDE_MODE: "ok" }
    })
  }

  it("buildArgs の引数と空の cwd なら 0 で終わる", () => {
    const empty = mkdtempSync(path.join(dir, "cwd-"))
    const res = runFake(buildArgs({ model: "haiku", jsonSchema }), empty)
    expect(res.status).toBe(0)
  })

  it("$schema を含むスキーマで非ゼロで終わる", () => {
    const empty = mkdtempSync(path.join(dir, "cwd-"))
    const res = runFake(
      buildArgs({
        model: "haiku",
        jsonSchema: {
          $schema: "https://json-schema.org/draft/2020-12/schema",
          ...jsonSchema
        }
      }),
      empty
    )
    expect(res.status).not.toBe(0)
    expect(res.stderr).toContain("$schema")
  })

  it('type: "object" を持たないスキーマで非ゼロで終わる', () => {
    const empty = mkdtempSync(path.join(dir, "cwd-"))
    const res = runFake(
      buildArgs({ model: "haiku", jsonSchema: { type: "string" } }),
      empty
    )
    expect(res.status).not.toBe(0)
  })

  it("隔離のフラグが 1 つでも欠けると非ゼロで終わる", () => {
    const empty = mkdtempSync(path.join(dir, "cwd-"))
    const full = buildArgs({ model: "haiku", jsonSchema })
    for (const flag of [
      "-p",
      "--disable-slash-commands",
      "--strict-mcp-config",
      "--no-session-persistence"
    ]) {
      const res = runFake(
        full.filter((a) => a !== flag),
        empty
      )
      expect(res.status, flag).not.toBe(0)
    }
    const i = full.indexOf("--setting-sources")
    const withoutSources = [...full.slice(0, i), ...full.slice(i + 2)]
    expect(runFake(withoutSources, empty).status).not.toBe(0)
  })

  it("--setting-sources が project 以外なら非ゼロで終わる", () => {
    const empty = mkdtempSync(path.join(dir, "cwd-"))
    const args = buildArgs({ model: "haiku", jsonSchema })
    args[args.indexOf("--setting-sources") + 1] = "user,project"
    expect(runFake(args, empty).status).not.toBe(0)
  })

  it("cwd が空でなければ非ゼロで終わる", () => {
    const busy = mkdtempSync(path.join(dir, "cwd-"))
    writeFileSync(path.join(busy, "CLAUDE.md"), "x")
    const res = runFake(buildArgs({ model: "haiku", jsonSchema }), busy)
    expect(res.status).not.toBe(0)
    expect(res.stderr).toContain("CLAUDE.md")
  })
})

describe("ClaudeCliProvider", () => {
  it("name は claude", () => {
    expect(new ClaudeCliProvider().name).toBe("claude")
  })

  it("正常系: result フィールドの JSON をパースして返す", async () => {
    process.env.FAKE_CLAUDE_MODE = "ok"
    process.env.FAKE_CLAUDE_RESPONSE = JSON.stringify({ message: "hello" })

    const provider = new ClaudeCliProvider()
    const result = await provider.invoke(makeCall(), makeCtl())

    expect(result).toEqual({ message: "hello" })
  })

  it("structured_output 形式をパースする", async () => {
    process.env.FAKE_CLAUDE_MODE = "structured"
    process.env.FAKE_CLAUDE_RESPONSE = JSON.stringify({ message: "structured" })

    const provider = new ClaudeCliProvider()
    const result = await provider.invoke(makeCall(), makeCtl())

    expect(result).toEqual({ message: "structured" })
  })

  it("コードフェンス付き result をパースする", async () => {
    process.env.FAKE_CLAUDE_MODE = "fenced"
    process.env.FAKE_CLAUDE_RESPONSE = JSON.stringify({ message: "fenced" })

    const provider = new ClaudeCliProvider()
    const result = await provider.invoke(makeCall(), makeCtl())

    expect(result).toEqual({ message: "fenced" })
  })

  it("bad-json: 1 回目失敗でも 2 回目で成功すればリトライで復帰する", async () => {
    process.env.FAKE_CLAUDE_MODE = "bad-json"
    process.env.FAKE_CLAUDE_RESPONSE = JSON.stringify({ message: "recovered" })
    process.env.FAKE_CLAUDE_STATE_FILE = path.join(dir, "state.txt")

    const provider = new ClaudeCliProvider()
    const result = await provider.invoke(makeCall(), makeCtl())

    expect(result).toEqual({ message: "recovered" })
  })

  it("bad-json が継続する場合は JudgeError(schema-mismatch) を投げる", async () => {
    process.env.FAKE_CLAUDE_MODE = "bad-json"
    process.env.FAKE_CLAUDE_RESPONSE = JSON.stringify({ message: "never" })
    // STATE_FILE を設定しないため常に bad-json のまま

    const provider = new ClaudeCliProvider()
    await expect(provider.invoke(makeCall(), makeCtl())).rejects.toMatchObject({
      name: "JudgeError",
      reason: "schema-mismatch"
    })
  })

  it("hang: タイムアウトを 1 回だけ再試行し、JudgeError(timeout) を投げる", async () => {
    process.env.FAKE_CLAUDE_MODE = "hang"
    const stateFile = path.join(dir, "state.txt")
    process.env.FAKE_CLAUDE_STATE_FILE = stateFile

    const provider = new ClaudeCliProvider()
    await expect(
      provider.invoke(makeCall(), makeCtl({ timeoutMs: 300 }))
    ).rejects.toMatchObject({ name: "JudgeError", reason: "timeout" })
    expect(callCount(stateFile)).toBe(2)
  })

  it("締切までの残りが 30 秒未満なら nonzero-exit を再試行しない", async () => {
    process.env.FAKE_CLAUDE_MODE = "fail"
    const stateFile = path.join(dir, "state.txt")
    process.env.FAKE_CLAUDE_STATE_FILE = stateFile

    const provider = new ClaudeCliProvider()
    await expect(
      provider.invoke(makeCall(), makeCtl({ deadline: Date.now() + 20000 }))
    ).rejects.toMatchObject({ reason: "nonzero-exit" })
    expect(callCount(stateFile)).toBe(1)
  })

  it("締切で縮んだ時間が切れたら deadline にし、再試行しない", async () => {
    process.env.FAKE_CLAUDE_MODE = "hang"
    const stateFile = path.join(dir, "state.txt")
    process.env.FAKE_CLAUDE_STATE_FILE = stateFile

    const provider = new ClaudeCliProvider()
    const started = Date.now()
    await expect(
      provider.invoke(
        makeCall(),
        makeCtl({ timeoutMs: 60000, deadline: Date.now() + 3500 })
      )
    ).rejects.toMatchObject({ name: "JudgeError", reason: "deadline" })
    expect(Date.now() - started).toBeLessThan(10000)
    expect(callCount(stateFile)).toBe(1)
  })

  it("締切を過ぎていれば子プロセスを起動せず deadline にする", async () => {
    process.env.FAKE_CLAUDE_MODE = "ok"
    const stateFile = path.join(dir, "state.txt")
    process.env.FAKE_CLAUDE_STATE_FILE = stateFile

    const provider = new ClaudeCliProvider()
    await expect(
      provider.invoke(makeCall(), makeCtl({ deadline: Date.now() }))
    ).rejects.toMatchObject({ reason: "deadline" })
    expect(callCount(stateFile)).toBe(0)
  })

  it("exit 1: 1 回だけ再試行し、JudgeError(nonzero-exit) を投げる", async () => {
    process.env.FAKE_CLAUDE_MODE = "fail"
    const stateFile = path.join(dir, "state.txt")
    process.env.FAKE_CLAUDE_STATE_FILE = stateFile

    const provider = new ClaudeCliProvider()
    await expect(provider.invoke(makeCall(), makeCtl())).rejects.toMatchObject({
      name: "JudgeError",
      reason: "nonzero-exit"
    })
    expect(callCount(stateFile)).toBe(2)
  })

  it("nonzero-exit の後の再試行で成功すれば応答を返す", async () => {
    process.env.FAKE_CLAUDE_MODE = "fail-once"
    process.env.FAKE_CLAUDE_RESPONSE = JSON.stringify({ message: "again" })
    process.env.FAKE_CLAUDE_STATE_FILE = path.join(dir, "state.txt")

    const provider = new ClaudeCliProvider()
    await expect(provider.invoke(makeCall(), makeCtl())).resolves.toEqual({
      message: "again"
    })
  })

  it("$schema を含むスキーマを渡すと fake が拒み、nonzero-exit になる", async () => {
    process.env.FAKE_CLAUDE_MODE = "ok"
    process.env.FAKE_CLAUDE_RESPONSE = JSON.stringify({ message: "x" })

    const provider = new ClaudeCliProvider()
    await expect(
      provider.invoke(
        makeCall({
          jsonSchema: {
            $schema: "https://json-schema.org/draft/2020-12/schema",
            ...jsonSchema
          }
        }),
        makeCtl()
      )
    ).rejects.toMatchObject({ reason: "nonzero-exit" })
  })

  it("存在しないバイナリは再試行せず JudgeError(unavailable) を投げる", async () => {
    process.env.RAGUEL_CLAUDE_BIN = path.join(dir, "does-not-exist-binary")

    const provider = new ClaudeCliProvider()
    await expect(provider.invoke(makeCall(), makeCtl())).rejects.toMatchObject({
      name: "JudgeError",
      reason: "unavailable"
    })
  })

  it("signal の abort で子プロセスを止め、再試行せず signal.reason を投げる", async () => {
    process.env.FAKE_CLAUDE_MODE = "hang"
    const stateFile = path.join(dir, "state.txt")
    process.env.FAKE_CLAUDE_STATE_FILE = stateFile
    const controller = new AbortController()

    const provider = new ClaudeCliProvider()
    const started = Date.now()
    const pending = provider.invoke(
      makeCall(),
      makeCtl({ timeoutMs: 60000, signal: controller.signal })
    )
    setTimeout(() => controller.abort(), 500)

    await expect(pending).rejects.toMatchObject({ name: "AbortError" })
    expect(Date.now() - started).toBeLessThan(10000)
    expect(callCount(stateFile)).toBe(1)
  })

  it("abort 済みの signal では子プロセスを起動しない", async () => {
    process.env.FAKE_CLAUDE_MODE = "ok"
    const stateFile = path.join(dir, "state.txt")
    process.env.FAKE_CLAUDE_STATE_FILE = stateFile
    const controller = new AbortController()
    controller.abort()

    const provider = new ClaudeCliProvider()
    await expect(
      provider.invoke(makeCall(), makeCtl({ signal: controller.signal }))
    ).rejects.toMatchObject({ name: "AbortError" })
    expect(callCount(stateFile)).toBe(0)
  })

  it("サブプロセス env に RAGUEL_PANELIST=1 が渡り、cwd は呼び出しごとの一時ディレクトリで終了後に消える", async () => {
    process.env.FAKE_CLAUDE_MODE = "ok"
    process.env.FAKE_CLAUDE_RESPONSE = JSON.stringify({ message: "x" })
    const dumpFile = path.join(dir, "env-dump.json")
    process.env.RAGUEL_ENV_DUMP_FILE = dumpFile

    const provider = new ClaudeCliProvider()
    await provider.invoke(makeCall(), makeCtl())

    const dump = JSON.parse(readFileSync(dumpFile, "utf8"))
    expect(dump.RAGUEL_PANELIST).toBe("1")
    expect(path.resolve(dump.cwd)).not.toBe(path.resolve(os.tmpdir()))
    expect(existsSync(dump.cwd)).toBe(false)
  })

  it("プロンプトが stdin 経由で渡る(argv には載らない)", async () => {
    process.env.FAKE_CLAUDE_MODE = "ok"
    process.env.FAKE_CLAUDE_RESPONSE = JSON.stringify({ message: "x" })
    const stdinFile = path.join(dir, "stdin.txt")
    process.env.FAKE_CLAUDE_STDIN_FILE = stdinFile

    const provider = new ClaudeCliProvider()
    await provider.invoke(makeCall(), makeCtl())

    expect(existsSync(stdinFile)).toBe(true)
    expect(readFileSync(stdinFile, "utf8")).toBe("テストプロンプト")
  })

  it("エラー文言に JudgeError インスタンスであることが分かる", async () => {
    process.env.FAKE_CLAUDE_MODE = "fail"
    const provider = new ClaudeCliProvider()
    try {
      await provider.invoke(makeCall(), makeCtl())
      throw new Error("エラーが投げられるはず")
    } catch (err) {
      expect(err).toBeInstanceOf(JudgeError)
    }
  })
})

describe("ClaudeCliProvider セマフォ", () => {
  it("maxConcurrency=2 のとき 4 並列呼び出しでも同時実行が 2 を超えない", async () => {
    process.env.FAKE_CLAUDE_MODE = "ok"
    process.env.FAKE_CLAUDE_RESPONSE = JSON.stringify({ message: "x" })
    process.env.FAKE_CLAUDE_DELAY_MS = "120"
    const timelineFile = path.join(dir, "timeline.txt")
    process.env.FAKE_CLAUDE_TIMELINE_FILE = timelineFile

    const provider = new ClaudeCliProvider(2)
    await Promise.all(
      [0, 1, 2, 3].map(() =>
        provider.invoke(makeCall(), makeCtl({ timeoutMs: 10000 }))
      )
    )

    const lines = readFileSync(timelineFile, "utf8").trim().split("\n")
    const intervals = lines.reduce<Array<{ start: number; end?: number }>>(
      (acc, line) => {
        const [kind, value] = line.split(":")
        const time = Number(value)
        if (kind === "start") {
          acc.push({ start: time })
        } else {
          const open = acc.find((iv) => iv.end === undefined)
          if (open) open.end = time
        }
        return acc
      },
      []
    )
    expect(intervals).toHaveLength(4)

    // 全区間の境界時刻それぞれで、同時に開いている区間数を数える
    const boundaries = intervals.flatMap((iv) => [iv.start, iv.end as number])
    for (const t of boundaries) {
      const overlapping = intervals.filter(
        (iv) => iv.start <= t && (iv.end ?? Infinity) >= t
      ).length
      expect(overlapping).toBeLessThanOrEqual(2)
    }
  })
})
