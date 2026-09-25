import type { ApiRequest, ApiResponse } from "./http.js"

export type RequestTemplate = {
  method: string
  path: string
  headers: Record<string, string>
  body?: unknown
  description?: string
}

const PLACEHOLDER = /{{([^{}]+)}}/g

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
  const lookup = (token: string): unknown => {
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
  const fill = (text: string, preserveType = false): unknown => {
    const exact = /^{{([^{}]+)}}$/.exec(text)
    if (preserveType && exact) {
      const value = lookup(exact[1])
      if (value === undefined) unresolved ??= text
      return value
    }
    return text.replace(PLACEHOLDER, (full, token: string) => {
      const value = lookup(token)
      if (value === undefined) {
        unresolved ??= full
        return full
      }
      return typeof value === "string" ? value : JSON.stringify(value)
    })
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
