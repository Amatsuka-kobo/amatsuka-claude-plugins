import { describe, expect, it, vi } from "vitest"
import type { LogEntry } from "../../evidence.js"
import {
  createJevCall,
  type JevCall,
  type JevRequest
} from "../../jev/client.js"
import type { BrowserGoalInput } from "../loop.js"
import { runBrowserGoal } from "../loop.js"
import { fakeDriver } from "./helpers/fakeDriver.js"

const now = () => new Date("2026-09-25T00:00:00.000Z")
const input = (extra: Partial<BrowserGoalInput> = {}): BrowserGoalInput => ({
  url: "https://example.test/start?token=secret-query",
  goal: "Submit the form",
  assertions: ["Form submitted"],
  inputs: {},
  maxSteps: 5,
  thresholds: { satisfied: 0.8, unsatisfied: 0.2 },
  name: "form",
  screenshots: false,
  evidenceDir: null,
  ...extra
})
function harness(
  choices: string[],
  options: {
    reached?: number
    final?: number
    assertions?: number
    value?: string
    errorAt?: number
    snapshots?: string[]
  } = {}
) {
  const requests: JevRequest[] = []
  const timeouts: (number | undefined)[] = []
  let calls = 0
  const jev = createJevCall({
    apiKey: "test",
    fetch: async (_url, init) => {
      const request = JSON.parse(String(init?.body)) as JevRequest
      requests.push(request)
      calls++
      if (options.errorAt === calls) throw new TypeError("Jev broke")
      const final = "assertions" in (request.state as object)
      const answers = Object.fromEntries(
        Object.keys(request.questions).map((key) => [
          key,
          key === "next" || key === "value" || key === "option"
            ? {
                type: "choice",
                choice:
                  key === "next"
                    ? (choices.shift() ?? "done")
                    : (options.value ?? "none"),
                confidence: 0.9
              }
            : {
                type: "noul",
                noul: final
                  ? key === "reached"
                    ? (options.final ?? 0.9)
                    : (options.assertions ?? 0.9)
                  : (options.reached ?? 0.1)
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
  const wrapped: JevCall = (request, callOptions) => {
    timeouts.push(callOptions?.timeout)
    return jev(request, callOptions)
  }
  const log: LogEntry[] = []
  return {
    requests,
    timeouts,
    jev: wrapped,
    log,
    deps: { jev: wrapped, now, log }
  }
}

describe("runBrowserGoal", () => {
  it.each([
    ["done", 0.1],
    ["a1", 0.9]
  ] as const)("does not act when %s or reached ends a step", async (choice, reached) => {
    const h = harness([choice], { reached })
    const driver = fakeDriver()
    const { record } = await runBrowserGoal(input(), { ...h.deps, driver })
    expect(driver.act).not.toHaveBeenCalled()
    expect(record.status).toBe("pass")
    expect(record.reached?.verdict).toBe("satisfied")
  })
  it("chooses stuck without acting but still runs a final judgment", async () => {
    const h = harness(["stuck"]),
      driver = fakeDriver()
    const { record } = await runBrowserGoal(input(), { ...h.deps, driver })
    expect(record).toMatchObject({
      status: "stuck",
      reason: "chose_stuck",
      reached: { verdict: "satisfied" }
    })
    expect(driver.act).not.toHaveBeenCalled()
    expect(h.requests).toHaveLength(2)
  })
  it("stops on the third identical action, including failed actions", async () => {
    const h = harness(["a1", "a1", "a1"]),
      driver = fakeDriver({ actError: new Error("not attached\nstack") })
    const { record } = await runBrowserGoal(input(), { ...h.deps, driver })
    expect(record).toMatchObject({ status: "stuck", reason: "repeated_action" })
    expect(driver.act).toHaveBeenCalledTimes(2)
    expect(record.steps[0]).toMatchObject({
      action: "none",
      note: "action_failed: not attached"
    })
    expect(h.requests[1].state).toMatchObject({
      history: [{ note: "action_failed: not attached" }]
    })
  })
  it("stops at maxSteps and judges the final state", async () => {
    const h = harness(["a1"]),
      driver = fakeDriver()
    const { record } = await runBrowserGoal(input({ maxSteps: 1 }), {
      ...h.deps,
      driver
    })
    expect(record).toMatchObject({ status: "stuck", reason: "max_steps" })
    expect(h.requests).toHaveLength(2)
  })
  it.each([
    "https://outside.test/",
    "https://example.test/"
  ])("detects blocked navigation: %s", async (url) => {
    const h = harness(["a1"]),
      driver = fakeDriver({
        blocked: url === "https://outside.test/" ? url : null,
        url
      })
    const { record } = await runBrowserGoal(input({ maxSteps: 1 }), {
      ...h.deps,
      driver
    })
    expect(record.reason).toBe(
      url.includes("outside") ? "host_not_allowed" : "max_steps"
    )
  })
  it("selects an input key, or fills an empty value for none", async () => {
    for (const value of ["email", "none"]) {
      const h = harness(["a1", "done"], { value })
      const driver = fakeDriver({ nodes: [{ role: "textbox", name: "Email" }] })
      const { record } = await runBrowserGoal(
        input({ inputs: { email: "private-password" } }),
        { ...h.deps, driver }
      )
      expect(h.requests[1].questions.value).toMatchObject({
        criteria: { email: expect.any(String), none: expect.any(String) }
      })
      expect(driver.act).toHaveBeenCalledWith(
        expect.objectContaining({
          kind: "fill",
          value: value === "none" ? "" : "private-password"
        })
      )
      expect(record.steps[0]).toMatchObject({ input: value })
    }
  })
  it("chooses option labels for select and clicks checkbox and radio", async () => {
    const h = harness(["a1", "done"], { value: "o1" }),
      driver = fakeDriver({ nodes: [{ role: "combobox", name: "Color" }] })
    vi.mocked(driver.selectOptions).mockResolvedValue(["Red", "Blue"])
    await runBrowserGoal(input(), { ...h.deps, driver })
    expect(h.requests[1].questions.option).toMatchObject({
      criteria: { o1: "Red", o2: "Blue" }
    })
    expect(driver.act).toHaveBeenCalledWith(
      expect.objectContaining({ kind: "select", value: "Red" })
    )
    for (const role of ["checkbox", "radio"]) {
      const judge = harness(["a1", "done"]),
        d = fakeDriver({ nodes: [{ role, name: "Yes" }] })
      await runBrowserGoal(input(), { ...judge.deps, driver: d })
      expect(d.act).toHaveBeenCalledWith(
        expect.objectContaining({ kind: "click" })
      )
      expect(judge.requests).toHaveLength(3)
    }
  })
  it("returns error records on Jev, observe, and final-judgment failures", async () => {
    for (const failure of ["jev", "observe", "final"] as const) {
      const h = harness(failure === "final" ? ["stuck"] : ["a1"], {
        errorAt: failure === "jev" ? 1 : failure === "final" ? 2 : undefined
      })
      const driver = fakeDriver({
        observeError:
          failure === "observe" ? new RangeError("observe failed") : undefined
      })
      if (failure !== "observe") {
        let call = 0
        const original = h.deps.jev
        h.deps.jev = (req, options) =>
          ++call === (failure === "jev" ? 1 : 2)
            ? Promise.reject(new TypeError("Jev broke"))
            : original(req, options)
      }
      const { record, files } = await runBrowserGoal(
        input({ evidenceDir: "/tmp/evidence" }),
        { ...h.deps, driver }
      )
      expect(record).toMatchObject({
        status: "error",
        reached: null,
        assertions: []
      })
      expect(record.error?.errorClass).toBe(
        failure === "observe" ? "RangeError" : "TypeError"
      )
      expect(files).toEqual(["final.png", "trace.zip"])
      if (failure === "final") expect(record.reason).toBe("TypeError")
    }
  })
  it("fails if any assertion is unsatisfied and passes when all are satisfied", async () => {
    for (const probability of [0.1, 0.9]) {
      const h = harness(["done"], { assertions: probability })
      const { record } = await runBrowserGoal(input(), {
        ...h.deps,
        driver: fakeDriver()
      })
      expect(record.status).toBe(probability === 0.9 ? "pass" : "fail")
    }
  })
  it("takes step screenshots only when enabled, and keeps the last ten history entries", async () => {
    const h = harness(Array(12).fill("a1")),
      driver = fakeDriver({
        nodes: Array.from({ length: 12 }, (_, index) => ({
          role: "button",
          name: `Item ${index + 1}`
        }))
      })
    const choices = Array.from({ length: 12 }, (_, i) => `a${i + 1}`)
    const many = harness(choices)
    const result = await runBrowserGoal(
      input({ screenshots: true, evidenceDir: "/tmp/evidence", maxSteps: 12 }),
      { ...many.deps, driver }
    )
    expect(driver.screenshot).toHaveBeenCalledTimes(12)
    expect(result.record.steps[0]).toMatchObject({ screenshot: "step-1.png" })
    expect(
      (many.requests[11].state as { history: unknown[] }).history
    ).toHaveLength(10)
    const none = fakeDriver(),
      j = harness(["a1", "done"])
    await runBrowserGoal(input(), { ...j.deps, driver: none })
    expect(none.screenshot).not.toHaveBeenCalled()
    expect(h.requests).toHaveLength(0)
  })
  it("uses a 30-second Jev timeout and omits input values and URL query tokens from all states (F4)", async () => {
    const h = harness(["a1", "done"], { value: "password" }),
      driver = fakeDriver({ nodes: [{ role: "textbox", name: "Password" }] })
    await runBrowserGoal(input({ inputs: { password: "secret-input" } }), {
      ...h.deps,
      driver
    })
    expect(h.timeouts).toEqual([30000, 30000, 30000, 30000])
    for (const req of h.requests) {
      const state = JSON.stringify(req.state)
      expect(state).not.toContain("secret-input")
      expect(state).not.toContain("secret-query")
    }
  })
})

describe("browser interruption history", () => {
  it("stores observed notes with the action history and combines an action failure", async () => {
    const h = harness(["a1", "done"])
    const driver = fakeDriver({
      notes: [[], ["dialog dismissed: confirm", "popup closed"]],
      actError: new Error("detached")
    })
    const { record } = await runBrowserGoal(input(), { ...h.deps, driver })
    expect(record.steps[0]).toMatchObject({
      note: "action_failed: detached; dialog dismissed: confirm; popup closed"
    })
    expect(h.requests[1].state).toMatchObject({
      history: [
        {
          note: "action_failed: detached; dialog dismissed: confirm; popup closed"
        }
      ]
    })
    expect(driver.observe).toHaveBeenCalledTimes(3)
  })
})
