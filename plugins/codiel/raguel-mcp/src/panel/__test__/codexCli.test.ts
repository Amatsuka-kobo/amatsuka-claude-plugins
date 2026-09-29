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
import {
  buildCodexArgs,
  CodexCliProvider,
  stripOptionalNulls,
  toStrictSchema
} from "../codexCli.js"
import { toJsonSchema } from "../schema.js"

const FAKE_CODEX = fileURLToPath(
  new URL("../../testing/fake-codex.mjs", import.meta.url)
)

const responseSchema = z.object({
  message: z.string(),
  evidence: z.object({ location: z.string().optional() }).optional()
})
const jsonSchema = toJsonSchema(responseSchema)

let dir: string
const envKeys = [
  "RAGUEL_CODEX_BIN",
  "FAKE_CODEX_MODE",
  "FAKE_CODEX_RESPONSE",
  "FAKE_CODEX_STDIN_FILE",
  "FAKE_CODEX_STATE_FILE",
  "FAKE_CODEX_ARGS_FILE",
  "RAGUEL_ENV_DUMP_FILE"
] as const
const savedEnv: Record<string, string | undefined> = {}

beforeEach(() => {
  dir = mkdtempSync(path.join(os.tmpdir(), "raguel-codexcli-test-"))
  for (const key of envKeys) savedEnv[key] = process.env[key]
  process.env.RAGUEL_CODEX_BIN = FAKE_CODEX
})

afterEach(() => {
  for (const key of envKeys) {
    if (savedEnv[key] === undefined) delete process.env[key]
    else process.env[key] = savedEnv[key]
  }
  rmSync(dir, { recursive: true, force: true })
})

function makeCall(
  overrides: Partial<{ model: string; timeoutMs: number }> = {}
) {
  return {
    role: "test-role",
    model: overrides.model ?? "",
    prompt: "テストプロンプト",
    schema: responseSchema,
    jsonSchema,
    timeoutMs: overrides.timeoutMs ?? 5000
  }
}

function callCount(stateFile: string): number {
  return existsSync(stateFile) ? Number(readFileSync(stateFile, "utf8")) : 0
}

describe("buildCodexArgs", () => {
  it("隔離のフラグ・読み取り専用のサンドボックス・一時ディレクトリの中のファイル・stdin の - を並べる", () => {
    expect(buildCodexArgs("/tmp/x", "")).toEqual([
      "exec",
      "--ephemeral",
      "--ignore-user-config",
      "--skip-git-repo-check",
      "--sandbox",
      "read-only",
      "--output-schema",
      path.join("/tmp/x", "schema.json"),
      "-o",
      path.join("/tmp/x", "last-message.json"),
      "-"
    ])
  })

  it("model があれば - の前に -m を足す", () => {
    expect(buildCodexArgs("/tmp/x", "gpt-5").slice(-3)).toEqual([
      "-m",
      "gpt-5",
      "-"
    ])
  })
})

describe("toStrictSchema と stripOptionalNulls", () => {
  it("全プロパティを required に並べ、任意のものは null を許し、additionalProperties: false を付ける", () => {
    const strict = toStrictSchema(jsonSchema as Record<string, unknown>)
    expect(strict.required).toEqual(["message", "evidence"])
    expect(strict.additionalProperties).toBe(false)
    const evidence = (strict.properties as Record<string, { anyOf: unknown[] }>)
      .evidence
    expect(evidence.anyOf[1]).toEqual({ type: "null" })
    const inner = evidence.anyOf[0] as Record<string, unknown>
    expect(inner.required).toEqual(["location"])
    expect(inner.additionalProperties).toBe(false)
  })

  it("元のスキーマで任意だった欄の null だけを取り除く", () => {
    expect(
      stripOptionalNulls(
        { message: "m", evidence: { location: null } },
        jsonSchema as Record<string, unknown>
      )
    ).toEqual({ message: "m", evidence: {} })
    expect(
      stripOptionalNulls(
        { message: null, evidence: null },
        jsonSchema as Record<string, unknown>
      )
    ).toEqual({ message: null })
  })
})

describe("fake-codex.mjs の起動の検査", () => {
  function prepare(schema: object): string {
    const work = mkdtempSync(path.join(dir, "cwd-"))
    writeFileSync(path.join(work, "schema.json"), JSON.stringify(schema))
    return work
  }
  function runFake(args: string[], cwd: string) {
    return spawnSync(process.execPath, [FAKE_CODEX, ...args], {
      cwd,
      input: "x",
      encoding: "utf8",
      env: { ...process.env, FAKE_CODEX_MODE: "ok", FAKE_CODEX_RESPONSE: "{}" }
    })
  }
  const strict = toStrictSchema(jsonSchema as Record<string, unknown>)

  it("buildCodexArgs の引数と厳格なスキーマなら 0 で終わり、-o に書く", () => {
    const work = prepare(strict)
    const res = runFake(buildCodexArgs(work, ""), work)
    expect(res.status).toBe(0)
    expect(readFileSync(path.join(work, "last-message.json"), "utf8")).toBe(
      "{}"
    )
  })

  it("厳格でないスキーマで非ゼロで終わる", () => {
    const work = prepare(jsonSchema)
    const res = runFake(buildCodexArgs(work, ""), work)
    expect(res.status).not.toBe(0)
  })

  it("隔離のフラグが 1 つでも欠けると非ゼロで終わる", () => {
    for (const flag of [
      "--ephemeral",
      "--ignore-user-config",
      "--skip-git-repo-check"
    ]) {
      const work = prepare(strict)
      const res = runFake(
        buildCodexArgs(work, "").filter((a) => a !== flag),
        work
      )
      expect(res.status, flag).not.toBe(0)
    }
  })

  it("サンドボックスが read-only でなければ非ゼロで終わる", () => {
    const work = prepare(strict)
    const args = buildCodexArgs(work, "")
    args[args.indexOf("--sandbox") + 1] = "workspace-write"
    expect(runFake(args, work).status).not.toBe(0)
  })

  it("cwd にスキーマのほかのファイルがあれば非ゼロで終わる", () => {
    const work = prepare(strict)
    writeFileSync(path.join(work, "AGENTS.md"), "x")
    const res = runFake(buildCodexArgs(work, ""), work)
    expect(res.status).not.toBe(0)
    expect(res.stderr).toContain("AGENTS.md")
  })
})

describe("CodexCliProvider", () => {
  it("name は codex", () => {
    expect(new CodexCliProvider().name).toBe("codex")
  })

  it("-o のファイルを読み、任意の欄の null を取り除いて zod で検証する(stdout は使わない)", async () => {
    process.env.FAKE_CODEX_RESPONSE = JSON.stringify({
      message: "hello",
      evidence: null
    })

    const provider = new CodexCliProvider()
    await expect(provider.invoke(makeCall())).resolves.toEqual({
      message: "hello"
    })
  })

  it("model が空なら -m を付けず、あれば付ける", async () => {
    process.env.FAKE_CODEX_RESPONSE = JSON.stringify({ message: "x" })
    const argsFile = path.join(dir, "args.json")
    process.env.FAKE_CODEX_ARGS_FILE = argsFile

    const provider = new CodexCliProvider()
    await provider.invoke(makeCall())
    expect(JSON.parse(readFileSync(argsFile, "utf8"))).not.toContain("-m")

    await provider.invoke(makeCall({ model: "gpt-5" }))
    const args = JSON.parse(readFileSync(argsFile, "utf8")) as string[]
    expect(args[args.indexOf("-m") + 1]).toBe("gpt-5")
  })

  it("プロンプトを stdin で渡し、env に RAGUEL_PANELIST=1 を足し、一時 cwd は終了後に消える", async () => {
    process.env.FAKE_CODEX_RESPONSE = JSON.stringify({ message: "x" })
    const stdinFile = path.join(dir, "stdin.txt")
    const dumpFile = path.join(dir, "env-dump.json")
    process.env.FAKE_CODEX_STDIN_FILE = stdinFile
    process.env.RAGUEL_ENV_DUMP_FILE = dumpFile

    await new CodexCliProvider().invoke(makeCall())

    expect(readFileSync(stdinFile, "utf8")).toBe("テストプロンプト")
    const dump = JSON.parse(readFileSync(dumpFile, "utf8"))
    expect(dump.RAGUEL_PANELIST).toBe("1")
    expect(existsSync(dump.cwd)).toBe(false)
  })

  it("bad-json: 1 回目の出力が読めなければ問い直して復帰する", async () => {
    process.env.FAKE_CODEX_MODE = "bad-json"
    process.env.FAKE_CODEX_RESPONSE = JSON.stringify({ message: "recovered" })
    process.env.FAKE_CODEX_STATE_FILE = path.join(dir, "state.txt")

    await expect(new CodexCliProvider().invoke(makeCall())).resolves.toEqual({
      message: "recovered"
    })
  })

  it("bad-json が続けば JudgeError(schema-mismatch)", async () => {
    process.env.FAKE_CODEX_MODE = "bad-json"

    await expect(
      new CodexCliProvider().invoke(makeCall())
    ).rejects.toMatchObject({ name: "JudgeError", reason: "schema-mismatch" })
  })

  it("exit 1 は 1 回だけ再試行し、JudgeError(nonzero-exit)", async () => {
    process.env.FAKE_CODEX_MODE = "fail"
    const stateFile = path.join(dir, "state.txt")
    process.env.FAKE_CODEX_STATE_FILE = stateFile

    await expect(
      new CodexCliProvider().invoke(makeCall())
    ).rejects.toMatchObject({ reason: "nonzero-exit" })
    expect(callCount(stateFile)).toBe(2)
  })

  it("hang はタイムアウトを 1 回だけ再試行し、JudgeError(timeout)", async () => {
    process.env.FAKE_CODEX_MODE = "hang"
    const stateFile = path.join(dir, "state.txt")
    process.env.FAKE_CODEX_STATE_FILE = stateFile

    await expect(
      new CodexCliProvider().invoke(makeCall(), {
        timeoutMs: 300,
        signal: new AbortController().signal
      })
    ).rejects.toMatchObject({ reason: "timeout" })
    expect(callCount(stateFile)).toBe(2)
  })

  it("signal の abort で子プロセスを止め、再試行しない", async () => {
    process.env.FAKE_CODEX_MODE = "hang"
    const stateFile = path.join(dir, "state.txt")
    process.env.FAKE_CODEX_STATE_FILE = stateFile
    const controller = new AbortController()

    const pending = new CodexCliProvider().invoke(makeCall(), {
      timeoutMs: 60000,
      signal: controller.signal
    })
    setTimeout(() => controller.abort(), 500)

    await expect(pending).rejects.toMatchObject({ name: "AbortError" })
    expect(callCount(stateFile)).toBe(1)
  })

  it("存在しないバイナリは JudgeError(unavailable)", async () => {
    process.env.RAGUEL_CODEX_BIN = path.join(dir, "does-not-exist-binary")

    await expect(
      new CodexCliProvider().invoke(makeCall())
    ).rejects.toMatchObject({ reason: "unavailable" })
  })
})
