import { describe, expect, it } from "vitest"
import { JudgeError, NoneProvider } from "../provider.js"

describe("NoneProvider", () => {
  it("常に JudgeError(provider-none) を投げる", async () => {
    const provider = new NoneProvider()
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
    const err = new JudgeError("timeout", "テスト")
    expect(err.reason).toBe("timeout")
    expect(err.message).toBe("テスト")
    expect(err).toBeInstanceOf(Error)
  })
})
