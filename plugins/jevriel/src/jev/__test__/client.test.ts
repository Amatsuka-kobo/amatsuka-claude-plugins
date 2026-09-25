import { readFileSync } from "node:fs"
import { afterEach, describe, expect, it, vi } from "vitest"
import {
  createJevCall,
  describeJevError,
  hasApiKey,
  type JevRequest
} from "../client.js"

const normalFixture = JSON.parse(
  readFileSync(
    new URL("../../fixtures/jev/normal.json", import.meta.url),
    "utf8"
  )
) as unknown
const rateLimitFixture = JSON.parse(
  readFileSync(
    new URL("../../fixtures/jev/rate-limit.json", import.meta.url),
    "utf8"
  )
) as unknown
const serverErrorFixture = JSON.parse(
  readFileSync(
    new URL("../../fixtures/jev/server-error.json", import.meta.url),
    "utf8"
  )
) as unknown

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

const request: JevRequest = {
  state: { subject: "test" },
  questions: { decision: { type: "noul", instructions: "Is it true?" } }
}

afterEach(() => {
  vi.restoreAllMocks()
  vi.unstubAllEnvs()
})

describe("hasApiKey", () => {
  it("returns false for an unset or empty key", () => {
    expect(hasApiKey({})).toBe(false)
    expect(hasApiKey({ TYPESAFE_API_KEY: "" })).toBe(false)
    expect(hasApiKey({ TYPESAFE_API_KEY: "test-key" })).toBe(true)
  })
})

describe("createJevCall", () => {
  it("logs the usage-to-estimate ratio to stderr at debug level, not stdout", async () => {
    vi.stubEnv("JEVRIEL_LOG_LEVEL", "debug")
    const stderr = vi.spyOn(process.stderr, "write")
    const stdout = vi.spyOn(process.stdout, "write")
    const fakeFetch = vi.fn(async () => jsonResponse(normalFixture))

    await createJevCall({ apiKey: "test", fetch: fakeFetch })(request)

    const lines = stderr.mock.calls
      .map(([chunk]) => String(chunk))
      .filter(Boolean)
    expect(lines).toHaveLength(1)
    expect(lines[0]).toContain("[jevriel:debug]")
    expect(lines[0]).toContain("inputTokens")
    expect(lines[0]).toContain("ratio")
    expect(stdout).not.toHaveBeenCalled()
  })

  it("sends state and all question types using SDK question shapes", async () => {
    let sent: Record<string, unknown> | undefined
    const fakeFetch = vi.fn(
      async (_input: string | URL | Request, init?: RequestInit) => {
        sent = JSON.parse(String(init?.body)) as Record<string, unknown>
        return jsonResponse(normalFixture)
      }
    )
    const req: JevRequest = {
      state: { prompt: "value" },
      questions: {
        truth: {
          type: "noul",
          instructions: "Check",
          criteria: { true: { yes: 1 }, false: "no" }
        },
        pick: {
          type: "choice",
          instructions: "Pick",
          options: { yes: "affirmative", no: null }
        },
        rating: { type: "score", instructions: "Rate", levels: ["low", "high"] }
      },
      model: "jev-test"
    }

    await createJevCall({ apiKey: "test", fetch: fakeFetch })(req)

    expect(sent?.state).toEqual(req.state)
    expect(sent?.model).toBe("jev-test")
    expect(sent?.questions).toEqual({
      truth: {
        type: "noul",
        instructions: "Check",
        criteria: { true: { yes: 1 }, false: "no" }
      },
      pick: {
        type: "choice",
        instructions: "Pick",
        criteria: { yes: "affirmative", no: null }
      },
      rating: { type: "score", instructions: "Rate", criteria: ["low", "high"] }
    })
  })

  it.each([
    { status: 401, errorClass: "AuthenticationError" },
    { status: 400, errorClass: "BadRequestError" },
    { status: 422, errorClass: "UnprocessableEntityError" },
    { status: 500, errorClass: "InternalServerError" }
  ])("maps HTTP $status to $errorClass with the SDK status and request ID", async ({
    status,
    errorClass
  }) => {
    const fakeFetch = vi.fn(async () =>
      jsonResponse(
        status === 500
          ? serverErrorFixture
          : { error: { message: "fixture error" } },
        status,
        {
          "x-typesafe-request-id": "request-123"
        }
      )
    )
    let mapped: ReturnType<typeof describeJevError> | undefined
    try {
      await createJevCall({ apiKey: "test", fetch: fakeFetch })(request)
    } catch (error) {
      mapped = describeJevError(error)
    }

    expect(mapped).toMatchObject({
      errorClass,
      status,
      requestId: "request-123"
    })
  })

  it("maps a timeout to the SDK timeout class", async () => {
    const fakeFetch: typeof fetch = (_input, init) =>
      new Promise((_resolve, reject) => {
        const signal = init?.signal
        const abort = () => reject(new DOMException("aborted", "AbortError"))
        if (signal?.aborted) abort()
        else signal?.addEventListener("abort", abort, { once: true })
      })
    let mapped: ReturnType<typeof describeJevError> | undefined
    try {
      await createJevCall({ apiKey: "test", fetch: fakeFetch })(request, {
        timeout: 1
      })
    } catch (error) {
      mapped = describeJevError(error)
    }

    expect(mapped?.errorClass).toBe("APITimeoutError")
    expect(mapped?.status).toBeUndefined()
  })

  it("maps connection failures to the SDK connection class", async () => {
    const fakeFetch = vi.fn(async () => {
      throw new TypeError("offline")
    })
    let mapped: ReturnType<typeof describeJevError> | undefined
    try {
      await createJevCall({ apiKey: "test", fetch: fakeFetch })(request)
    } catch (error) {
      mapped = describeJevError(error)
    }

    expect(mapped?.errorClass).toBe("APIConnectionError")
    expect(mapped?.status).toBeUndefined()
  })

  it("retries a Retry-After 429 and succeeds on the second response", async () => {
    let calls = 0
    const fakeFetch = vi.fn(async () => {
      calls += 1
      if (calls === 1)
        return jsonResponse(rateLimitFixture, 429, { "retry-after": "1" })
      return jsonResponse(normalFixture)
    })

    const result = await createJevCall({ apiKey: "test", fetch: fakeFetch })(
      request
    )

    expect(result.usage.input_tokens).toBe(25)
    expect(calls).toBe(2)
  })

  it("returns the SDK RateLimitError after three consecutive 429 responses", async () => {
    const fakeFetch = vi.fn(async () =>
      jsonResponse(rateLimitFixture, 429, {
        "x-typesafe-request-id": "rate-id"
      })
    )
    let mapped: ReturnType<typeof describeJevError> | undefined
    try {
      await createJevCall({ apiKey: "test", fetch: fakeFetch })(request)
    } catch (error) {
      mapped = describeJevError(error)
    }

    expect(fakeFetch).toHaveBeenCalledTimes(3)
    expect(mapped).toMatchObject({
      errorClass: "RateLimitError",
      status: 429,
      requestId: "rate-id"
    })
  })
})
