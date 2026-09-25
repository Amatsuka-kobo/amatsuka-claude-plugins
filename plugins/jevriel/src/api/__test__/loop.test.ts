import { describe, expect, it, vi } from "vitest"
import type { LogEntry } from "../../evidence.js"
import {
  createJevCall,
  type JevCall,
  type JevRequest
} from "../../jev/client.js"
import type { ApiRequest, ApiResponse } from "../http.js"
import { type ApiGoalInput, runApiGoal } from "../loop.js"

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
  requests: {
    login: { method: "POST", path: "/login", headers: {} },
    list: {
      method: "GET",
      path: "/items/{{steps.login.body.token}}",
      headers: {}
    }
  },
  assertions: ["the goal is met"],
  inputs: {},
  maxSteps: 5,
  allowedHosts: ["api.test"],
  timeoutMs: 30000,
  thresholds: { satisfied: 0.8, unsatisfied: 0.2 },
  name: "api-test",
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
        requests: { login: { method: "GET", path: "https://[", headers: {} } }
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
        requests: {
          list: { method: "GET", path: "https://outside.test/", headers: {} }
        }
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
        requests: {
          login: {
            method: "POST",
            path: "/login?token={{inputs.credential}}",
            headers: { "X-Tenant": "{{inputs.credential}}" },
            body: { secret: "{{inputs.credential}}" }
          }
        }
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
