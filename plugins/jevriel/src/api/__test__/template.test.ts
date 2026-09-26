import { describe, expect, it } from "vitest"
import type { ApiResponse } from "../http.js"
import {
  type RequestTemplate,
  resolvePlaceholders,
  resolveTemplate,
  templateSource
} from "../template.js"

const response = (body: unknown): ApiResponse => ({
  status: 201,
  headers: { location: "/next" },
  body,
  contentType: "application/json",
  bodyBytes: 0
})
const resolve = (
  tpl: RequestTemplate,
  steps: Record<string, ApiResponse> = {}
) =>
  resolveTemplate(tpl, {
    baseUrl: "https://api.example.test/root/",
    inputs: { key: "secret" },
    steps
  })

describe("resolveTemplate", () => {
  it("substitutes inputs and response body fields, including indexed arrays", () => {
    const result = resolve(
      {
        method: "POST",
        path: "/users/{{steps.list.body.items.0.id}}?key={{inputs.key}}",
        headers: {}
      },
      { list: response({ items: [{ id: 42 }] }) }
    )
    expect(result.ok && result.request.url).toBe(
      "https://api.example.test/users/42?key=secret"
    )
  })
  it("resolves response status and headers", () => {
    const result = resolve(
      {
        method: "GET",
        path: "/{{steps.login.status}}",
        headers: { next: "{{steps.login.headers.location}}" }
      },
      { login: response({}) }
    )
    expect(result.ok && result.request.headers.next).toBe("/next")
    expect(result.ok && result.request.url).toContain("/201")
  })
  it("preserves body types for an entire placeholder but interpolates partial strings", () => {
    const result = resolve(
      {
        method: "POST",
        path: "/",
        headers: {},
        body: {
          number: "{{steps.x.body.number}}",
          boolean: "{{steps.x.body.boolean}}",
          object: "{{steps.x.body.object}}",
          partial: "value={{steps.x.body.number}}"
        }
      },
      { x: response({ number: 3, boolean: false, object: { a: 1 } }) }
    )
    expect(result.ok && JSON.parse(result.request.body ?? "")).toEqual({
      number: 3,
      boolean: false,
      object: { a: 1 },
      partial: "value=3"
    })
  })
  it("returns the missing placeholder without sending a request", () => {
    expect(
      resolve({ method: "GET", path: "/{{steps.missing.status}}", headers: {} })
    ).toEqual({ ok: false, unresolved: "{{steps.missing.status}}" })
    expect(
      resolve(
        {
          method: "GET",
          path: "/",
          headers: { next: "{{steps.x.body.missing}}" }
        },
        { x: response({}) }
      )
    ).toEqual({ ok: false, unresolved: "{{steps.x.body.missing}}" })
  })
  it("tracks input-filled header names in lowercase and preserves absolute URLs", () => {
    const result = resolve({
      method: "GET",
      path: "https://other.test/a",
      headers: { "X-Tenant": "prefix-{{inputs.key}}" }
    })
    expect(result.ok && result.request.url).toBe("https://other.test/a")
    expect(result.ok && [...result.inputHeaderNames]).toEqual(["x-tenant"])
  })
})

describe("templateSource", () => {
  const ctx = {
    goal: "read",
    step: 1,
    baseUrl: "http://h/api",
    inputs: { uid: "s3cret" },
    steps: {},
    recent: [],
    history: [],
    dropSummary: false
  }
  const jev = async () => {
    throw new Error("Jev must not be called")
  }
  it("lists metadata with summary, required parameters, and body mode", () => {
    expect(
      templateSource({
        a: { method: "GET", path: "/a", headers: {}, description: "read a" },
        b: { method: "POST", path: "/b", headers: {}, body: {} }
      }).list
    ).toEqual({
      a: {
        method: "GET",
        path: "/a",
        summary: "read a",
        requiredParams: [],
        body: "none"
      },
      b: { method: "POST", path: "/b", requiredParams: [], body: "json" }
    })
  })
  it("skips unresolved templates", async () => {
    expect(
      await templateSource({
        a: { method: "GET", path: "/{{steps.x.body.id}}", headers: {} }
      }).build("a", ctx, jev)
    ).toEqual({ ok: false, skip: "unresolved: {{steps.x.body.id}}" })
  })
  it("identifies the final URL's input path segment for relative and absolute paths", async () => {
    for (const [path, index] of [
      ["/users/{{inputs.uid}}/posts", 2],
      ["http://h/api/users/{{inputs.uid}}/posts", 3]
    ] as const) {
      const result = await templateSource({
        a: { method: "GET", path, headers: {} }
      }).build("a", ctx, jev)
      expect(result.ok && result.inputPathSegments).toEqual([index])
    }
    const result = await templateSource({
      a: { method: "GET", path: "/users/1", headers: {} }
    }).build("a", ctx, jev)
    expect(result.ok && result.inputPathSegments).toEqual([])
  })
  it("distinguishes inputs, response-only placeholders, and missing values", () => {
    expect(resolvePlaceholders("{{inputs.uid}}", ctx)).toEqual({
      ok: true,
      value: "s3cret",
      usedInputs: true
    })
    expect(
      resolvePlaceholders("{{steps.x.body.id}}", {
        ...ctx,
        steps: { x: response({ id: 42 }) }
      })
    ).toEqual({ ok: true, value: "42", usedInputs: false })
    expect(resolvePlaceholders("{{inputs.missing}}", ctx)).toEqual({
      ok: false,
      unresolved: "{{inputs.missing}}"
    })
  })
})

describe("template path boundaries", () => {
  it("redacts the first URL path segment when baseUrl contains a path", async () => {
    const source = templateSource({
      first: { method: "GET", path: "/{{inputs.uid}}/posts", headers: {} }
    })
    const result = await source.build(
      "first",
      {
        goal: "read",
        step: 1,
        baseUrl: "http://h/api",
        inputs: { uid: "secret" },
        steps: {},
        recent: [],
        history: [],
        dropSummary: false
      },
      async () => {
        throw new Error("unexpected Jev call")
      }
    )
    expect(result.ok && result.inputPathSegments).toEqual([1])
  })
  it("covers every segment produced by an input containing a slash", async () => {
    const source = templateSource({
      first: { method: "GET", path: "/users/{{inputs.uid}}/posts", headers: {} }
    })
    const result = await source.build(
      "first",
      {
        goal: "read",
        step: 1,
        baseUrl: "http://h/api",
        inputs: { uid: "s3/cret" },
        steps: {},
        recent: [],
        history: [],
        dropSummary: false
      },
      async () => {
        throw new Error("unexpected Jev call")
      }
    )
    expect(result.ok && result.inputPathSegments).toEqual([2, 3])
  })

  const buildWithUid = async (uid: string) =>
    templateSource({
      first: { method: "GET", path: "/users/{{inputs.uid}}/posts", headers: {} }
    }).build(
      "first",
      {
        goal: "read",
        step: 1,
        baseUrl: "http://h/api",
        inputs: { uid },
        steps: {},
        recent: [],
        history: [],
        dropSummary: false
      },
      async () => {
        throw new Error("unexpected Jev call")
      }
    )

  it.each([
    "..",
    ".",
    "%2e%2E",
    "a/../b"
  ])("skips without building a request when an input path value is %s", async (uid) => {
    expect(await buildWithUid(uid)).toEqual({
      ok: false,
      skip: "unsafe_path: {{inputs.uid}}"
    })
  })

  it.each([
    "...",
    "a.b"
  ])("still redacts the input segment for an ordinary value containing dots: %s", async (uid) => {
    const result = await buildWithUid(uid)
    expect(result.ok && result.inputPathSegments).toEqual([2])
  })
})
