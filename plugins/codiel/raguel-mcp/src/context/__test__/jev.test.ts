import { describe, expect, it, vi } from "vitest"
import {
  checkBudget,
  createJevCall,
  estimateTokens,
  type JevRequest,
  TOTAL_BUDGET,
  VALUE_BUDGET
} from "../jev.js"

const question = { q: { type: "noul" as const, instructions: "Is it true?" } }

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" }
  })
}

describe("estimateTokens", () => {
  it("UTF-8 のバイト数を 2.5 で割って切り上げる", () => {
    expect(estimateTokens("abcde")).toBe(2)
    expect(estimateTokens("あ")).toBe(2)
    expect(estimateTokens("")).toBe(0)
  })
})

describe("checkBudget", () => {
  it("1 つの値が上限ちょうどなら通し、超えたら理由を返す", () => {
    const bytes = VALUE_BUDGET * 2.5
    expect(
      checkBudget({ state: { a: "a".repeat(bytes) }, questions: question })
    ).toBeNull()
    expect(
      checkBudget({ state: { a: "a".repeat(bytes + 3) }, questions: question })
    ).toMatch(/1 つの値/)
  })

  it("値ごとに収まっても合計が上限を超えたら理由を返す", () => {
    const value = "a".repeat(20_000 * 2.5)
    const req: JevRequest = {
      state: { a: value, b: value },
      questions: question
    }
    expect(checkBudget(req)).toBeNull()
    expect(checkBudget({ ...req, state: { ...req.state, c: value } })).toMatch(
      new RegExp(`${TOTAL_BUDGET}`)
    )
  })
})

describe("createJevCall", () => {
  const req: JevRequest = {
    state: { artifact: "x" },
    questions: question,
    model: "jev-test"
  }

  it("回答を返し、model と質問を送る", async () => {
    const fetch = vi.fn(async (_url: string, _init?: RequestInit) =>
      jsonResponse({
        model: "jev-test",
        answers: { q: { type: "noul", noul: 0.4 } },
        usage: { input_tokens: 1, output_tokens: 0 }
      })
    )
    const call = createJevCall("test-key", fetch)
    const res = await call(req, {
      timeout: 1000,
      signal: new AbortController().signal
    })
    expect(res.answers.q).toEqual({ type: "noul", noul: 0.4 })
    const body = JSON.parse(String(fetch.mock.calls[0][1]?.body))
    expect(body.model).toBe("jev-test")
    expect(body.questions.q.type).toBe("noul")
  })

  it("サーバーの 500 でも再試行しない", async () => {
    const fetch = vi.fn(async () =>
      jsonResponse(
        { error: { message: "boom", type: "internal_server_error" } },
        500
      )
    )
    const call = createJevCall("test-key", fetch)
    await expect(
      call(req, { timeout: 1000, signal: new AbortController().signal })
    ).rejects.toThrow()
    expect(fetch).toHaveBeenCalledTimes(1)
  })
})
