import { existsSync } from "node:fs"
import { mkdtemp, readFile, rm } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import {
  createJevCall,
  type JevCall,
  type JevRequest
} from "../../jev/client.js"
import {
  type ApiCheckArgs,
  apiCheckInput,
  handleApiCheck,
  handleApiRunGoal
} from "../api.js"
import type { ToolDeps, ToolResponse } from "../shared.js"

type JevPayload = JevRequest & {
  state: {
    request: { method: string; url: string; headers: Record<string, string> }
    response: {
      status: number
      headers: Record<string, string>
      body: unknown
      truncated?: boolean
    }
    assertions: Record<string, string>
  }
}

function body<T>(response: ToolResponse): T {
  return JSON.parse(response.content[0].text) as T
}

function httpResponse(
  text: string,
  options: {
    status?: number
    contentType?: string
    headers?: Record<string, string>
  } = {}
): Response {
  return new Response(text, {
    status: options.status ?? 200,
    headers: {
      "content-type": options.contentType ?? "application/json",
      ...options.headers
    }
  })
}

function jevFor(
  probability = 0.9,
  onRequest?: (request: JevPayload) => void
): JevCall {
  return createJevCall({
    apiKey: "test",
    fetch: async (_input, init) => {
      const request = JSON.parse(String(init?.body)) as JevPayload
      onRequest?.(request)
      return new Response(
        JSON.stringify({
          model: "jev-test",
          answers: Object.fromEntries(
            Object.keys(request.questions).map((id) => [
              id,
              { type: "noul", noul: probability }
            ])
          ),
          usage: { input_tokens: 17, output_tokens: 0 }
        }),
        { headers: { "content-type": "application/json" } }
      )
    }
  })
}

let projectDir = ""

function depsFor(
  httpFetch: typeof fetch,
  jev: JevCall = jevFor(),
  apiKey: string | undefined = "test"
): ToolDeps {
  return {
    jev,
    env: apiKey === undefined ? {} : { TYPESAFE_API_KEY: apiKey },
    projectDir,
    now: () => new Date("2026-01-02T03:04:05.000Z"),
    httpFetch
  }
}

function args(overrides: Partial<ApiCheckArgs> = {}): ApiCheckArgs {
  return {
    request: {
      method: "GET",
      url: "https://api.example.test/resource",
      headers: {}
    },
    assertions: ["The response is successful."],
    timeoutMs: 30000,
    name: undefined,
    evidence: "always",
    thresholds: { satisfied: 0.8, unsatisfied: 0.2 },
    ...overrides
  }
}

let tempDir = ""

beforeEach(async () => {
  tempDir = await mkdtemp(join(tmpdir(), "jevriel-api-test-"))
  projectDir = tempDir
})

afterEach(async () => {
  await rm(tempDir, { recursive: true, force: true })
})

describe("apiCheckInput", () => {
  it("provides the documented defaults for the request", () => {
    const parsed = apiCheckInput.request.parse({
      url: "https://api.example.test/resource"
    })
    expect(parsed).toEqual({
      method: "GET",
      url: "https://api.example.test/resource",
      headers: {}
    })
  })
})

describe("handleApiCheck", () => {
  it("returns not_configured without sending a request or creating evidence", async () => {
    const httpFetch = vi.fn<typeof fetch>()
    const response = await handleApiCheck(
      args(),
      depsFor(httpFetch, jevFor(), "")
    )

    expect(response.isError).toBe(true)
    expect(body<{ error: { kind: string } }>(response).error.kind).toBe(
      "not_configured"
    )
    expect(httpFetch).not.toHaveBeenCalled()
    expect(existsSync(join(projectDir, ".jevriel"))).toBe(false)
  })

  it("returns request_failed and creates no evidence when the HTTP request fails", async () => {
    const httpFetch = vi.fn<typeof fetch>(async () => {
      throw new TypeError("connection refused")
    })
    const response = await handleApiCheck(args(), depsFor(httpFetch))

    expect(response.isError).toBe(true)
    expect(body<{ error: { kind: string } }>(response).error.kind).toBe(
      "request_failed"
    )
    expect(existsSync(join(projectDir, ".jevriel"))).toBe(false)
  })

  it("redacts and sanitizes state and evidence without recording the request body", async () => {
    let jevRequest: JevPayload | undefined
    const httpFetch = vi.fn<typeof fetch>(async (_input, init) => {
      expect(init?.body).toBe('{"secret":"private request body"}')
      expect(new Headers(init?.headers).get("content-type")).toBe(
        "application/json"
      )
      return httpResponse('{"ok":true}', {
        headers: {
          "x-api-key": "response-secret",
          "content-type": "application/json"
        }
      })
    })
    const response = await handleApiCheck(
      args({
        request: {
          method: "POST",
          url: "https://user:pass@api.example.test/resource?token=secret&page=2",
          headers: {
            Authorization: "Bearer request-secret",
            "X-Visible": "safe"
          },
          body: { secret: "private request body" }
        }
      }),
      depsFor(
        httpFetch,
        jevFor(0.9, (request) => (jevRequest = request))
      )
    )

    expect(response.isError).toBeUndefined()
    expect(jevRequest?.state.request).toEqual({
      method: "POST",
      url: "https://api.example.test/resource?token=&page=",
      headers: {
        Authorization: "[redacted]",
        "X-Visible": "safe",
        "content-type": "application/json"
      }
    })
    expect(jevRequest?.state.request).not.toHaveProperty("body")
    expect(jevRequest?.state.response).toMatchObject({
      status: 200,
      headers: { "x-api-key": "[redacted]" },
      body: { ok: true }
    })
    expect(jevRequest?.state.assertions).toEqual({
      a1: "The response is successful."
    })

    const record = body<{ evidence: { dir: string; files: string[] } }>(
      response
    )
    const savedLog = await readFile(
      join(record.evidence.dir, "log.json"),
      "utf8"
    )
    const savedResult = await readFile(
      join(record.evidence.dir, "result.json"),
      "utf8"
    )
    expect(savedLog).not.toContain("private request body")
    expect(savedLog).not.toContain("request-secret")
    expect(savedLog).not.toContain("token=secret")
    expect(savedLog).toContain("[redacted]")
    expect(JSON.parse(savedResult)).toEqual(body(response))
  })

  it("passes only when every assertion is satisfied", async () => {
    const httpFetch = vi.fn<typeof fetch>(async () =>
      httpResponse('{"ok":true}')
    )
    const pass = await handleApiCheck(args(), depsFor(httpFetch, jevFor(0.9)))
    const fail = await handleApiCheck(args(), depsFor(httpFetch, jevFor(0.1)))

    expect(
      body<{ status: string; assertions: Array<{ verdict: string }> }>(pass)
    ).toMatchObject({
      status: "pass",
      assertions: [{ verdict: "satisfied" }]
    })
    expect(
      body<{ status: string; assertions: Array<{ verdict: string }> }>(fail)
    ).toMatchObject({
      status: "fail",
      assertions: [{ verdict: "unsatisfied" }]
    })
  })

  it("records Jev exceptions as an error result with evidence", async () => {
    const jev: JevCall = async () => {
      throw new TypeError("Jev unavailable")
    }
    const response = await handleApiCheck(
      args(),
      depsFor(
        vi.fn<typeof fetch>(async () => httpResponse('{"ok":true}')),
        jev
      )
    )
    const record = body<{
      tool: string
      kind: string
      status: string
      reason: string
      error: { errorClass: string }
      evidence: { dir: string; files: string[] }
    }>(response)

    expect(response.isError).toBeUndefined()
    expect(record).toMatchObject({
      tool: "api_check",
      kind: "api",
      status: "error",
      reason: "TypeError",
      error: { errorClass: "TypeError" },
      goal: null,
      reached: null,
      steps: []
    })
    expect(record.evidence.files).toContain("log.json")
    expect(existsSync(join(record.evidence.dir, "result.json"))).toBe(true)
  })

  it("returns null evidence and creates no directory when evidence is none", async () => {
    const response = await handleApiCheck(
      args({ evidence: "none" }),
      depsFor(vi.fn<typeof fetch>(async () => httpResponse('{"ok":true}')))
    )

    expect(body<{ evidence: unknown }>(response).evidence).toBeNull()
    expect(existsSync(join(projectDir, ".jevriel"))).toBe(false)
  })

  it("marks a long response body as truncated in the output and state", async () => {
    let jevRequest: JevPayload | undefined
    const response = await handleApiCheck(
      args(),
      depsFor(
        vi.fn<typeof fetch>(async () =>
          httpResponse("x".repeat(200_000), { contentType: "text/plain" })
        ),
        jevFor(0.9, (request) => (jevRequest = request))
      )
    )

    expect(
      body<{ response: { truncated: boolean } }>(response).response.truncated
    ).toBe(true)
    expect(jevRequest?.state.response.truncated).toBe(true)
  })

  it("returns budget_exceeded without calling Jev when assertions alone exceed the budget", async () => {
    const httpFetch = vi.fn<typeof fetch>(async () =>
      httpResponse("ok", { contentType: "text/plain" })
    )
    const jevFetch = vi.fn<typeof fetch>()
    const response = await handleApiCheck(
      args({ assertions: ["x".repeat(200_000)] }),
      depsFor(httpFetch, createJevCall({ apiKey: "test", fetch: jevFetch }))
    )

    expect(response.isError).toBe(true)
    expect(body<{ error: { kind: string } }>(response).error.kind).toBe(
      "budget_exceeded"
    )
    expect(httpFetch).toHaveBeenCalledTimes(1)
    expect(jevFetch).not.toHaveBeenCalled()
    expect(existsSync(join(projectDir, ".jevriel"))).toBe(false)
  })
})

function goalArgs(overrides: Record<string, unknown> = {}) {
  return {
    baseUrl: "https://api.example.test/",
    goal: "Finish",
    requests: { get: { method: "GET" as const, path: "/", headers: {} } },
    assertions: ["Complete"],
    inputs: {},
    maxSteps: 3,
    timeoutMs: 30000,
    allowedHosts: ["api.example.test"],
    name: undefined,
    evidence: "always" as const,
    thresholds: { satisfied: 0.8, unsatisfied: 0.2 },
    ...overrides
  }
}

function goalJev(
  choices: string[],
  probability = 0.9,
  states: unknown[] = []
): JevCall {
  return createJevCall({
    apiKey: "test",
    fetch: async (_url, init) => {
      const request = JSON.parse(String(init?.body)) as JevRequest
      states.push(request.state)
      return new Response(
        JSON.stringify({
          model: "jev-test",
          answers: Object.fromEntries(
            Object.keys(request.questions).map((key) => [
              key,
              key === "next"
                ? {
                    type: "choice",
                    choice: choices.shift() ?? "done",
                    confidence: 0.9
                  }
                : {
                    type: "noul",
                    noul:
                      "assertions" in (request.state as object)
                        ? probability
                        : 0.1
                  }
            ])
          ),
          usage: { input_tokens: 7, output_tokens: 0 }
        }),
        { headers: { "content-type": "application/json" } }
      )
    }
  })
}

describe("handleApiRunGoal", () => {
  it.each([
    "done",
    "stuck"
  ])("rejects the reserved request name %s", async (name) => {
    const response = await handleApiRunGoal(
      goalArgs({
        requests: { [name]: { method: "GET", path: "/", headers: {} } }
      }),
      depsFor(vi.fn<typeof fetch>(), goalJev([]))
    )
    expect(response.isError).toBe(true)
    expect(body<{ error: { kind: string } }>(response).error.kind).toBe(
      "invalid_input"
    )
    expect(existsSync(join(projectDir, ".jevriel"))).toBe(false)
  })
  it("returns a pre-send budget failure without evidence", async () => {
    const http = vi.fn<typeof fetch>()
    const response = await handleApiRunGoal(
      goalArgs({ goal: "x".repeat(200_000) }),
      depsFor(http, goalJev([]))
    )
    expect(response.isError).toBe(true)
    expect(body<{ error: { kind: string } }>(response).error.kind).toBe(
      "budget_exceeded"
    )
    expect(http).not.toHaveBeenCalled()
    expect(existsSync(join(projectDir, ".jevriel"))).toBe(false)
  })
  it("records an after-send budget failure with evidence", async () => {
    const result = await handleApiRunGoal(
      goalArgs({ evidence: "always" }),
      depsFor(
        vi.fn<typeof fetch>(async () =>
          httpResponse(JSON.stringify({ response: "x".repeat(400_000) }), {
            headers: { "x-long": "x".repeat(100_000) }
          })
        ),
        goalJev(["get"])
      )
    )
    const record = body<{
      status: string
      reason: string
      error: { kind: string }
      evidence: { dir: string }
    }>(result)
    expect(result.isError).toBeUndefined()
    expect(record).toMatchObject({
      status: "error",
      reason: "budget_exceeded",
      error: { kind: "budget_exceeded" }
    })
    expect(existsSync(join(record.evidence.dir, "result.json"))).toBe(true)
  })
  it("saves sanitized logs and a result matching tool output", async () => {
    const states: unknown[] = []
    const result = await handleApiRunGoal(
      goalArgs({
        baseUrl: "https://api.example.test/?token=s3cret",
        inputs: { tenant: "s3cret-value" },
        requests: {
          get: {
            method: "GET",
            path: "/?token={{inputs.tenant}}",
            headers: { "X-Tenant": "{{inputs.tenant}}" }
          }
        }
      }),
      depsFor(
        vi.fn<typeof fetch>(async () => httpResponse("{}")),
        goalJev(["get", "done"], 0.9, states)
      )
    )
    const record = body<{
      tool: string
      kind: string
      name: string
      evidence: { dir: string }
    }>(result)
    const log = await readFile(join(record.evidence.dir, "log.json"), "utf8")
    expect(record).toMatchObject({
      tool: "api_run_goal",
      kind: "api",
      name: "api.example.test"
    })
    expect(log).not.toContain("s3cret-value")
    expect(log).toContain("[redacted]")
    expect(JSON.stringify(states)).not.toContain("s3cret-value")
    expect(
      JSON.parse(
        await readFile(join(record.evidence.dir, "result.json"), "utf8")
      )
    ).toEqual(record)
  })
  it.each([
    "always",
    "on_failure",
    "none"
  ] as const)("honors %s on success and failure", async (evidence) => {
    for (const probability of [0.9, 0.1]) {
      const result = await handleApiRunGoal(
        goalArgs({ evidence }),
        depsFor(vi.fn<typeof fetch>(), goalJev(["done"], probability))
      )
      const record = body<{ evidence: unknown }>(result)
      expect(Boolean(record.evidence)).toBe(
        evidence === "always" ||
          (evidence === "on_failure" && probability === 0.1)
      )
    }
  })
})
