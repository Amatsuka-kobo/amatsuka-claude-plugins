import { mkdtempSync, rmSync } from "node:fs"
import * as os from "node:os"
import * as path from "node:path"
import { fileURLToPath } from "node:url"
import { afterEach, beforeEach, describe, expect, it } from "vitest"
import { ClaudeCliProvider } from "../claudeCli.js"
import { CodexCliProvider } from "../codexCli.js"
import { JudgeError, NoneProvider } from "../provider.js"
import { standardPanelResponseSchema, toJsonSchema } from "../schema.js"

describe("NoneProvider", () => {
  it("name は none で、常に JudgeError(provider-none) を投げる", async () => {
    const provider = new NoneProvider()
    expect(provider.name).toBe("none")
    await expect(
      provider.invoke({
        role: "test",
        model: "haiku",
        prompt: "x",
        // biome-ignore lint/suspicious/noExplicitAny: テスト用の最小スキーマ
        schema: { parse: (v: unknown) => v } as any,
        jsonSchema: {},
        timeoutMs: 1000
      })
    ).rejects.toMatchObject({ name: "JudgeError", reason: "provider-none" })
  })

  it("JudgeError は reason を保持する", () => {
    const err = new JudgeError("unavailable", "テスト")
    expect(err.reason).toBe("unavailable")
    expect(err.message).toBe("テスト")
    expect(err).toBeInstanceOf(Error)
  })
})

describe("2 プロバイダーの同じ入力", () => {
  const envKeys = [
    "RAGUEL_CLAUDE_BIN",
    "RAGUEL_CODEX_BIN",
    "FAKE_CLAUDE_MODE",
    "FAKE_CLAUDE_RESPONSE",
    "FAKE_CODEX_MODE",
    "FAKE_CODEX_RESPONSE"
  ] as const
  const savedEnv: Record<string, string | undefined> = {}
  let dir: string

  beforeEach(() => {
    dir = mkdtempSync(path.join(os.tmpdir(), "raguel-provider-test-"))
    for (const key of envKeys) savedEnv[key] = process.env[key]
    process.env.RAGUEL_CLAUDE_BIN = fileURLToPath(
      new URL("../../testing/fake-claude.mjs", import.meta.url)
    )
    process.env.RAGUEL_CODEX_BIN = fileURLToPath(
      new URL("../../testing/fake-codex.mjs", import.meta.url)
    )
  })

  afterEach(() => {
    for (const key of envKeys) {
      if (savedEnv[key] === undefined) delete process.env[key]
      else process.env[key] = savedEnv[key]
    }
    rmSync(dir, { recursive: true, force: true })
  })

  it("同じ JudgeCall に対し、claude と codex が同じ形の応答を返す", async () => {
    const schema = standardPanelResponseSchema(["risk"])
    const call = {
      role: "adversarial",
      model: "sonnet",
      prompt: "同じプロンプト",
      schema,
      jsonSchema: toJsonSchema(schema),
      timeoutMs: 5000
    }
    const answer = {
      findings: [{ severity: "ask", confidence: 70, message: "懸念" }],
      scores: { risk: 40 }
    }
    // claude はエンベロープの result に入れ、codex は任意の欄を null で埋めて -o に書く
    process.env.FAKE_CLAUDE_MODE = "ok"
    process.env.FAKE_CLAUDE_RESPONSE = JSON.stringify(answer)
    process.env.FAKE_CODEX_RESPONSE = JSON.stringify({
      ...answer,
      findings: [{ ...answer.findings[0], evidence: null }]
    })

    const fromClaude = await new ClaudeCliProvider().invoke(call)
    const fromCodex = await new CodexCliProvider().invoke(call)

    expect(fromClaude).toEqual(answer)
    expect(fromCodex).toEqual(fromClaude)
  })
})
