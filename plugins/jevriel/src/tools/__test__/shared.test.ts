import { RateLimitError } from "@typesafe-ai/sdk"
import { describe, expect, it } from "vitest"
import {
  createToolDeps,
  errorResponse,
  evidenceSchema,
  jevErrorResponse,
  nameSchema,
  notConfiguredResponse,
  resolveProjectDir,
  thresholdsSchema,
  toResponse
} from "../shared.js"

function resultOf(response: {
  content: Array<{ type: "text"; text: string }>
}): unknown {
  return JSON.parse(response.content[0].text)
}

describe("toResponse", () => {
  it("serializes the result as indented JSON text", () => {
    const value = { ok: true, nested: { count: 2 } }
    expect(toResponse(value)).toEqual({
      content: [{ type: "text", text: JSON.stringify(value, null, 2) }]
    })
  })
})

describe("errorResponse", () => {
  it("sets isError and includes the error kind", () => {
    const response = errorResponse("invalid_input", "Invalid thresholds", {
      status: 400
    })

    expect(response.isError).toBe(true)
    expect(resultOf(response)).toEqual({
      error: {
        kind: "invalid_input",
        message: "Invalid thresholds",
        status: 400
      }
    })
  })

  it("wraps SDK errors as api_error with their class and HTTP metadata", () => {
    const sdkError = new RateLimitError(
      429,
      { error: { message: "rate limited" } },
      new Headers({
        "x-typesafe-request-id": "request-1"
      })
    )
    const response = jevErrorResponse(sdkError)

    expect(response.isError).toBe(true)
    expect(resultOf(response)).toEqual({
      error: {
        kind: "api_error",
        message: sdkError.message,
        errorClass: "RateLimitError",
        status: 429,
        requestId: "request-1"
      }
    })
  })

  it("creates the not_configured response", () => {
    expect(notConfiguredResponse().isError).toBe(true)
    expect(resultOf(notConfiguredResponse())).toMatchObject({
      error: { kind: "not_configured" }
    })
  })
})

describe("shared schemas", () => {
  it("provides the threshold, evidence, and name defaults", () => {
    expect(thresholdsSchema.parse({})).toEqual({
      satisfied: 0.8,
      unsatisfied: 0.2
    })
    expect(evidenceSchema.parse(undefined)).toBe("always")
    expect(nameSchema.parse(undefined)).toBeUndefined()
  })
})

describe("resolveProjectDir", () => {
  it("prefers CLAUDE_PROJECT_DIR", () => {
    expect(
      resolveProjectDir(
        { CLAUDE_PROJECT_DIR: "/project/from-env" },
        () => "/current"
      )
    ).toBe("/project/from-env")
  })

  it("uses cwd when CLAUDE_PROJECT_DIR is absent", () => {
    expect(resolveProjectDir({}, () => "/current")).toBe("/current")
  })

  it("creates tool dependencies from the supplied environment", () => {
    const env = { TYPESAFE_API_KEY: "test", CLAUDE_PROJECT_DIR: "/project" }
    const deps = createToolDeps(env)

    expect(deps.env).toBe(env)
    expect(deps.projectDir).toBe("/project")
    expect(deps.httpFetch).toBe(fetch)
    expect(deps.now()).toBeInstanceOf(Date)
    expect(typeof deps.jev).toBe("function")
  })
})
