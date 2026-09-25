import type { Questions, SystemOneResult } from "@typesafe-ai/sdk"
import { describe, expect, it } from "vitest"
import {
  buildTargets,
  collectLeaves,
  planFill,
  readPicks,
  type Target
} from "../fill.js"
import type { RecentResponse } from "../loop.js"
import {
  listOperations,
  type Operation,
  type OperationParam
} from "../openapi.js"

const param = (overrides: Partial<OperationParam> = {}): OperationParam => ({
  name: "id",
  in: "query",
  required: true,
  style: "form",
  explode: true,
  content: false,
  supported: true,
  types: ["string"],
  enum: null,
  examples: [],
  description: null,
  ...overrides
})

const operation = (overrides: Partial<Operation> = {}): Operation => ({
  name: "get_item",
  operationId: null,
  method: "GET",
  path: "/items/{id}",
  summary: "An item",
  description: "Read an item",
  tags: [],
  parameters: [],
  body: null,
  responses: [],
  security: null,
  servers: [],
  supported: true,
  ...overrides
})

const recent = (name: string, body: unknown): RecentResponse => ({
  name,
  response: {
    status: 200,
    headers: {},
    body,
    contentType: "application/json",
    bodyBytes: 0
  }
})

const targets = (
  op: Operation,
  inputs: Record<string, string> = {},
  responses: RecentResponse[] = []
) => {
  const result = buildTargets(op, inputs, responses)
  expect(result.ok).toBe(true)
  if (!result.ok) throw new Error(result.missing.join(", "))
  return result
}

const planned = (
  op: Operation,
  items: Target[],
  context: Partial<Parameters<typeof planFill>[2]> = {}
) =>
  planFill(op, items, {
    goal: "Find an item",
    step: 1,
    history: [],
    inputKeys: [],
    dropSummary: false,
    ...context
  })

describe("collectLeaves", () => {
  it("collects primitive JSON leaves, omitting null and stopping at depth six", () => {
    const leaves = collectLeaves([
      recent("x", {
        a: { b: { c: { d: { e: "five", f: { g: "seven" } } } } },
        deep: { a: { b: { c: { d: { e: 6 } } } } },
        flag: false,
        nil: null
      })
    ])
    expect(leaves.map(({ path }) => path)).toContain("steps.x.body.a.b.c.d.e")
    expect(leaves.map(({ path }) => path)).toContain(
      "steps.x.body.deep.a.b.c.d.e"
    )
    expect(leaves.map(({ path }) => path)).not.toContain(
      "steps.x.body.a.b.c.d.e.f.g"
    )
    expect(leaves.map(({ path, value }) => [path, value])).toContainEqual([
      "steps.x.body.flag",
      false
    ])
    expect(leaves.some((leaf) => leaf.value === null)).toBe(false)
  })

  it("uses numeric path components and traverses at most twenty array elements", () => {
    const leaves = collectLeaves([
      recent("list", { items: Array.from({ length: 21 }, (_, id) => ({ id })) })
    ])
    expect(leaves.map(({ path }) => path)).toContain(
      "steps.list.body.items.0.id"
    )
    expect(leaves.map(({ path }) => path)).toContain(
      "steps.list.body.items.19.id"
    )
    expect(leaves.map(({ path }) => path)).not.toContain(
      "steps.list.body.items.20.id"
    )
  })

  it("takes no more than 200 leaves per response", () => {
    const leaves = collectLeaves([
      recent(
        "many",
        Object.fromEntries(Array.from({ length: 201 }, (_, i) => [`k${i}`, i]))
      )
    ])
    expect(leaves).toHaveLength(200)
    expect(leaves.at(-1)?.path).toBe("steps.many.body.k199")
  })
})

describe("buildTargets", () => {
  it("orders inputs, spec values and omit, with newer matching leaves before other leaves", () => {
    const field = param({
      required: false,
      examples: ["example"],
      default: "default",
      enum: ["enum"]
    })
    const op = operation({ parameters: [field] })
    const responses = [
      recent("new", { id: "new-id", elsewhere: "new-other" }),
      recent("old", { id: "old-id", elsewhere: "old-other" })
    ]
    const withEnum = targets(op, { token: "secret" }, responses)
    expect(
      withEnum.targets[0]?.candidates.map(({ source, ref }) => [source, ref])
    ).toEqual([
      ["input", "token"],
      ["spec", "example[0]"],
      ["spec", "default"],
      ["spec", "enum[0]"],
      ["omit", null]
    ])
    const withoutEnum = targets(
      operation({ parameters: [{ ...field, enum: null }] }),
      { token: "secret" },
      responses
    )
    expect(
      withoutEnum.targets[0]?.candidates.map(({ source, ref }) => [source, ref])
    ).toEqual([
      ["input", "token"],
      ["spec", "example[0]"],
      ["spec", "default"],
      ["response", "steps.new.body.id"],
      ["response", "steps.old.body.id"],
      ["response", "steps.new.body.elsewhere"],
      ["response", "steps.old.body.elsewhere"],
      ["omit", null]
    ])
    expect(withEnum.targets[0]?.candidates[0]).toMatchObject({
      value: undefined,
      description: 'input "token"'
    })
  })

  it("selects leaves by integer, untyped and array types and by enum", () => {
    const leaves = [recent("x", { id: 1.5, other: 2, flag: true, text: "c" })]
    const candidates = (field: OperationParam) =>
      targets(
        operation({ parameters: [{ ...field, required: false }] }),
        {},
        leaves
      ).targets[0]?.candidates ?? []
    expect(
      candidates(param({ types: ["integer"] }))
        .filter((c) => c.source === "response")
        .map((c) => c.value)
    ).toEqual([2])
    expect(
      candidates(param({ types: null }))
        .filter((c) => c.source === "response")
        .map((c) => c.value)
    ).toEqual([1.5, 2, true, "c"])
    expect(
      candidates(param({ types: ["array"] })).filter(
        (c) => c.source === "response"
      )
    ).toEqual([])
    expect(
      candidates(param({ types: ["string"], enum: ["a", "b"] })).filter(
        (c) => c.source === "response"
      )
    ).toEqual([])
  })

  it("deduplicates spec values and excludes leaves equal to spec values", () => {
    const result = targets(
      operation({
        parameters: [
          param({ examples: ["a", "a"], default: "a", enum: ["a", "b"] })
        ]
      }),
      {},
      [recent("x", { id: "a", other: "b", fresh: "c" })]
    )
    expect(result.targets[0]?.candidates.map((c) => c.ref)).toEqual([
      "example[0]",
      "enum[1]"
    ])
    const noEnum = targets(
      operation({
        parameters: [param({ examples: ["a", "a"], default: "a", enum: null })]
      }),
      {},
      [recent("x", { id: "a", other: "b" })]
    )
    expect(noEnum.targets[0]?.candidates.map((c) => c.ref)).toEqual([
      "example[0]",
      "steps.x.body.other"
    ])
  })

  it("trims an old unmatched leaf first at the 255-candidate boundary", () => {
    const result = targets(
      operation({ parameters: [param({ types: ["number"] })] }),
      {},
      [
        recent("new", { id: 999 }),
        recent(
          "old",
          Object.fromEntries(
            Array.from({ length: 200 }, (_, i) => [`other${i}`, i])
          )
        ),
        recent(
          "older",
          Object.fromEntries(
            Array.from({ length: 55 }, (_, i) => [`old${i}`, i + 200])
          )
        )
      ]
    )
    const candidates = result.targets[0]?.candidates ?? []
    expect(candidates).toHaveLength(255)
    expect(candidates[0]?.ref).toBe("steps.new.body.id")
    expect(candidates.some((c) => c.ref === "steps.older.body.old53")).toBe(
      true
    )
    expect(candidates.some((c) => c.ref === "steps.older.body.old54")).toBe(
      false
    )
  })

  it("drops spec values from the end after leaves have run out", () => {
    const inputs = Object.fromEntries(
      Array.from({ length: 253 }, (_, i) => [`k${i}`, "v"])
    )
    const result = targets(
      operation({
        parameters: [param({ required: false, examples: ["first", "last"] })]
      }),
      inputs
    )
    expect(result.targets[0]?.candidates).toHaveLength(255)
    expect(
      result.targets[0]?.candidates
        .filter((c) => c.source === "spec")
        .map((c) => c.value)
    ).toEqual(["first"])
    expect(result.targets[0]?.candidates.at(-1)?.source).toBe("omit")
  })

  it("allows objects only for exploded form query and arrays only for array types", () => {
    const example = { a: 1 }
    const options = { examples: [example, [1, 2]], types: ["object", "array"] }
    expect(
      targets(
        operation({ parameters: [param({ ...options })] })
      ).targets[0]?.candidates.map((c) => c.value)
    ).toEqual([example, [1, 2]])
    expect(
      targets(
        operation({ parameters: [param({ ...options, in: "path" })] })
      ).targets[0]?.candidates.map((c) => c.value)
    ).toEqual([[1, 2]])
    expect(
      targets(
        operation({ parameters: [param({ ...options, explode: false })] })
      ).targets[0]?.candidates.map((c) => c.value)
    ).toEqual([[1, 2]])
  })

  it("puts omit at the end only for optional fields and never for a 3.0 path parameter", () => {
    const result = targets(
      operation({
        parameters: [
          param({ name: "optional", required: false }),
          param({ name: "id", in: "path", required: true })
        ]
      }),
      { key: "v" }
    )
    expect(result.targets[0]?.candidates.at(-1)?.source).toBe("omit")
    expect(result.targets[1]?.candidates.some((c) => c.source === "omit")).toBe(
      false
    )
  })

  it("keeps omit off a 3.0 path parameter without a required property", () => {
    const result = listOperations(
      {
        doc: {
          openapi: "3.0.3",
          paths: {
            "/items/{id}": {
              get: {
                parameters: [
                  { name: "id", in: "path", schema: { type: "integer" } }
                ],
                responses: { "200": { description: "ok" } }
              }
            }
          }
        },
        openapi: "3.0.3",
        schemes: {},
        source: { kind: "file", location: "spec.json" }
      },
      undefined,
      253
    )
    expect(result.ok).toBe(true)
    if (!result.ok) return
    const op = result.operations[0]
    expect(op?.parameters[0]?.required).toBe(true)
    if (!op) throw new Error("Missing operation")
    const built = targets(op, { id: "7" })
    expect(built.targets[0]?.candidates.some((c) => c.source === "omit")).toBe(
      false
    )
  })

  it("reports all missing required targets in order without joining them", () => {
    const result = buildTargets(
      operation({
        parameters: [param({ in: "path" })],
        body: {
          required: true,
          json: true,
          contentTypes: ["application/json"],
          examples: [],
          description: null
        }
      }),
      {},
      []
    )
    expect(result).toEqual({ ok: false, missing: ["id", "body"] })
  })

  it("accepts JSON objects and arrays from inputs for body, but not scalars or malformed JSON", () => {
    const result = targets(
      operation({
        body: {
          required: false,
          json: true,
          contentTypes: ["application/json"],
          examples: [],
          description: null
        }
      }),
      { obj: '{"a":1}', arr: "[1,2]", scalar: '"x"', bad: "{broken" }
    )
    expect(result.targets[0]?.candidates.map((c) => c.ref)).toEqual([
      "obj",
      "arr",
      null
    ])
    expect(result.targets[0]?.candidates[0]?.value).toBeUndefined()
  })

  it("skips unsupported optional parameters and unsupported bodies with separate notes", () => {
    const result = targets(
      operation({
        parameters: [param({ supported: false, required: false })],
        body: {
          required: true,
          json: false,
          contentTypes: ["text/plain"],
          examples: [],
          description: null
        }
      })
    )
    expect(result).toEqual({
      ok: true,
      targets: [],
      notes: ["style_unsupported", "body_unsupported"]
    })
  })

  it("numbers remaining targets consecutively after an unsupported optional parameter", () => {
    const result = targets(
      operation({
        parameters: [
          param({ name: "skipped", required: false, supported: false }),
          param({ name: "kept", examples: ["example"] })
        ]
      })
    )
    expect(result.targets.map((target) => target.key)).toEqual(["p1"])
    expect(result.notes).toEqual(["style_unsupported"])
  })

  it("returns no candidates or values for an operation without parameters or body", () => {
    const op = operation()
    const result = targets(op)
    expect(result.targets).toEqual([])
    const plan = planned(op, result.targets)
    expect(plan).toMatchObject({ ok: true, request: null })
    expect(readPicks(result.targets, null)).toEqual({
      picks: new Map(),
      values: []
    })
  })
})

describe("planFill and readPicks", () => {
  it("omits single-candidate targets from questions and records a null confidence", () => {
    const op = operation({ parameters: [param()] })
    const items = targets(op, { token: "secret" }).targets
    expect(planned(op, items)).toMatchObject({ ok: true, request: null })
    expect(readPicks(items, null)).toEqual({
      picks: new Map([
        [
          "p1",
          {
            target: items[0],
            candidate: items[0]?.candidates[0],
            confidence: null
          }
        ]
      ]),
      values: [
        {
          target: "id",
          in: "query",
          source: "input",
          ref: "token",
          confidence: null
        }
      ]
    })
  })

  it("builds keyed state and choice questions for parameter and body targets", () => {
    const op = operation({
      parameters: [
        param({ name: "x", examples: ["a", "b"], description: "First" }),
        param({ name: "x", in: "header", examples: ["c", "d"] })
      ],
      body: {
        required: true,
        json: true,
        contentTypes: ["application/json"],
        examples: [{ a: 1 }, { b: 2 }],
        description: "The body"
      }
    })
    const items = targets(op).targets
    const plan = planned(op, items)
    expect(plan.ok).toBe(true)
    if (!plan.ok || !plan.request) throw new Error("Expected questions")
    const state = plan.request.state as {
      operation: { targets: Record<string, unknown>; summary?: string }
    }
    expect(Object.keys(state.operation.targets)).toEqual(["p1", "p2", "body"])
    expect(state.operation.targets.p1).toMatchObject({
      name: "x",
      in: "query",
      required: true,
      types: ["string"],
      description: "First"
    })
    expect(state.operation.targets.body).toMatchObject({
      required: true,
      description: "The body"
    })
    expect(Object.keys(plan.request.questions)).toEqual(["p1", "p2", "body"])
    expect(plan.request.questions.p2).toMatchObject({
      type: "choice",
      options: { c1: expect.any(String), c2: expect.any(String) }
    })
    expect(plan.request.questions.p2?.instructions).toContain(
      'state.operation.targets["p2"]'
    )
  })

  it("does not expose input values and truncates spec descriptions to 40 characters", () => {
    const op = operation({
      parameters: [param({ examples: ["x".repeat(41)] })]
    })
    const items = targets(op, { token: "secret-marker" }).targets
    const plan = planned(op, items, { dropSummary: true, inputKeys: ["token"] })
    expect(plan.ok).toBe(true)
    if (!plan.ok || !plan.request) throw new Error("Expected a question")
    expect(JSON.stringify(plan.request)).not.toContain("secret-marker")
    expect(plan.request.questions.p1).toMatchObject({
      options: {
        c1: 'input "token"',
        c2: `spec example[0]: ${`"${"x".repeat(39)}`}…`
      }
    })
    const state = plan.request.state as {
      operation: { targets: Record<string, unknown>; summary?: string }
    }
    expect(state.operation.summary).toBeUndefined()
    expect(state.operation.targets.p1).not.toHaveProperty("description")
  })

  it("uses c1 and omit for an optional field and maps the returned choice to the target key", () => {
    const op = operation({ parameters: [param({ required: false })] })
    const items = targets(op, { key: "secret" }).targets
    const plan = planned(op, items)
    expect(plan.ok).toBe(true)
    if (!plan.ok || !plan.request) throw new Error("Expected choices")
    expect(plan.request.questions.p1).toMatchObject({
      options: { c1: 'input "key"', omit: "leave this part out" }
    })
    const result = {
      answers: { p1: { type: "choice", choice: "omit", confidence: 0.8 } }
    } as unknown as SystemOneResult<Questions>
    expect(readPicks(items, result)).toEqual({
      picks: new Map([
        [
          "p1",
          {
            target: items[0],
            candidate: items[0]?.candidates[1],
            confidence: 0.8
          }
        ]
      ]),
      values: [
        {
          target: "id",
          in: "query",
          source: "omit",
          ref: null,
          confidence: 0.8
        }
      ]
    })
  })

  it("returns budget_exceeded after all response leaves are removed", () => {
    const op = operation({
      parameters: [param({ name: "first" }), param({ name: "second" })]
    })
    const items = targets(op, { a: "secret", b: "secret" }, [
      recent("x", { data: "leaf" })
    ]).targets
    const result = planned(op, items, {
      history: [{ data: "h".repeat(120_000) }]
    })
    expect(result).toMatchObject({
      ok: false,
      kind: "budget_exceeded",
      message: expect.stringContaining("get_item")
    })
    expect(items[0]?.candidates).toHaveLength(3)
  })

  it("drops leaves from the target with the most candidates first", () => {
    const op = operation({
      parameters: [
        param({ name: "first", examples: ["spec"] }),
        param({ name: "second" })
      ]
    })
    const items = targets(op, { a: "secret", b: "secret" }, [
      recent("x", { data: "leaf" })
    ]).targets
    let lo = 0
    let hi = 100_000
    while (lo < hi) {
      const mid = Math.floor((lo + hi) / 2)
      const result = planned(op, items, {
        history: [{ data: "h".repeat(mid) }]
      })
      if (
        result.ok &&
        result.targets.every(
          (target, i) =>
            target.candidates.length === items[i]?.candidates.length
        )
      )
        lo = mid + 1
      else hi = mid
    }
    const result = planned(op, items, { history: [{ data: "h".repeat(lo) }] })
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.targets[0]?.candidates).toHaveLength(
      (items[0]?.candidates.length ?? 0) - 1
    )
    expect(result.targets[1]?.candidates).toHaveLength(
      items[1]?.candidates.length ?? 0
    )
  })
})
