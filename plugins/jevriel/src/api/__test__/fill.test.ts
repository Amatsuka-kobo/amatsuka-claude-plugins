import type { Questions, SystemOneResult } from "@typesafe-ai/sdk"
import { describe, expect, it, vi } from "vitest"
import { createJevCall } from "../../jev/client.js"
import {
  applyAuth,
  assembleRequest,
  buildTargets,
  collectLeaves,
  isDocumented,
  planFill,
  readPicks,
  selectSecurity,
  serializeParam,
  specSource,
  type Target
} from "../fill.js"
import type { RecentResponse } from "../loop.js"
import {
  type LoadedSpec,
  listOperations,
  type Operation,
  type OperationParam,
  type SecurityScheme
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
        a: { b: { c: { d: { e: "five" } } } },
        deep: { a: { b: { c: { d: { e: 6 } } } } },
        deeper: { a: { b: { c: { d: { e: { f: "seven" } } } } } },
        flag: false,
        nil: null
      })
    ])
    expect(leaves.map(({ path }) => path)).toContain("steps.x.body.a.b.c.d.e")
    expect(leaves.map(({ path }) => path)).toContain(
      "steps.x.body.deep.a.b.c.d.e"
    )
    expect(leaves.map(({ path }) => path)).not.toContain(
      "steps.x.body.deeper.a.b.c.d.e.f"
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

const assemble = (
  op: Operation,
  candidates: Array<{
    source: "input" | "spec" | "response" | "omit"
    ref?: string | null
    value?: unknown
  }>,
  options: Partial<
    Omit<Parameters<typeof assembleRequest>[0], "op" | "targets" | "picks">
  > = {}
) => {
  const items: Target[] = [
    ...op.parameters.map(
      (p, index): Target => ({
        key: `p${index + 1}`,
        name: p.name,
        in: p.in,
        required: p.required,
        param: p,
        candidates: []
      })
    ),
    ...(op.body
      ? [
          {
            key: "body",
            name: "body",
            in: "body" as const,
            required: op.body.required,
            param: null,
            candidates: []
          }
        ]
      : [])
  ]
  const picks = new Map(
    items.map(
      (target, index) =>
        [
          target.key,
          {
            target,
            candidate: {
              source: candidates[index]?.source ?? "omit",
              ref: candidates[index]?.ref ?? null,
              value: candidates[index]?.value,
              description: ""
            },
            confidence: null
          }
        ] as const
    )
  )
  return assembleRequest({
    op,
    baseUrl: "http://h/api/v1",
    targets: items,
    picks,
    inputs: {},
    steps: {},
    schemes: {},
    headers: {},
    ...options
  })
}

const schemes: Record<string, SecurityScheme> = {
  bearer: { name: "bearer", type: "http", scheme: "bearer" },
  basic: { name: "basic", type: "http", scheme: "basic" },
  headerKey: {
    name: "headerKey",
    type: "apiKey",
    in: "header",
    paramName: "X-API-Key"
  },
  queryKey: {
    name: "queryKey",
    type: "apiKey",
    in: "query",
    paramName: "token"
  },
  oauth: { name: "oauth", type: "unsupported" }
}

describe("serializeParam", () => {
  it("encodes a path scalar and encodes each path array element separately", () => {
    expect(
      serializeParam(
        param({ in: "path", style: "simple", explode: false }),
        "a/b c"
      )
    ).toEqual({ ok: true, text: "a%2Fb%20c" })
    expect(
      serializeParam(param({ in: "path", style: "simple", explode: false }), [
        "a/b",
        "c"
      ])
    ).toEqual({ ok: true, text: "a%2Fb,c" })
  })

  it("repeats exploded query arrays and joins non-exploded arrays", () => {
    expect(serializeParam(param({ name: "tag" }), ["a", "b"])).toEqual({
      ok: true,
      pairs: [
        ["tag", "a"],
        ["tag", "b"]
      ]
    })
    expect(
      serializeParam(param({ name: "tag", explode: false }), ["a", "b"])
    ).toEqual({ ok: true, pairs: [["tag", "a,b"]] })
  })

  it("expands form objects into separate query keys", () => {
    expect(serializeParam(param(), { x: 1, y: "z" })).toEqual({
      ok: true,
      pairs: [
        ["x", "1"],
        ["y", "z"]
      ]
    })
  })

  it("joins header arrays and JSON-serializes content parameters", () => {
    expect(
      serializeParam(param({ in: "header", style: "simple", explode: false }), [
        "a",
        "b"
      ])
    ).toEqual({ ok: true, text: "a,b" })
    expect(serializeParam(param({ content: true }), { a: 1 })).toEqual({
      ok: true,
      pairs: [["id", '{"a":1}']]
    })
  })

  it("rejects unsupported styles and objects outside exploded form query", () => {
    expect(
      serializeParam(
        param({ in: "query", style: "deepObject", supported: false }),
        "x"
      )
    ).toEqual({ ok: false })
    for (const p of [
      param({ in: "query", explode: false }),
      param({ in: "path", style: "simple", explode: false }),
      param({ in: "header", style: "simple", explode: false })
    ]) {
      const result = serializeParam(p, { a: 1 })
      expect(result).toEqual({ ok: false })
      expect(JSON.stringify(result)).not.toContain('{\\"a\\":1}')
    }
  })
})

describe("assembleRequest", () => {
  it.each([
    "http://localhost:3000/api/v1",
    "http://localhost:3000/api/v1/"
  ])("preserves a base URL path with or without trailing slash: %s", (baseUrl) => {
    const op = operation({
      path: "/users/{id}",
      parameters: [param({ in: "path", style: "simple", explode: false })]
    })
    const result = assemble(op, [{ source: "spec", value: "7" }], { baseUrl })
    expect(result.ok && result.request.url).toBe(
      "http://localhost:3000/api/v1/users/7"
    )
  })

  it("encodes path values without splitting an encoded slash into new segments", () => {
    const op = operation({
      path: "/users/{id}",
      parameters: [param({ in: "path", style: "simple", explode: false })]
    })
    const scalar = assemble(op, [{ source: "input", ref: "id" }], {
      inputs: { id: "a/b c" }
    })
    expect(scalar.ok && scalar.request.url).toBe(
      "http://h/api/v1/users/a%2Fb%20c"
    )
    expect(scalar.ok && scalar.inputPathSegments).toEqual([4])
    const array = assemble(op, [{ source: "spec", value: ["a/b", "c"] }])
    expect(array.ok && array.request.url).toBe("http://h/api/v1/users/a%2Fb,c")
  })

  it.each([
    ".",
    ".."
  ])("returns skip instead of a foldable path value from an input: %s", (value) => {
    const op = operation({
      path: "/users/{id}",
      parameters: [param({ in: "path", style: "simple", explode: false })]
    })
    const result = assemble(op, [{ source: "input", ref: "id" }], {
      inputs: { id: value }
    })
    expect(result).toEqual({ ok: false, skip: "unsafe_path: id" })
  })

  it("places a path input at the final URL segment index but does not mask a spec value", () => {
    const op = operation({
      path: "/users/{id}/posts/{pid}",
      parameters: [
        param({ in: "path", style: "simple", explode: false }),
        param({ name: "pid", in: "path", style: "simple", explode: false })
      ]
    })
    const result = assemble(
      op,
      [
        { source: "input", ref: "id" },
        { source: "spec", value: "9" }
      ],
      {
        inputs: { id: "7" }
      }
    )
    expect(result.ok && result.request.url).toBe(
      "http://h/api/v1/users/7/posts/9"
    )
    expect(result.ok && result.inputPathSegments).toEqual([4])
    const withoutInput = assemble(op, [
      { source: "spec", value: "7" },
      { source: "spec", value: "9" }
    ])
    expect(withoutInput.ok && withoutInput.inputPathSegments).toEqual([])
  })

  it("assembles query repetitions, non-exploded arrays, form objects and header arrays", () => {
    const op = operation({
      path: "/items",
      parameters: [
        param({ name: "tag", required: false }),
        param({ name: "joined", explode: false }),
        param({ name: "fields" }),
        param({ name: "X-List", in: "header", style: "simple", explode: false })
      ]
    })
    const result = assemble(op, [
      { source: "spec", value: ["a", "b"] },
      { source: "spec", value: ["a", "b"] },
      { source: "spec", value: { x: 1, y: "z" } },
      { source: "spec", value: ["a", "b"] }
    ])
    expect(result.ok).toBe(true)
    if (!result.ok) return
    const url = new URL(result.request.url)
    expect(url.searchParams.getAll("tag")).toEqual(["a", "b"])
    expect(url.searchParams.get("joined")).toBe("a,b")
    expect(url.searchParams.get("x")).toBe("1")
    expect(url.searchParams.get("y")).toBe("z")
    expect(result.request.headers["X-List"]).toBe("a,b")
  })

  it("parses input JSON body and gives manually supplied content-type final precedence", () => {
    const op = operation({
      path: "/items",
      method: "POST",
      body: {
        required: true,
        json: true,
        contentTypes: ["application/json"],
        examples: [],
        description: null
      }
    })
    const result = assemble(op, [{ source: "input", ref: "body" }], {
      inputs: { body: '{"a":1}' },
      headers: { "Content-Type": "application/custom" }
    })
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.request.body).toBe('{"a":1}')
    expect(
      Object.entries(result.request.headers).filter(
        ([name]) => name.toLowerCase() === "content-type"
      )
    ).toEqual([["Content-Type", "application/custom"]])
    expect(result.inputHeaderNames).toContain("content-type")
    const normal = assemble(op, [{ source: "input", ref: "body" }], {
      inputs: { body: "[1,2]" }
    })
    expect(normal.ok && normal.request.body).toBe("[1,2]")
    expect(normal.ok && normal.request.headers["content-type"]).toBe(
      "application/json"
    )
  })

  it("keeps an input value literal for a content parameter", () => {
    const op = operation({
      path: "/items",
      parameters: [param({ name: "payload", content: true })]
    })
    const result = assemble(op, [{ source: "input", ref: "payload" }], {
      inputs: { payload: '{"a":1}' }
    })
    expect(
      result.ok && new URL(result.request.url).searchParams.get("payload")
    ).toBe('{"a":1}')
  })

  it("returns skip for an unresolved path variable", () => {
    expect(assemble(operation(), [])).toEqual({
      ok: false,
      skip: "unresolved: {id}"
    })
  })

  it("skips unresolved header placeholders and fills known response values", () => {
    const op = operation({ path: "/items" })
    const headers = { "X-Value": "{{steps.x.body.t}}" }
    expect(assemble(op, [], { headers })).toEqual({
      ok: false,
      skip: "unresolved: {{steps.x.body.t}}"
    })
    const result = assemble(op, [], {
      headers,
      steps: { x: recent("x", { t: "good" }).response }
    })
    expect(result.ok && result.request.headers["X-Value"]).toBe("good")
    expect(result.ok && [...result.inputHeaderNames]).toEqual(["x-value"])
  })

  it("omits optional parameters and optional body when selected", () => {
    const op = operation({
      path: "/items",
      parameters: [param({ required: false })],
      body: {
        required: false,
        json: true,
        contentTypes: ["application/json"],
        examples: [],
        description: null
      }
    })
    const result = assemble(op, [{ source: "omit" }, { source: "omit" }])
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.request.url).toBe("http://h/api/v1/items")
    expect(result.request.body).toBeUndefined()
  })

  it("overrides a same-named query parameter with an apiKey query and masks placed headers", () => {
    const op = operation({
      path: "/items",
      parameters: [
        param({ name: "token" }),
        param({
          name: "X-Input",
          in: "header",
          style: "simple",
          explode: false
        })
      ],
      security: [["queryKey", "headerKey"]]
    })
    const result = assemble(
      op,
      [
        { source: "spec", value: "old" },
        { source: "input", ref: "header" }
      ],
      {
        schemes,
        inputs: { queryKey: "new", headerKey: "secret", header: "from-input" },
        headers: { "X-Fixed": "public" }
      }
    )
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(new URL(result.request.url).searchParams.getAll("token")).toEqual([
      "new"
    ])
    expect(result.request.headers["X-API-Key"]).toBe("secret")
    expect(result.request.headers["X-Input"]).toBe("from-input")
    expect(result.inputHeaderNames).toEqual(
      new Set(["x-input", "x-api-key", "x-fixed"])
    )
  })

  it("replaces a header parameter with the matching authentication header", () => {
    const op = operation({
      path: "/items",
      parameters: [
        param({
          name: "x-api-key",
          in: "header",
          style: "simple",
          explode: false
        })
      ],
      security: [["headerKey"]]
    })
    const result = assemble(op, [{ source: "spec", value: "old" }], {
      schemes,
      inputs: { headerKey: "new" }
    })
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(Object.entries(result.request.headers)).toEqual([
      ["X-API-Key", "new"]
    ])
  })

  it("gives case-insensitive manual authorization precedence over bearer without duplicates", () => {
    const op = operation({ path: "/items", security: [["bearer"]] })
    const result = assemble(op, [], {
      schemes,
      inputs: { bearer: "secret" },
      headers: { authorization: "Bearer manual" }
    })
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(
      Object.entries(result.request.headers).filter(
        ([name]) => name.toLowerCase() === "authorization"
      )
    ).toEqual([["authorization", "Bearer manual"]])
    expect(result.inputHeaderNames).toEqual(new Set(["authorization"]))
  })
})

describe("security", () => {
  it("applies bearer, UTF-8 basic and both kinds of apiKey", () => {
    expect(applyAuth(["bearer"], schemes, { bearer: "abc" })).toEqual({
      headers: { Authorization: "Bearer abc" },
      query: {}
    })
    expect(applyAuth(["basic"], schemes, { basic: "user:pass" })).toEqual({
      headers: { Authorization: "Basic dXNlcjpwYXNz" },
      query: {}
    })
    expect(
      applyAuth(["headerKey", "queryKey"], schemes, {
        headerKey: "secret",
        queryKey: "value"
      })
    ).toEqual({ headers: { "X-API-Key": "secret" }, query: { token: "value" } })
  })

  it("selects the first complete OR alternative, requiring all schemes within an AND", () => {
    expect(
      selectSecurity([["a"], ["bearer", "headerKey"]], schemes, {
        bearer: "b",
        headerKey: "h"
      })
    ).toEqual(["bearer", "headerKey"])
    const op = operation({
      path: "/items",
      security: [["a"], ["bearer", "headerKey"]]
    })
    const result = assemble(op, [], {
      schemes,
      inputs: { bearer: "b", headerKey: "h" }
    })
    expect(result.ok && result.request.headers).toEqual({
      Authorization: "Bearer b",
      "X-API-Key": "h"
    })
  })

  it("does not partially apply an AND requirement or unsupported oauth2", () => {
    expect(
      selectSecurity([["a"], ["bearer", "headerKey"]], schemes, { bearer: "b" })
    ).toBeNull()
    expect(selectSecurity([["oauth"]], schemes, { oauth: "token" })).toBeNull()
    const result = assemble(
      operation({ path: "/items", security: [["bearer", "headerKey"]] }),
      [],
      {
        schemes,
        inputs: { bearer: "b" }
      }
    )
    expect(result.ok && result.request.headers).toEqual({})
  })

  it("prefers an empty alternative, while empty and absent security apply nothing", () => {
    expect(selectSecurity([[], ["bearer"]], schemes, { bearer: "b" })).toEqual(
      []
    )
    expect(selectSecurity([], schemes, { bearer: "b" })).toBeNull()
    expect(selectSecurity(null, schemes, { bearer: "b" })).toBeNull()
    for (const security of [[[], ["bearer"]], [], null]) {
      const result = assemble(operation({ path: "/items", security }), [], {
        schemes,
        inputs: { bearer: "b" }
      })
      expect(result.ok && result.request.headers).toEqual({})
    }
  })
})

describe("isDocumented", () => {
  it("matches literal status, case-insensitive status class, and default, not other statuses", () => {
    expect(isDocumented(["200"], 200)).toBe(true)
    expect(isDocumented(["2XX"], 201)).toBe(true)
    expect(isDocumented(["2xx"], 204)).toBe(true)
    expect(isDocumented(["default"], 500)).toBe(true)
    expect(isDocumented(["404"], 500)).toBe(false)
  })
})

const loadedSpec: LoadedSpec = {
  doc: {},
  source: { kind: "file", location: "/openapi.json" },
  openapi: "3.1.0",
  schemes: {}
}

describe("specSource", () => {
  const context = {
    goal: "Check response",
    step: 1,
    baseUrl: "https://api.example.test/api",
    inputs: {},
    steps: {},
    recent: [],
    history: [],
    dropSummary: false
  }
  const fakeJev = () => {
    const fetch = vi.fn<typeof globalThis.fetch>(async (_url, init) => {
      const request = JSON.parse(String(init?.body)) as {
        questions: Record<string, unknown>
      }
      return new Response(
        JSON.stringify({
          model: "jev-test",
          answers: Object.fromEntries(
            Object.keys(request.questions).map((key) => [
              key,
              { type: "choice", choice: "c1", confidence: 0.9 }
            ])
          ),
          usage: { input_tokens: 7, output_tokens: 0 }
        }),
        { headers: { "content-type": "application/json" } }
      )
    })
    return vi.fn(createJevCall({ apiKey: "test", fetch }))
  }

  it("lists required parameters and the three body kinds", () => {
    const source = specSource({
      spec: loadedSpec,
      operations: [
        operation({
          name: "json",
          parameters: [param({ in: "path" })],
          body: {
            required: true,
            contentTypes: ["application/json"],
            json: true,
            examples: [],
            description: null
          }
        }),
        operation({
          name: "unsupported",
          body: {
            required: false,
            contentTypes: ["text/plain"],
            json: false,
            examples: [],
            description: null
          }
        }),
        operation({ name: "none", summary: null })
      ],
      headers: {}
    })
    expect(source.stateKey).toBe("operations")
    expect(source.list).toEqual({
      json: {
        method: "GET",
        path: "/items/{id}",
        summary: "An item",
        requiredParams: ["id"],
        body: "json"
      },
      unsupported: {
        method: "GET",
        path: "/items/{id}",
        summary: "An item",
        requiredParams: [],
        body: "unsupported"
      },
      none: {
        method: "GET",
        path: "/items/{id}",
        requiredParams: [],
        body: "none"
      }
    })
  })

  it("calls Jev once with a 30 second timeout only for multiple candidates", async () => {
    const jev = fakeJev()
    const op = operation({
      path: "/items",
      parameters: [param({ examples: ["a", "b"] })]
    })
    const source = specSource({
      spec: loadedSpec,
      operations: [op],
      headers: {}
    })
    const result = await source.build(op.name, context, jev)
    expect(jev).toHaveBeenCalledTimes(1)
    expect(jev.mock.calls[0]?.[1]).toEqual({ timeout: 30_000 })
    expect(result.ok && result.values).toEqual([
      {
        target: "id",
        in: "query",
        source: "spec",
        ref: "example[0]",
        confidence: 0.9
      }
    ])
    const singleJev = fakeJev()
    const single = specSource({
      spec: loadedSpec,
      operations: [
        operation({ path: "/items", parameters: [param({ examples: ["a"] })] })
      ],
      headers: {}
    })
    const singleResult = await single.build(op.name, context, singleJev)
    expect(singleJev).not.toHaveBeenCalled()
    expect(singleResult.ok && singleResult.values?.[0]?.confidence).toBeNull()
  })

  it("stops on missing required values without calling Jev", async () => {
    const jev = fakeJev()
    const op = operation({
      parameters: [param({ in: "path" })],
      body: {
        required: true,
        contentTypes: ["application/json"],
        json: true,
        examples: [],
        description: null
      }
    })
    const result = await specSource({
      spec: loadedSpec,
      operations: [op],
      headers: {}
    }).build(op.name, context, jev)
    expect(result).toEqual({
      ok: false,
      stuck: "missing_input",
      note: "id, body"
    })
    expect(jev).not.toHaveBeenCalled()
  })

  it("reports fill budget overflow without calling Jev", async () => {
    const jev = fakeJev()
    const op = operation({
      path: "/items",
      parameters: [param({ examples: ["a", "b"] })]
    })
    const result = await specSource({
      spec: loadedSpec,
      operations: [op],
      headers: {}
    }).build(
      op.name,
      {
        ...context,
        history: [{ data: "h".repeat(200_000) }]
      },
      jev
    )
    expect(result).toMatchObject({ ok: false, kind: "budget_exceeded" })
    expect(jev).not.toHaveBeenCalled()
  })

  it("always records values, including an empty list, and omits an empty note", async () => {
    const jev = fakeJev()
    const op = operation({ path: "/items", responses: ["200"] })
    const result = await specSource({
      spec: loadedSpec,
      operations: [op],
      headers: {}
    }).build(op.name, context, jev)
    expect(result).toMatchObject({ ok: true, values: [] })
    expect(result).not.toHaveProperty("note")
    expect(result.ok && result.isDocumented?.(404)).toBe(false)
    expect(jev).not.toHaveBeenCalled()
  })

  it("joins unsupported-style and unsupported-body notes in order", async () => {
    const op = operation({
      path: "/items",
      parameters: [param({ supported: false, required: false })],
      body: {
        required: false,
        contentTypes: ["text/plain"],
        json: false,
        examples: [],
        description: null
      }
    })
    const result = await specSource({
      spec: loadedSpec,
      operations: [op],
      headers: {}
    }).build(op.name, context, fakeJev())
    expect(result).toMatchObject({
      ok: true,
      values: [],
      note: "style_unsupported, body_unsupported"
    })
  })
})
