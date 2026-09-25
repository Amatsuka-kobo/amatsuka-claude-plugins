import { describe, expect, it, vi } from "vitest"
import { z } from "zod"
import { createJevCall, type JevCall } from "../../jev/client.js"
import {
  classifyItemsInput,
  handleClassifyItems,
  handleJevAsk,
  handleRankItems,
  jevAskInput,
  normalizeItems,
  rankItemsInput
} from "../judging.js"
import type { ToolDeps, ToolResponse } from "../shared.js"

type RequestBody = {
  state: unknown
  questions: Record<
    string,
    { type: string; instructions?: string; criteria?: unknown }
  >
  model?: string
}

function jsonResponse(
  body: unknown,
  status = 200,
  headers: Record<string, string> = {}
): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json", ...headers }
  })
}

function successfulResponse(
  request: RequestBody,
  answerFor: (
    id: string,
    question: RequestBody["questions"][string]
  ) => unknown = (_id, question) => {
    if (question.type === "noul") return { type: "noul", noul: 0.9 }
    if (question.type === "choice") {
      const label = Object.keys(question.criteria as Record<string, unknown>)[0]
      return { type: "choice", choice: label, confidence: 0.8 }
    }
    return { type: "score", score: 1, confidence: 0.7 }
  }
): Response {
  return jsonResponse({
    model: request.model ?? "jev-test",
    answers: Object.fromEntries(
      Object.entries(request.questions).map(([id, question]) => [
        id,
        answerFor(id, question)
      ])
    ),
    usage: { input_tokens: 17, output_tokens: 0 }
  })
}

function depsFor(fakeFetch: typeof fetch, apiKey: string | undefined = "test") {
  const env: NodeJS.ProcessEnv =
    apiKey === undefined ? {} : { TYPESAFE_API_KEY: apiKey }
  const jev: JevCall = createJevCall({ apiKey: "test", fetch: fakeFetch })
  const deps: ToolDeps = {
    jev,
    env,
    projectDir: "/tmp/jevriel-test",
    now: () => new Date(0),
    httpFetch: fakeFetch
  }
  return deps
}

function body<T>(response: ToolResponse): T {
  return JSON.parse(response.content[0].text) as T
}

function requestFrom(init?: RequestInit): RequestBody {
  return JSON.parse(String(init?.body)) as RequestBody
}

describe("judging tools", () => {
  it("returns not_configured without calling Jev for all three tools", async () => {
    const fakeFetch = vi.fn<typeof fetch>()
    const deps = depsFor(fakeFetch, "")

    const responses = await Promise.all([
      handleJevAsk({ state: null, questions: { q: { type: "noul" } } }, deps),
      handleClassifyItems(
        { items: ["item"], categories: { a: "A", b: "B" } },
        deps
      ),
      handleRankItems(
        { items: ["item"], criterion: "quality", levels: ["low", "high"] },
        deps
      )
    ])

    expect(
      responses.map(
        (response) => body<{ error: { kind: string } }>(response).error.kind
      )
    ).toEqual(["not_configured", "not_configured", "not_configured"])
    expect(fakeFetch).not.toHaveBeenCalled()
  })

  it("sends jev_ask state and questions unchanged and returns answers unchanged", async () => {
    const answers = {
      truth: { type: "noul", noul: 0.4 },
      pick: { type: "choice", choice: "yes", confidence: 0.8 }
    }
    let sent: RequestBody | undefined
    const fakeFetch = vi.fn<typeof fetch>(async (_input, init) => {
      sent = requestFrom(init)
      return jsonResponse({
        model: "fixture-model",
        answers,
        usage: { input_tokens: 33, output_tokens: 0 }
      })
    })
    const state = { prompt: "raw state", values: [1, true] }
    const questions = {
      truth: {
        type: "noul" as const,
        instructions: "Check the claim.",
        criteria: { true: "supported", false: "unsupported" }
      },
      pick: {
        type: "choice" as const,
        instructions: "Choose one.",
        options: { yes: "Affirmative", no: "Negative" }
      }
    }

    const response = await handleJevAsk(
      { state, questions, model: "requested-model" },
      depsFor(fakeFetch)
    )
    const result = body<{
      model: string
      answers: typeof answers
      usage: { requests: number; inputTokens: number }
    }>(response)

    expect(fakeFetch).toHaveBeenCalledTimes(1)
    expect(sent?.state).toEqual(state)
    expect(sent?.model).toBe("requested-model")
    expect(sent?.questions.truth).toMatchObject({
      type: "noul",
      criteria: { true: "supported", false: "unsupported" }
    })
    expect(result).toEqual({
      model: "fixture-model",
      answers,
      usage: { requests: 1, inputTokens: 33 }
    })
  })

  it("rejects choice questions with fewer than 2 or more than 255 options", () => {
    const schema = z.object(jevAskInput)
    const question = (options: Record<string, string | null>) => ({
      state: null,
      questions: { pick: { type: "choice", instructions: "Pick", options } }
    })

    expect(schema.safeParse(question({ only: "one" })).success).toBe(false)
    expect(
      schema.safeParse(
        question(
          Object.fromEntries(
            Array.from({ length: 256 }, (_, i) => [`o${i}`, null])
          )
        )
      ).success
    ).toBe(false)
  })

  it("normalizes string items to sequential ids and rejects duplicate ids", () => {
    expect(normalizeItems(["first", "second"])).toEqual({
      ok: true,
      items: [
        { id: "i1", text: "first" },
        { id: "i2", text: "second" }
      ]
    })
    expect(
      normalizeItems([
        { id: "same", text: "first" },
        { id: "same", text: "second" }
      ])
    ).toMatchObject({ ok: false })
  })

  it("puts item text in state and not in classify instructions", async () => {
    let sent: RequestBody | undefined
    const fakeFetch = vi.fn<typeof fetch>(async (_input, init) => {
      sent = requestFrom(init)
      return successfulResponse(sent)
    })
    const itemText = "private item body 91d842"

    const response = await handleClassifyItems(
      { items: [itemText], categories: { yes: "Yes", no: "No" } },
      depsFor(fakeFetch)
    )

    expect(body<{ results: unknown[] }>(response).results).toHaveLength(1)
    expect(sent?.state).toMatchObject({ items: { i1: itemText } })
    expect(JSON.stringify(sent?.questions)).not.toContain(itemText)
  })

  it("returns invalid_input for duplicate ids and a single category", async () => {
    const fakeFetch = vi.fn<typeof fetch>()
    const deps = depsFor(fakeFetch)
    const duplicate = await handleClassifyItems(
      {
        items: [
          { id: "dup", text: "one" },
          { id: "dup", text: "two" }
        ],
        categories: { one: "One", two: "Two" }
      },
      deps
    )
    const oneCategory = await handleClassifyItems(
      { items: ["one"], categories: { only: "Only" } },
      deps
    )

    expect(body<{ error: { kind: string } }>(duplicate).error.kind).toBe(
      "invalid_input"
    )
    expect(body<{ error: { kind: string } }>(oneCategory).error.kind).toBe(
      "invalid_input"
    )
    expect(fakeFetch).not.toHaveBeenCalled()
  })

  it("keeps classify results in input order", async () => {
    const fakeFetch = vi.fn<typeof fetch>(async (_input, init) => {
      const request = requestFrom(init)
      return successfulResponse(request, (id) => ({
        type: "choice",
        choice: id === "i1" ? "third" : id === "i2" ? "first" : "second",
        confidence: 0.8
      }))
    })

    const response = await handleClassifyItems(
      {
        items: ["one", "two", "three"],
        categories: { first: "First", second: "Second", third: "Third" }
      },
      depsFor(fakeFetch)
    )

    expect(
      body<{ results: Array<{ id: string; category: string }> }>(response)
        .results
    ).toEqual([
      { id: "i1", category: "third", confidence: 0.8 },
      { id: "i2", category: "first", confidence: 0.8 },
      { id: "i3", category: "second", confidence: 0.8 }
    ])
  })

  it("marks only an oversized classify item too_large and continues", async () => {
    const fakeFetch = vi.fn<typeof fetch>(async (_input, init) =>
      successfulResponse(requestFrom(init))
    )

    const response = await handleClassifyItems(
      {
        items: ["x".repeat(70_000), "small item"],
        categories: { yes: "Yes", no: "No" }
      },
      depsFor(fakeFetch)
    )
    const results = body<{
      results: Array<{ id: string; status?: string; category?: string }>
    }>(response).results

    expect(results[0]).toEqual({ id: "i1", status: "too_large" })
    expect(results[1]).toMatchObject({ id: "i2", category: "yes" })
    expect(fakeFetch).toHaveBeenCalledTimes(1)
  })

  it("rejects context above the solo limit without calling Jev", async () => {
    const fakeFetch = vi.fn<typeof fetch>()
    const response = await handleClassifyItems(
      {
        items: ["small item"],
        categories: { yes: "Yes", no: "No" },
        context: "c".repeat(70_000)
      },
      depsFor(fakeFetch)
    )

    expect(body<{ error: { kind: string } }>(response).error.kind).toBe(
      "budget_exceeded"
    )
    expect(fakeFetch).not.toHaveBeenCalled()
  })

  it("limits concurrent calls to four across five or more classify batches", async () => {
    let active = 0
    let maximum = 0
    const fakeFetch = vi.fn<typeof fetch>(async (_input, init) => {
      const request = requestFrom(init)
      active += 1
      maximum = Math.max(maximum, active)
      await new Promise((resolve) => setTimeout(resolve, 5))
      active -= 1
      return successfulResponse(request)
    })

    const response = await handleClassifyItems(
      {
        items: Array.from({ length: 401 }, (_, i) => `item ${i}`),
        categories: { yes: "Yes", no: "No" }
      },
      depsFor(fakeFetch)
    )

    expect(fakeFetch).toHaveBeenCalledTimes(5)
    expect(maximum).toBeLessThanOrEqual(4)
    expect(body<{ results: unknown[] }>(response).results).toHaveLength(401)
  })

  it("retries one parallel batch after Retry-After 429 and retains all results", async () => {
    let rateLimited = false
    const fakeFetch = vi.fn<typeof fetch>(async (_input, init) => {
      if (!rateLimited) {
        rateLimited = true
        return jsonResponse(
          {
            error: { message: "rate limit exceeded", type: "rate_limit_error" }
          },
          429,
          { "retry-after": "0" }
        )
      }
      return successfulResponse(requestFrom(init))
    })

    const response = await handleClassifyItems(
      {
        items: Array.from({ length: 101 }, (_, i) => `item ${i}`),
        categories: { yes: "Yes", no: "No" }
      },
      depsFor(fakeFetch)
    )

    expect(response.isError).not.toBe(true)
    expect(fakeFetch).toHaveBeenCalledTimes(3)
    const results = body<{
      results: Array<{ id: string; category?: string }>
    }>(response).results
    expect(results).toHaveLength(101)
    expect(results.every((result) => typeof result.category === "string")).toBe(
      true
    )
  })

  it("ranks by descending score, preserves ties, maps levels, and puts oversized items last", async () => {
    const scores = new Map([
      ["i1", 1.2],
      ["i2", 2],
      ["i3", 2],
      ["i4", 0.5]
    ])
    const fakeFetch = vi.fn<typeof fetch>(async (_input, init) =>
      successfulResponse(requestFrom(init), (id) => ({
        type: "score",
        score: scores.get(id) ?? 1,
        confidence: 0.7
      }))
    )

    const response = await handleRankItems(
      {
        items: ["one", "two", "three", "four", "x".repeat(70_000)],
        criterion: "quality",
        levels: ["low", "middle", "high"]
      },
      depsFor(fakeFetch)
    )
    const results = body<{
      results: Array<{
        id: string
        score?: number
        level?: string
        status?: string
      }>
    }>(response).results

    expect(results.map((result) => result.id)).toEqual([
      "i2",
      "i3",
      "i1",
      "i4",
      "i5"
    ])
    expect(results[2]).toMatchObject({ score: 1.2, level: "middle" })
    expect(results[3]).toMatchObject({ score: 0.5, level: "middle" })
    expect(results[4]).toEqual({ id: "i5", status: "too_large" })
  })

  it("validates rank input as a raw Zod shape", () => {
    expect(
      z
        .object(rankItemsInput)
        .safeParse({ items: ["one"], criterion: "quality", levels: ["only"] })
        .success
    ).toBe(false)
    expect(
      z
        .object(classifyItemsInput)
        .safeParse({ items: [], categories: { one: "One", two: "Two" } })
        .success
    ).toBe(false)
  })
})
