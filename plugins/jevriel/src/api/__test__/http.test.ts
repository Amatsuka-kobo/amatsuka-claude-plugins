import { describe, expect, it, vi } from "vitest"
import {
  defaultAllowedHosts,
  isHostAllowed,
  parseBody,
  redact,
  sanitizeUrl,
  sendRequest
} from "../http.js"

describe("parseBody", () => {
  it("parses valid JSON and keeps invalid JSON as text", () => {
    expect(parseBody("application/json; charset=utf-8", '{"ok":true}')).toEqual(
      {
        ok: true
      }
    )
    expect(parseBody("application/json", "not json")).toBe("not json")
    expect(parseBody("application/problem+json", '[1,"x"]')).toEqual([1, "x"])
  })

  it("keeps HTML response bodies as text", () => {
    expect(parseBody("text/html", "<h1>hello</h1>")).toBe("<h1>hello</h1>")
  })
})

describe("redact", () => {
  it("masks sensitive headers regardless of header-name casing", () => {
    expect(
      redact({
        Authorization: "Bearer secret",
        COOKIE: "session=secret",
        "Set-Cookie": "session=secret",
        "X-Api-Key": "key",
        "Proxy-Authorization": "Basic secret",
        "X-Access-Token": "token",
        "X-Client-Secret": "secret",
        "X-User-Password": "password",
        Accept: "application/json"
      })
    ).toEqual({
      Authorization: "[redacted]",
      COOKIE: "[redacted]",
      "Set-Cookie": "[redacted]",
      "X-Api-Key": "[redacted]",
      "Proxy-Authorization": "[redacted]",
      "X-Access-Token": "[redacted]",
      "X-Client-Secret": "[redacted]",
      "X-User-Password": "[redacted]",
      Accept: "application/json"
    })
  })

  it("masks explicitly selected headers regardless of their names", () => {
    expect(
      redact(
        { "X-Trace": "{{inputs.password}}", Accept: "json" },
        new Set(["x-trace"])
      )
    ).toEqual({ "X-Trace": "[redacted]", Accept: "json" })
  })
})

describe("sanitizeUrl", () => {
  it("removes credentials and query values while retaining query keys", () => {
    expect(sanitizeUrl("https://u:p@h/x?token=abc&page=2")).toBe(
      "https://h/x?token=&page="
    )
  })
})

describe("allowed hosts", () => {
  it("uses the origin host including its port by default", () => {
    expect(defaultAllowedHosts("http://localhost:3000/")).toEqual([
      "localhost:3000"
    ])
  })

  it("matches exact hosts and subdomains only for wildcard entries", () => {
    expect(isHostAllowed("localhost:3000", ["localhost:3000"])).toBe(true)
    expect(isHostAllowed("localhost:3000", ["localhost"])).toBe(false)
    expect(isHostAllowed("a.example.com", ["*.example.com"])).toBe(true)
    expect(isHostAllowed("example.com", ["*.example.com"])).toBe(false)
  })
})

describe("sendRequest", () => {
  it("sends with manual redirects and returns a 302 without following it", async () => {
    const fetchImpl = vi.fn<typeof fetch>(
      async () =>
        new Response(null, {
          status: 302,
          headers: { location: "https://elsewhere.example/" }
        })
    )

    const response = await sendRequest(
      {
        method: "GET",
        url: "https://example.test/start",
        headers: {}
      },
      1000,
      fetchImpl
    )

    expect(fetchImpl).toHaveBeenCalledWith(
      "https://example.test/start",
      expect.objectContaining({ method: "GET", redirect: "manual" })
    )
    expect(response.status).toBe(302)
    expect(response.headers.location).toBe("https://elsewhere.example/")
  })
})
