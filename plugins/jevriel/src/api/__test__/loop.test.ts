import { describe, expect, it, vi } from "vitest"
import type { LogEntry } from "../../evidence.js"
import {
  createJevCall,
  type JevCall,
  type JevRequest
} from "../../jev/client.js"
import type { ApiRequest, ApiResponse } from "../http.js"
import {
  type ApiGoalInput,
  chooseDropSummary,
  pushRecent,
  type RequestSource,
  redactPathSegments,
  runApiGoal
} from "../loop.js"
import { templateSource } from "../template.js"

const now = () => new Date("2026-01-02T03:04:05.000Z")
const reply = (body: unknown = { ok: true }, status = 200): ApiResponse => ({
  status,
  headers: { location: "/next", "x-api-key": "hidden" },
  body,
  contentType: "application/json",
  bodyBytes: 100
})
const input = (overrides: Partial<ApiGoalInput> = {}): ApiGoalInput => ({
  baseUrl: "https://api.test/",
  goal: "Get the result",
  source: templateSource({
    login: { method: "POST", path: "/login", headers: {} },
    list: {
      method: "GET",
      path: "/items/{{steps.login.body.token}}",
      headers: {}
    }
  }),
  assertions: ["the goal is met"],
  inputs: {},
  maxSteps: 5,
  allowedHosts: ["api.test"],
  timeoutMs: 30000,
  thresholds: { satisfied: 0.8, unsatisfied: 0.2 },
  name: "api-test",
  dropSummary: false,
  ...overrides
})
function harness(choices: string[], reached = 0.1, final = 0.9) {
  const states: unknown[] = []
  const timeouts: unknown[] = []
  const jev: JevCall = createJevCall({
    apiKey: "test",
    fetch: async (_url, init) => {
      const req = JSON.parse(String(init?.body)) as JevRequest
      states.push(req.state)
      const answers = Object.fromEntries(
        Object.keys(req.questions).map((key) => [
          key,
          key === "next"
            ? {
                type: "choice",
                choice: choices.shift() ?? "done",
                confidence: 0.9
              }
            : {
                type: "noul",
                noul: "assertions" in (req.state as object) ? final : reached
              }
        ])
      )
      return new Response(
        JSON.stringify({
          model: "jev-test",
          answers,
          usage: { input_tokens: 7, output_tokens: 0 }
        }),
        { headers: { "content-type": "application/json" } }
      )
    }
  })
  const wrapped: JevCall = (req, options) => {
    timeouts.push(options?.timeout)
    return jev(req, options)
  }
  const send = vi.fn(async (_req: ApiRequest) => reply({ token: "abc" }))
  const log: LogEntry[] = []
  return {
    states,
    timeouts,
    jev: wrapped,
    send,
    log,
    deps: { jev: wrapped, send, now, log }
  }
}

describe("runApiGoal", () => {
  it("chains responses into the next request and stops before sending on done", async () => {
    const h = harness(["login", "list", "done"])
    const record = await runApiGoal(input(), h.deps)
    expect(h.send).toHaveBeenCalledTimes(2)
    expect(h.send.mock.calls[1][0].url).toBe("https://api.test/items/abc")
    expect(record).toMatchObject({
      status: "pass",
      reason: "goal_reached",
      steps: [{ request: "login" }, { request: "list" }]
    })
    expect(h.timeouts.every((timeout) => timeout === 30_000)).toBe(true)
  })
  it("skips unresolved templates, records history and continues", async () => {
    const h = harness(["list", "login", "done"])
    const result = await runApiGoal(input(), h.deps)
    expect(h.send).toHaveBeenCalledTimes(1)
    expect(result.steps[0]).toMatchObject({
      status: null,
      note: "unresolved: {{steps.login.body.token}}"
    })
    expect(JSON.stringify(h.states[1])).toContain("unresolved:")
  })
  it("returns a record instead of throwing on a malformed request URL", async () => {
    const h = harness(["login"])
    const record = await runApiGoal(
      input({
        source: templateSource({
          login: { method: "GET", path: "https://[", headers: {} }
        })
      }),
      h.deps
    )
    expect(record).toMatchObject({
      status: "error",
      error: { errorClass: "TypeError" }
    })
    expect(h.send).not.toHaveBeenCalled()
  })
  it("rejects a resolved host without sending and still judges the finish", async () => {
    const h = harness(["list"])
    const record = await runApiGoal(
      input({
        source: templateSource({
          list: { method: "GET", path: "https://outside.test/", headers: {} }
        })
      }),
      h.deps
    )
    expect(h.send).not.toHaveBeenCalled()
    expect(record).toMatchObject({
      status: "stuck",
      reason: "host_not_allowed"
    })
    expect(record.reached).toBeTruthy()
  })
  it("passes a 302 without following it, using its response as last", async () => {
    const h = harness(["login", "done"])
    h.send.mockImplementation(async () => reply("redirect", 302))
    const record = await runApiGoal(input(), h.deps)
    expect(h.send).toHaveBeenCalledTimes(1)
    expect(record.steps[0]).toMatchObject({ status: 302 })
    expect(JSON.stringify(h.states[1])).toContain('"status":302')
  })
  it.each(["done", "stuck"])("does not send on %s", async (next) => {
    const h = harness([next])
    const result = await runApiGoal(input(), h.deps)
    expect(h.send).not.toHaveBeenCalled()
    expect(result.status).toBe(next === "stuck" ? "stuck" : "pass")
  })
  it("does not send when reached is satisfied", async () => {
    const h = harness(["login"], 0.9)
    expect((await runApiGoal(input(), h.deps)).steps).toHaveLength(0)
    expect(h.send).not.toHaveBeenCalled()
  })
  it("stops after three identical resolved actions", async () => {
    const h = harness(["login", "login", "login", "login"])
    const record = await runApiGoal(input(), h.deps)
    expect(record).toMatchObject({ status: "stuck", reason: "repeated_action" })
    expect(h.send).toHaveBeenCalledTimes(2)
  })
  it("stops at maxSteps", async () => {
    const h = harness(["login"])
    const record = await runApiGoal(input({ maxSteps: 1 }), h.deps)
    expect(record).toMatchObject({ status: "stuck", reason: "max_steps" })
  })
  it("continues after a failed request without leaking its error message", async () => {
    const h = harness(["login", "done"])
    h.send.mockRejectedValue(new Error("https://api.test/?token=s3cret-value"))
    const record = await runApiGoal(
      input({ inputs: { credential: "s3cret-value" } }),
      h.deps
    )
    expect(record.steps[0]).toMatchObject({
      status: null,
      note: "request_failed: HTTP request failed"
    })
    expect(JSON.stringify(h.states)).not.toContain("s3cret-value")
  })
  it("stops at maxSteps after an unresolved template", async () => {
    const h = harness(["list"])
    const record = await runApiGoal(input({ maxSteps: 1 }), h.deps)
    expect(record).toMatchObject({ status: "stuck", reason: "max_steps" })
    expect(h.send).not.toHaveBeenCalled()
  })
  it("returns an error record on Jev failure", async () => {
    const h = harness([])
    h.deps.jev = async () => {
      throw new TypeError("unavailable")
    }
    expect(await runApiGoal(input(), h.deps)).toMatchObject({
      status: "error",
      reason: "TypeError",
      error: { errorClass: "TypeError" }
    })
  })
  it("requires both reached and all assertions for pass", async () => {
    const h = harness(["done"], 0.1, 0.1)
    expect(await runApiGoal(input(), h.deps)).toMatchObject({
      status: "fail",
      reason: "assertion_failed"
    })
  })
  it("sanitizes secrets and records masked HTTP metadata with truncated body", async () => {
    const h = harness(["login", "done"])
    h.send.mockImplementation(async () => reply("x".repeat(200_000)))
    const record = await runApiGoal(
      input({
        inputs: { credential: "s3cret-value" },
        source: templateSource({
          login: {
            method: "POST",
            path: "/login?token={{inputs.credential}}",
            headers: { "X-Tenant": "{{inputs.credential}}" },
            body: { secret: "{{inputs.credential}}" }
          }
        })
      }),
      h.deps
    )
    expect(record.steps).toHaveLength(1)
    expect(JSON.stringify(h.states)).not.toContain("s3cret-value")
    expect(JSON.stringify(h.log)).not.toContain("s3cret-value")
    const http = h.log.find((entry) => entry.kind === "http")
    expect(http).toMatchObject({
      request: {
        url: "https://api.test/login?token=",
        headers: { "X-Tenant": "[redacted]" }
      },
      response: { truncated: true }
    })
    expect(JSON.stringify(http)).not.toContain('"body":"{')
  })
})

describe("RequestSource", () => {
  const list = {
    a: {
      method: "GET",
      path: "/a",
      summary: "read a",
      requiredParams: [],
      body: "none" as const
    },
    b: {
      method: "POST",
      path: "/b",
      requiredParams: ["id"],
      body: "json" as const
    }
  }
  const source = (build: RequestSource["build"]): RequestSource => ({
    stateKey: "operations",
    list,
    build
  })
  const built = () => ({
    ok: true as const,
    request: { method: "GET", url: "https://api.test/a/s3cret", headers: {} },
    inputHeaderNames: new Set<string>(),
    inputPathSegments: [2],
    values: [
      {
        target: "id",
        in: "path" as const,
        source: "input" as const,
        ref: "id",
        confidence: null
      }
    ],
    note: "filled",
    isDocumented: () => false
  })
  it("uses summary for choices, omits it from state, and passes dropSummary to every build", async () => {
    const h = harness(["a", "b", "done"])
    const questions: JevRequest[] = []
    const original = h.deps.jev
    h.deps.jev = (request, options) => {
      questions.push(request)
      return original(request, options)
    }
    const drops: boolean[] = []
    await runApiGoal(
      input({
        dropSummary: true,
        source: source(async (_name, ctx) => {
          drops.push(ctx.dropSummary)
          return { ok: false, skip: "skip" }
        })
      }),
      h.deps
    )
    expect(drops).toEqual([true, true])
    expect(questions[0].questions.next).toMatchObject({
      options: { a: "GET /a", b: "POST /b" }
    })
    expect(JSON.stringify(h.states[0])).not.toContain("read a")
    expect(
      (h.states[0] as { operations: typeof list }).operations.b.requiredParams
    ).toEqual(["id"])
    const kept = harness(["done"])
    const seen: JevRequest[] = []
    const originalKept = kept.deps.jev
    kept.deps.jev = (request, options) => {
      seen.push(request)
      return originalKept(request, options)
    }
    await runApiGoal(input({ source: source(async () => built()) }), kept.deps)
    expect(seen[0].questions.next).toMatchObject({
      options: { a: "read a", b: "POST /b" }
    })
  })
  it("skips without sending and passes the note through history", async () => {
    const h = harness(["a", "done"])
    const record = await runApiGoal(
      input({ source: source(async () => ({ ok: false, skip: "not ready" })) }),
      h.deps
    )
    expect(h.send).not.toHaveBeenCalled()
    expect(record.steps[0]).toMatchObject({ note: "not ready", status: null })
    expect(JSON.stringify(h.states[1])).toContain("not ready")
  })
  it("stops missing_input with a final judgment and a history note", async () => {
    const h = harness(["a"])
    const record = await runApiGoal(
      input({
        source: source(async () => ({
          ok: false,
          stuck: "missing_input",
          note: "id"
        }))
      }),
      h.deps
    )
    expect(h.send).not.toHaveBeenCalled()
    expect(record).toMatchObject({
      status: "stuck",
      reason: "missing_input",
      steps: [{ note: "id" }]
    })
    expect(record.reached).not.toBeNull()
    expect(JSON.stringify(h.states[1])).toContain("id")
  })
  it("returns a budget error record without final judgment", async () => {
    const h = harness(["a"])
    const record = await runApiGoal(
      input({
        source: source(async () => ({
          ok: false,
          kind: "budget_exceeded",
          message: "too many"
        }))
      }),
      h.deps
    )
    expect(record).toMatchObject({
      status: "error",
      reason: "budget_exceeded",
      error: {
        errorClass: "InitialBudgetExceeded",
        kind: "budget_exceeded",
        message: "too many"
      }
    })
    expect(record.reached).toBeNull()
    expect(h.states).toHaveLength(1)
    expect(h.send).not.toHaveBeenCalled()
  })
  it("records metadata and redacts only evidence, not the HTTP request", async () => {
    const h = harness(["a", "done"])
    const send = vi.fn(async (_request: ApiRequest) => reply({ id: 42 }))
    const record = await runApiGoal(
      input({ source: source(async () => built()) }),
      { ...h.deps, send }
    )
    expect(send.mock.calls[0][0].url).toContain("s3cret")
    expect(record.steps[0]).toMatchObject({
      url: "https://api.test/a/[redacted]",
      undocumented: true,
      note: "filled",
      values: [{ target: "id", ref: "id" }]
    })
    expect(h.log.find((entry) => entry.kind === "http")).toMatchObject({
      request: { url: "https://api.test/a/[redacted]" }
    })
    expect(
      (h.states[1] as { last: { undocumented: boolean } }).last.undocumented
    ).toBe(true)
  })
  it("counts a build Jev call in usage and provides the recent response", async () => {
    const h = harness(["a", "b", "done"])
    const recent: string[][] = []
    const record = await runApiGoal(
      input({
        source: source(async (_name, ctx, jev) => {
          recent.push(ctx.recent.map((entry) => entry.name))
          await jev(
            {
              state: {},
              questions: {
                fill: { type: "noul", instructions: "Choose a value." }
              }
            },
            { timeout: 30_000 }
          )
          return built()
        })
      }),
      h.deps
    )
    expect(recent).toEqual([[], ["a"]])
    expect(record.usage).toEqual({ requests: 6, inputTokens: 42 })
  })
  it("deduplicates and limits recent responses to five", () => {
    const entries = ["a", "b", "c", "d", "e", "f"].reduce(
      (recent, name) => pushRecent(recent, { name, response: reply(name) }),
      [] as Array<{ name: string; response: ApiResponse }>
    )
    expect(entries.map(({ name }) => name)).toEqual(["f", "e", "d", "c", "b"])
    expect(
      pushRecent(entries, { name: "c", response: reply(42) }).map(
        ({ name }) => name
      )
    ).toEqual(["c", "f", "e", "d", "b"])
  })
  it("checks all three dropSummary budget outcomes", () => {
    const small = input({ source: source(async () => built()) })
    expect(chooseDropSummary(small)).toEqual({ ok: true, dropSummary: false })
    const huge = input({
      source: {
        ...small.source,
        list: { a: { ...list.a, summary: "x".repeat(220_000) } }
      }
    })
    expect(chooseDropSummary(huge)).toEqual({ ok: true, dropSummary: true })
    expect(
      chooseDropSummary({ ...huge, goal: "y".repeat(220_000) })
    ).toMatchObject({ ok: false, message: expect.stringMatching(/1.*include/) })
  })
  it("redacts specified path segments and leaves query values for sanitizeUrl", () => {
    expect(redactPathSegments("https://h/api/v1/users/s3cret?x=1", [4])).toBe(
      "https://h/api/v1/users/[redacted]?x=1"
    )
  })
})

describe("BuildResult budget after sending", () => {
  it("keeps a completed HTTP step and returns the budget error without final judgment", async () => {
    const h = harness(["a", "a"])
    let calls = 0
    const source: RequestSource = {
      stateKey: "operations",
      list: {
        a: { method: "GET", path: "/a", requiredParams: [], body: "none" }
      },
      async build() {
        calls += 1
        return calls === 1
          ? {
              ok: true,
              request: {
                method: "GET",
                url: "https://api.test/a",
                headers: {}
              },
              inputHeaderNames: new Set<string>(),
              inputPathSegments: []
            }
          : {
              ok: false,
              kind: "budget_exceeded",
              message: "fill budget exceeded"
            }
      }
    }
    const record = await runApiGoal(input({ source }), h.deps)
    expect(h.send).toHaveBeenCalledTimes(1)
    expect(record).toMatchObject({
      status: "error",
      reason: "budget_exceeded",
      steps: [{ status: 200 }],
      error: {
        errorClass: "InitialBudgetExceeded",
        kind: "budget_exceeded",
        message: "fill budget exceeded"
      }
    })
    expect(record.reached).toBeNull()
    expect(h.states).toHaveLength(2)
  })
})
