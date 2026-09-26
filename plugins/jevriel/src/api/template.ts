import type { ApiRequest, ApiResponse } from "./http.js"
import type { RequestSource } from "./loop.js"

export type RequestTemplate = {
  method: string
  path: string
  headers: Record<string, string>
  body?: unknown
  description?: string
}

const PLACEHOLDER = /{{([^{}]+)}}/g

type PlaceholderContext = {
  inputs: Record<string, string>
  steps: Record<string, ApiResponse>
}

function lookup(token: string, ctx: PlaceholderContext): unknown {
  const parts = token.split(".")
  if (parts[0] === "inputs" && parts.length === 2)
    return Object.hasOwn(ctx.inputs, parts[1])
      ? ctx.inputs[parts[1]]
      : undefined
  if (
    parts[0] !== "steps" ||
    parts.length < 3 ||
    !Object.hasOwn(ctx.steps, parts[1])
  )
    return undefined
  const response = ctx.steps[parts[1]]
  if (parts[2] === "status" && parts.length === 3) return response.status
  if (parts[2] === "headers" && parts.length === 4)
    return Object.entries(response.headers).find(
      ([name]) => name.toLowerCase() === parts[3].toLowerCase()
    )?.[1]
  if (parts[2] !== "body" || parts.length < 4) return undefined
  let value: unknown = response.body
  for (const key of parts.slice(3)) {
    if (
      value === null ||
      typeof value !== "object" ||
      !Object.hasOwn(value, key)
    )
      return undefined
    value = (value as Record<string, unknown>)[key]
  }
  return value
}

export function resolvePlaceholders(
  text: string,
  ctx: PlaceholderContext
):
  | { ok: true; value: string; usedInputs: boolean }
  | { ok: false; unresolved: string } {
  let unresolved: string | undefined
  let usedInputs = false
  const value = text.replace(PLACEHOLDER, (full, token: string) => {
    const found = lookup(token, ctx)
    if (found === undefined) {
      unresolved ??= full
      return full
    }
    if (token.startsWith("inputs.")) usedInputs = true
    return typeof found === "string" ? found : JSON.stringify(found)
  })
  return unresolved === undefined
    ? { ok: true, value, usedInputs }
    : { ok: false, unresolved }
}

function normalizeDotEncoding(part: string): string {
  return part.replace(/%2e/gi, ".")
}

/**
 * True when any "/"-separated part of `value` is exactly "." or ".."
 * (including percent-encoded forms). A path built from such a value
 * gets folded/collapsed by URL normalization, which would point a
 * segment-index-based redaction at the wrong part of the final path.
 */
export function hasUnsafeDotSegment(value: string): boolean {
  return value.split("/").some((part) => {
    const normalized = normalizeDotEncoding(part)
    return normalized === "." || normalized === ".."
  })
}

export function templateSource(
  requests: Record<string, RequestTemplate>
): RequestSource {
  return {
    stateKey: "requests",
    list: Object.fromEntries(
      Object.entries(requests).map(([name, tpl]) => [
        name,
        {
          method: tpl.method,
          path: tpl.path,
          ...(tpl.description === undefined
            ? {}
            : { summary: tpl.description }),
          requiredParams: [],
          body: tpl.body === undefined ? "none" : "json"
        }
      ])
    ),
    async build(name, ctx) {
      const tpl = requests[name]
      const resolved = resolveTemplate(tpl, ctx)
      if (!resolved.ok)
        return { ok: false, skip: `unresolved: ${resolved.unresolved}` }
      const rawSegments = tpl.path.split(/[?#]/, 1)[0].split("/")
      const segments = rawSegments.map((part) => resolvePlaceholders(part, ctx))
      for (let index = 0; index < segments.length; index += 1) {
        const segment = segments[index]
        if (
          segment.ok &&
          segment.usedInputs &&
          hasUnsafeDotSegment(segment.value)
        )
          return { ok: false, skip: `unsafe_path: ${rawSegments[index]}` }
      }
      const inputPathSegments: number[] = []
      const filled = segments.map((segment) =>
        segment.ok ? segment.value : ""
      )
      const finalParts = new URL(resolved.request.url).pathname.split("/")
      let marker = "__jevriel_input_segment__"
      while (resolved.request.url.includes(marker)) marker += "_"
      for (let index = 0; index < segments.length; index += 1) {
        const segment = segments[index]
        if (!segment.ok || !segment.usedInputs) continue
        const marked = [...filled]
        marked[index] = marker
        const start = new URL(marked.join("/"), ctx.baseUrl).pathname
          .split("/")
          .indexOf(marker)
        if (start < 0) continue
        for (
          let offset = 0;
          offset < segment.value.split("/").length &&
          start + offset < finalParts.length;
          offset += 1
        )
          inputPathSegments.push(start + offset)
      }
      return { ...resolved, inputPathSegments }
    }
  }
}

export function resolveTemplate(
  tpl: RequestTemplate,
  ctx: {
    baseUrl: string
    inputs: Record<string, string>
    steps: Record<string, ApiResponse>
  }
):
  | { ok: true; request: ApiRequest; inputHeaderNames: Set<string> }
  | { ok: false; unresolved: string } {
  let unresolved: string | undefined
  const fill = (text: string, preserveType = false): unknown => {
    const exact = /^{{([^{}]+)}}$/.exec(text)
    if (preserveType && exact) {
      const value = lookup(exact[1], ctx)
      if (value === undefined) unresolved ??= text
      return value
    }
    const resolved = resolvePlaceholders(text, ctx)
    if (!resolved.ok) {
      unresolved ??= resolved.unresolved
      return text
    }
    return resolved.value
  }
  const fillBody = (value: unknown): unknown => {
    if (typeof value === "string") return fill(value, true)
    if (Array.isArray(value)) return value.map(fillBody)
    if (value !== null && typeof value === "object")
      return Object.fromEntries(
        Object.entries(value).map(([key, entry]) => [key, fillBody(entry)])
      )
    return value
  }
  const path = fill(tpl.path) as string
  const inputHeaderNames = new Set<string>()
  const headers = Object.fromEntries(
    Object.entries(tpl.headers).map(([name, value]) => {
      if (
        [...value.matchAll(PLACEHOLDER)].some((match) =>
          match[1].startsWith("inputs.")
        )
      )
        inputHeaderNames.add(name.toLowerCase())
      return [name, fill(value) as string]
    })
  )
  const body = tpl.body === undefined ? undefined : fillBody(tpl.body)
  if (unresolved !== undefined) return { ok: false, unresolved }
  if (
    body !== undefined &&
    typeof body !== "string" &&
    !Object.keys(headers).some((name) => name.toLowerCase() === "content-type")
  )
    headers["content-type"] = "application/json"
  const request: ApiRequest = {
    method: tpl.method,
    url: new URL(path, ctx.baseUrl).toString(),
    headers
  }
  if (body !== undefined)
    request.body = typeof body === "string" ? body : JSON.stringify(body)
  return { ok: true, request, inputHeaderNames }
}
