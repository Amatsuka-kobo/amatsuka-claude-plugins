import { existsSync } from "node:fs"
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { z } from "zod"
import {
  createJevCall,
  type JevCall,
  type JevRequest
} from "../../jev/client.js"
import {
  type ApiCheckArgs,
  apiCheckInput,
  apiRunGoalInput,
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

describe("template path evidence", () => {
  it("sends the actual path but keeps inputs out of result.json and log.json", async () => {
    const http = vi.fn<typeof fetch>(async () => httpResponse("{}"))
    const result = await handleApiRunGoal(
      goalArgs({
        inputs: { uid: "s3cret-value" },
        requests: {
          get: { method: "GET", path: "/users/{{inputs.uid}}", headers: {} }
        }
      }),
      depsFor(http, goalJev(["get", "done"]))
    )
    const record = body<{
      evidence: { dir: string }
      steps: Array<{ url: string }>
    }>(result)
    expect(http.mock.calls[0][0]).toContain("s3cret-value")
    expect(record.steps[0].url).toContain("[redacted]")
    expect(
      await readFile(join(record.evidence.dir, "result.json"), "utf8")
    ).not.toContain("s3cret-value")
    expect(
      await readFile(join(record.evidence.dir, "log.json"), "utf8")
    ).not.toContain("s3cret-value")
  })
})

const specArgs = (overrides: Record<string, unknown> = {}) =>
  goalArgs({
    requests: undefined,
    spec: "openapi.json",
    allowedHosts: undefined,
    ...overrides
  })

const specDocument = (
  paths: Record<string, unknown> = {
    "/items": {
      get: {
        operationId: "get_items",
        responses: { 200: { description: "OK" } }
      }
    }
  },
  extra: Record<string, unknown> = {}
) => ({
  openapi: "3.1.0",
  info: { title: "Test", version: "1" },
  paths,
  ...extra
})

async function saveSpec(doc: unknown): Promise<void> {
  await writeFile(join(projectDir, "openapi.json"), JSON.stringify(doc))
}

function specJev(requests: JevRequest[] = [], choice = "get_items"): JevCall {
  return createJevCall({
    apiKey: "test",
    fetch: async (_url, init) => {
      const request = JSON.parse(String(init?.body)) as JevRequest
      requests.push(request)
      return new Response(
        JSON.stringify({
          model: "jev-test",
          answers: Object.fromEntries(
            Object.keys(request.questions).map((key) => [
              key,
              key === "next"
                ? { type: "choice", choice, confidence: 0.9 }
                : key === "reached" || key.startsWith("a")
                  ? {
                      type: "noul",
                      noul:
                        "assertions" in (request.state as object) ? 0.9 : 0.1
                    }
                  : { type: "choice", choice: "c1", confidence: 0.9 }
            ])
          ),
          usage: { input_tokens: 7, output_tokens: 0 }
        }),
        { headers: { "content-type": "application/json" } }
      )
    }
  })
}

describe("api_run_goal with OpenAPI", () => {
  it.each([
    ["both", { requests: { get: { method: "GET", path: "/", headers: {} } } }],
    ["neither", { spec: undefined }],
    [
      "include on templates",
      {
        spec: undefined,
        requests: { get: { method: "GET", path: "/", headers: {} } },
        include: { tags: ["test"] }
      }
    ],
    [
      "headers on templates",
      {
        spec: undefined,
        requests: { get: { method: "GET", path: "/", headers: {} } },
        headers: { X: "value" }
      }
    ]
  ])("rejects %s before fetching, calling Jev, or creating evidence", async (_label, overrides) => {
    const http = vi.fn<typeof fetch>()
    const jevFetch = vi.fn<typeof fetch>()
    const response = await handleApiRunGoal(
      specArgs(overrides),
      depsFor(http, createJevCall({ apiKey: "test", fetch: jevFetch }))
    )
    expect(response.isError).toBe(true)
    expect(body<{ error: { kind: string } }>(response).error.kind).toBe(
      "invalid_input"
    )
    expect(http).not.toHaveBeenCalled()
    expect(jevFetch).not.toHaveBeenCalled()
    expect(existsSync(join(projectDir, ".jevriel"))).toBe(false)
  })

  it("requires baseUrl for spec and validates include and headers", () => {
    const schema = z.object(apiRunGoalInput)
    expect(schema.safeParse(specArgs({ baseUrl: undefined })).success).toBe(
      false
    )
    expect(
      schema.safeParse(specArgs({ include: { methods: [] } })).success
    ).toBe(false)
    expect(
      schema.safeParse(
        specArgs({ headers: { X: "v" }, include: { methods: ["DELETE"] } })
      ).success
    ).toBe(true)
  })

  it("rejects 254 input keys before reading the spec; accepts 253", async () => {
    const http = vi.fn<typeof fetch>()
    const jevFetch = vi.fn<typeof fetch>()
    const inputs = Object.fromEntries(
      Array.from({ length: 254 }, (_, i) => [`k${i}`, "v"])
    )
    const response = await handleApiRunGoal(
      specArgs({ inputs }),
      depsFor(http, createJevCall({ apiKey: "test", fetch: jevFetch }))
    )
    expect(body<{ error: { kind: string } }>(response).error.kind).toBe(
      "invalid_input"
    )
    expect(jevFetch).not.toHaveBeenCalled()
    expect(http).not.toHaveBeenCalled()
    expect(existsSync(join(projectDir, ".jevriel"))).toBe(false)
    await saveSpec(specDocument())
    const accepted = await handleApiRunGoal(
      specArgs({
        inputs: Object.fromEntries(Object.entries(inputs).slice(0, 253))
      }),
      depsFor(http, specJev())
    )
    expect(accepted.isError).toBeUndefined()
  })

  it.each([
    ["empty", {}, { tags: ["missing"] }, "invalid_input", "0"],
    [
      "too many",
      Object.fromEntries(
        Array.from({ length: 254 }, (_, i) => [
          `/p${i}`,
          { get: { operationId: `op${i}` } }
        ])
      ),
      undefined,
      "invalid_input",
      "254"
    ]
  ])("rejects %s operations without evidence", async (_label, paths, include, kind, count) => {
    await saveSpec(specDocument(paths))
    const jevFetch = vi.fn<typeof fetch>()
    const http = vi.fn<typeof fetch>()
    const response = await handleApiRunGoal(
      specArgs({ include }),
      depsFor(http, createJevCall({ apiKey: "test", fetch: jevFetch }))
    )
    expect(response.isError).toBe(true)
    const error = body<{ error: { kind: string; message: string } }>(
      response
    ).error
    expect(error.kind).toBe(kind)
    expect(error.message).toContain(count)
    expect(error.message).toContain("include")
    expect(jevFetch).not.toHaveBeenCalled()
    expect(http).not.toHaveBeenCalled()
    expect(existsSync(join(projectDir, ".jevriel"))).toBe(false)
  })

  it.each([
    302, 404, 0
  ])("sanitizes spec URL errors for status %s without evidence", async (status) => {
    const http = vi.fn<typeof fetch>(async () => {
      if (status === 0) throw new Error("secret abc")
      return httpResponse("", { status })
    })
    const jevFetch = vi.fn<typeof fetch>()
    const response = await handleApiRunGoal(
      specArgs({ spec: "https://spec.example/openapi.json?token=abc" }),
      depsFor(http, createJevCall({ apiKey: "test", fetch: jevFetch }))
    )
    const error = body<{ error: { kind: string; message: string } }>(
      response
    ).error
    expect(response.isError).toBe(true)
    expect(error.kind).toBe(status === 404 ? "invalid_input" : "request_failed")
    expect(error.message).not.toContain("abc")
    expect(jevFetch).not.toHaveBeenCalled()
    expect(existsSync(join(projectDir, ".jevriel"))).toBe(false)
  })

  it("drops summaries before starting and rejects larger metadata with count and include guidance", async () => {
    const paths = Object.fromEntries(
      Array.from({ length: 12 }, (_, i) => [
        `/p${i}`,
        { get: { operationId: `op${i}`, summary: "a".repeat(6000) } }
      ])
    )
    await saveSpec(specDocument(paths))
    const seen: JevRequest[] = []
    const result = await handleApiRunGoal(
      specArgs({ maxSteps: 1 }),
      depsFor(
        vi.fn<typeof fetch>(async () => httpResponse("{}")),
        specJev(seen, "op0")
      )
    )
    expect(result.isError).toBeUndefined()
    expect(JSON.stringify(seen[0]?.state)).not.toContain("a".repeat(6000))
    await rm(join(projectDir, ".jevriel"), { recursive: true, force: true })
    await saveSpec(
      specDocument({ "/p": { get: { operationId: "x".repeat(64) } } })
    )
    const denied = await handleApiRunGoal(
      specArgs({ goal: "g".repeat(200_000) }),
      depsFor(vi.fn<typeof fetch>(), specJev())
    )
    const error = body<{ error: { kind: string; message: string } }>(
      denied
    ).error
    expect(error.kind).toBe("budget_exceeded")
    expect(error.message).toContain("1 operations")
    expect(error.message).toContain("include")
    expect(existsSync(join(projectDir, ".jevriel"))).toBe(false)
  })

  it("uses operations metadata and baseUrl defaults, ignoring spec servers", async () => {
    await saveSpec(
      specDocument(
        {
          "/items": {
            get: {
              operationId: "get_items",
              summary: "Read items",
              responses: { 200: {} },
              parameters: [
                {
                  name: "id",
                  in: "query",
                  required: true,
                  schema: { type: "integer", example: 7 }
                }
              ]
            }
          }
        },
        { servers: [{ url: "https://evil.example" }] }
      )
    )
    const seen: JevRequest[] = []
    const http = vi.fn<typeof fetch>(async () => httpResponse("{}"))
    const response = await handleApiRunGoal(
      specArgs({ maxSteps: 1, baseUrl: "https://api.example.test/v1" }),
      depsFor(http, specJev(seen))
    )
    const record = body<{
      name: string
      evidence: { dir: string }
      steps: Array<{ url: string; values: unknown[] }>
      spec: unknown
    }>(response)
    expect(record.name).toBe("api.example.test")
    expect(String(http.mock.calls[0]?.[0])).toContain(
      "api.example.test/v1/items"
    )
    expect(JSON.stringify(seen[0]?.state)).toContain('"operations"')
    expect(seen[0]?.state).toMatchObject({
      operations: {
        get_items: {
          method: "GET",
          path: "/items",
          summary: "Read items",
          requiredParams: ["id"],
          body: "none"
        }
      }
    })
    expect(record.steps[0]?.values).toEqual([
      {
        target: "id",
        in: "query",
        source: "spec",
        ref: "example[0]",
        confidence: null
      }
    ])
    expect(record.spec).toEqual({
      source: join(projectDir, "openapi.json"),
      openapi: "3.1.0",
      operations: 1
    })
    expect(
      JSON.parse(
        await readFile(join(record.evidence.dir, "result.json"), "utf8")
      )
    ).toEqual(record)
  })

  it("sends examples to fill Jev but never sends or records private inputs, headers, or auth", async () => {
    await saveSpec(
      specDocument(
        {
          "/items/{id}": {
            post: {
              operationId: "get_items",
              responses: { 200: {} },
              security: [{ bearer: [] }],
              parameters: [
                {
                  name: "id",
                  in: "path",
                  required: true,
                  schema: { type: "string", example: "example-marker-42" }
                },
                {
                  name: "q",
                  in: "query",
                  required: true,
                  schema: { type: "string" }
                },
                {
                  name: "X-Private",
                  in: "header",
                  required: true,
                  schema: { type: "string" }
                }
              ],
              requestBody: {
                required: true,
                content: { "application/json": { schema: { type: "object" } } }
              }
            }
          }
        },
        {
          components: {
            securitySchemes: { bearer: { type: "http", scheme: "bearer" } }
          }
        }
      )
    )
    const secrets = ["s3cret-value", "bearer-value", "manual-value"]
    const inputs = {
      id: secrets[0],
      q: secrets[0],
      "X-Private": secrets[0],
      payload: JSON.stringify({ value: secrets[0] }),
      bearer: secrets[1]
    }
    const seen: JevRequest[] = []
    const http = vi.fn<typeof fetch>(async () =>
      httpResponse("{}", { status: 201 })
    )
    const response = await handleApiRunGoal(
      specArgs({ inputs, headers: { "X-Manual": secrets[2] }, maxSteps: 1 }),
      depsFor(http, specJev(seen))
    )
    const record = body<{
      evidence: { dir: string }
      spec: unknown
      steps: Array<{ url: string; undocumented: boolean; values: unknown[] }>
    }>(response)
    expect(response.isError).toBeUndefined()
    expect(record.steps[0]?.undocumented).toBe(true)
    expect(record.steps[0]?.values[0]).toMatchObject({
      target: "id",
      in: "path",
      source: "input",
      ref: "id",
      confidence: 0.9
    })
    expect(JSON.stringify(seen)).toContain("example-marker-42")
    expect(String(http.mock.calls[0]?.[0])).toContain("s3cret-value")
    expect(JSON.stringify(http.mock.calls[0]?.[1])).toContain("bearer-value")
    expect(JSON.stringify(http.mock.calls[0]?.[1])).toContain("manual-value")
    const resultJson = await readFile(
      join(record.evidence.dir, "result.json"),
      "utf8"
    )
    const logJson = await readFile(
      join(record.evidence.dir, "log.json"),
      "utf8"
    )
    for (const secret of secrets) {
      expect(JSON.stringify(seen)).not.toContain(secret)
      expect(resultJson).not.toContain(secret)
      expect(logJson).not.toContain(secret)
    }
  })

  it("sanitizes the URL source in the record and saved result", async () => {
    const http = vi.fn<typeof fetch>(async (url) =>
      String(url).includes("spec.example")
        ? httpResponse(JSON.stringify(specDocument()))
        : httpResponse("{}")
    )
    const response = await handleApiRunGoal(
      specArgs({
        spec: "https://spec.example/openapi.json?token=abc",
        maxSteps: 1
      }),
      depsFor(http, specJev())
    )
    const record = body<{
      spec: { source: string }
      evidence: { dir: string }
    }>(response)
    expect(record.spec.source).toBe("https://spec.example/openapi.json?token=")
    expect(
      await readFile(join(record.evidence.dir, "result.json"), "utf8")
    ).not.toContain("abc")
  })
})
