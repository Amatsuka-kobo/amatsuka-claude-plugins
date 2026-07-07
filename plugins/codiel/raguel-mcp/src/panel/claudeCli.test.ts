import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs"
import * as os from "node:os"
import * as path from "node:path"
import { fileURLToPath } from "node:url"
import { afterEach, beforeEach, describe, expect, it } from "vitest"
import { z } from "zod"
import { ClaudeCliProvider } from "./claudeCli.js"
import { JudgeError } from "./provider.js"

const FAKE_CLAUDE = fileURLToPath(
  new URL("./testing/fake-claude.mjs", import.meta.url)
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
  overrides: Partial<{ timeoutMs: number; role: string }> = {}
) {
  return {
    role: overrides.role ?? "test-role",
    model: "haiku",
    prompt: "テストプロンプト",
    schema: responseSchema,
    jsonSchema,
    timeoutMs: overrides.timeoutMs ?? 5000
  }
}

describe("ClaudeCliProvider", () => {
  it("正常系: result フィールドの JSON をパースして返す", async () => {
    process.env.FAKE_CLAUDE_MODE = "ok"
    process.env.FAKE_CLAUDE_RESPONSE = JSON.stringify({ message: "hello" })

    const provider = new ClaudeCliProvider()
    const result = await provider.invoke(makeCall())

    expect(result).toEqual({ message: "hello" })
  })

  it("structured_output 形式をパースする", async () => {
    process.env.FAKE_CLAUDE_MODE = "structured"
    process.env.FAKE_CLAUDE_RESPONSE = JSON.stringify({ message: "structured" })

    const provider = new ClaudeCliProvider()
    const result = await provider.invoke(makeCall())

    expect(result).toEqual({ message: "structured" })
  })

  it("コードフェンス付き result をパースする", async () => {
    process.env.FAKE_CLAUDE_MODE = "fenced"
    process.env.FAKE_CLAUDE_RESPONSE = JSON.stringify({ message: "fenced" })

    const provider = new ClaudeCliProvider()
    const result = await provider.invoke(makeCall())

    expect(result).toEqual({ message: "fenced" })
  })

  it("bad-json: 1 回目失敗でも 2 回目で成功すればリトライで復帰する", async () => {
    process.env.FAKE_CLAUDE_MODE = "bad-json"
    process.env.FAKE_CLAUDE_RESPONSE = JSON.stringify({ message: "recovered" })
    process.env.FAKE_CLAUDE_STATE_FILE = path.join(dir, "state.txt")

    const provider = new ClaudeCliProvider()
    const result = await provider.invoke(makeCall())

    expect(result).toEqual({ message: "recovered" })
  })

  it("bad-json が継続する場合は JudgeError(schema-mismatch) を投げる", async () => {
    process.env.FAKE_CLAUDE_MODE = "bad-json"
    process.env.FAKE_CLAUDE_RESPONSE = JSON.stringify({ message: "never" })
    // STATE_FILE を設定しないため常に bad-json のまま

    const provider = new ClaudeCliProvider()
    await expect(provider.invoke(makeCall())).rejects.toMatchObject({
      name: "JudgeError",
      reason: "schema-mismatch"
    })
  })

  it("hang: タイムアウトで JudgeError(timeout) を投げる", async () => {
    process.env.FAKE_CLAUDE_MODE = "hang"

    const provider = new ClaudeCliProvider()
    await expect(
      provider.invoke(makeCall({ timeoutMs: 200 }))
    ).rejects.toMatchObject({ name: "JudgeError", reason: "timeout" })
  })

  it("exit 1: JudgeError(nonzero-exit) を投げる", async () => {
    process.env.FAKE_CLAUDE_MODE = "fail"

    const provider = new ClaudeCliProvider()
    await expect(provider.invoke(makeCall())).rejects.toMatchObject({
      name: "JudgeError",
      reason: "nonzero-exit"
    })
  })

  it("存在しないバイナリは JudgeError(spawn-failure) を投げる", async () => {
    process.env.RAGUEL_CLAUDE_BIN = path.join(dir, "does-not-exist-binary")

    const provider = new ClaudeCliProvider()
    await expect(provider.invoke(makeCall())).rejects.toMatchObject({
      name: "JudgeError",
      reason: "spawn-failure"
    })
  })

  it("サブプロセス env に RAGUEL_PANELIST=1 が渡る", async () => {
    process.env.FAKE_CLAUDE_MODE = "ok"
    process.env.FAKE_CLAUDE_RESPONSE = JSON.stringify({ message: "x" })
    const dumpFile = path.join(dir, "env-dump.json")
    process.env.RAGUEL_ENV_DUMP_FILE = dumpFile

    const provider = new ClaudeCliProvider()
    await provider.invoke(makeCall())

    expect(existsSync(dumpFile)).toBe(true)
    const dump = JSON.parse(readFileSync(dumpFile, "utf8"))
    expect(dump.RAGUEL_PANELIST).toBe("1")
  })

  it("プロンプトが stdin 経由で渡る(argv には載らない)", async () => {
    process.env.FAKE_CLAUDE_MODE = "ok"
    process.env.FAKE_CLAUDE_RESPONSE = JSON.stringify({ message: "x" })
    const stdinFile = path.join(dir, "stdin.txt")
    process.env.FAKE_CLAUDE_STDIN_FILE = stdinFile

    const provider = new ClaudeCliProvider()
    await provider.invoke(makeCall())

    expect(existsSync(stdinFile)).toBe(true)
    expect(readFileSync(stdinFile, "utf8")).toBe("テストプロンプト")
  })

  it("エラー文言に JudgeError インスタンスであることが分かる", async () => {
    process.env.FAKE_CLAUDE_MODE = "fail"
    const provider = new ClaudeCliProvider()
    try {
      await provider.invoke(makeCall())
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
      [0, 1, 2, 3].map(() => provider.invoke(makeCall({ timeoutMs: 10000 })))
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
