import { describe, expect, it } from "vitest"
import type { ApiResponse } from "../http.js"
import { type RequestTemplate, resolveTemplate } from "../template.js"

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
