import { readFile, stat } from "node:fs/promises"
import { isAbsolute, relative, resolve, sep } from "node:path"
import { parse as parseYaml } from "yaml"
import { sanitizeUrl } from "./http.js"

export type HttpMethod =
  | "GET"
  | "POST"
  | "PUT"
  | "PATCH"
  | "DELETE"
  | "HEAD"
  | "OPTIONS"
export type Include = {
  tags?: string[]
  pathPrefix?: string
  methods?: HttpMethod[]
}
export type OperationParam = {
  name: string
  in: "path" | "query" | "header"
  required: boolean
  style: string
  explode: boolean
  content: boolean
  supported: boolean
  types: string[] | null
  enum: unknown[] | null
  default?: unknown
  examples: unknown[]
  description: string | null
}
export type OperationBody = {
  required: boolean
  contentTypes: string[]
  json: boolean
  examples: unknown[]
  description: string | null
}
export type Operation = {
  name: string
  operationId: string | null
  method: HttpMethod
  path: string
  summary: string | null
  description: string | null
  tags: string[]
  parameters: OperationParam[]
  body: OperationBody | null
  responses: string[]
  security: string[][] | null
  servers: string[]
  supported: boolean
}
export type SecurityScheme =
  | { name: string; type: "apiKey"; in: "header" | "query"; paramName: string }
  | { name: string; type: "http"; scheme: "bearer" | "basic" }
  | { name: string; type: "unsupported" }
export type LoadedSpec = {
  doc: Record<string, unknown>
  source: { kind: "file" | "url"; location: string }
  openapi: string
  schemes: Record<string, SecurityScheme>
}

export const SPEC_MAX_BYTES = 5 * 1024 * 1024
export const REF_MAX_DEPTH = 16
export const LIST_LIMIT = 255
export const RUN_LIMIT = 253
export const DEFAULT_METHODS: readonly HttpMethod[] = [
  "GET",
  "POST",
  "PUT",
  "PATCH"
]

const METHODS: readonly HttpMethod[] = [
  "GET",
  "POST",
  "PUT",
  "PATCH",
  "DELETE",
  "HEAD",
  "OPTIONS"
]

class SpecError extends Error {}

function object(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null
}

function asObject(value: unknown): Record<string, unknown> {
  const result = object(value)
  if (!result) throw new SpecError("Invalid OpenAPI object")
  return result
}

function text(value: unknown): string | null {
  return typeof value === "string" ? value : null
}

function extractRef(
  doc: Record<string, unknown>,
  node: unknown,
  openapi: string
): Record<string, unknown> {
  const result = resolveRef(doc, node, openapi)
  if (!result.ok) throw new SpecError(result.message)
  return asObject(result.value)
}

function resolveReference(
  doc: Record<string, unknown>,
  node: unknown,
  openapi: string,
  referenceObject: boolean
): { ok: true; value: unknown } | { ok: false; message: string } {
  let value = node
  const active = new Set<string>()
  let depth = 0
  const overlays: Array<Record<string, unknown>> = []
  while (object(value) && "$ref" in (value as Record<string, unknown>)) {
    const refNode = value as Record<string, unknown>
    const ref = refNode.$ref
    if (typeof ref !== "string" || !(ref === "#" || ref.startsWith("#/")))
      return {
        ok: false,
        message: `Invalid or external reference: ${String(ref)}`
      }
    if (active.has(ref))
      return { ok: false, message: `Cyclic reference: ${ref}` }
    if (++depth > REF_MAX_DEPTH)
      return { ok: false, message: `Reference depth exceeds ${REF_MAX_DEPTH}` }
    active.add(ref)
    if (referenceObject && openapi.startsWith("3.1")) {
      const overlay: Record<string, unknown> = {}
      for (const key of ["summary", "description"])
        if (key in refNode) overlay[key] = refNode[key]
      overlays.push(overlay)
    }
    try {
      let target: unknown = doc
      for (const token of ref === "#" ? [] : ref.slice(2).split("/")) {
        const decoded = decodeURIComponent(token)
          .replace(/~1/g, "/")
          .replace(/~0/g, "~")
        target = object(target)?.[decoded]
        if (target === undefined)
          return { ok: false, message: `Reference not found: ${ref}` }
      }
      value = target
    } catch {
      return { ok: false, message: `Invalid JSON Pointer: ${ref}` }
    }
  }
  if (object(value))
    for (const overlay of overlays.reverse())
      value = { ...(value as Record<string, unknown>), ...overlay }
  return { ok: true, value }
}

export function resolveRef(
  doc: Record<string, unknown>,
  node: unknown,
  openapi: string
): { ok: true; value: unknown } | { ok: false; message: string } {
  return resolveReference(doc, node, openapi, true)
}

function checkExternalRefs(root: unknown): void {
  const visited = new WeakSet<object>()
  const scan = (value: unknown): void => {
    if (!value || typeof value !== "object" || visited.has(value)) return
    visited.add(value)
    if (Array.isArray(value)) {
      for (const item of value) scan(item)
      return
    }
    const record = value as Record<string, unknown>
    if (
      "$ref" in record &&
      (typeof record.$ref !== "string" || !record.$ref.startsWith("#"))
    ) {
      throw new SpecError(
        `External reference is not supported: ${String(record.$ref)}`
      )
    }
    for (const child of Object.values(record)) scan(child)
  }
  scan(root)
}

function parseSpec(bytes: Uint8Array): unknown {
  const source = new TextDecoder().decode(bytes)
  try {
    return JSON.parse(source)
  } catch {
    /* YAML may also be valid */
  }
  try {
    return parseYaml(source)
  } catch (error) {
    const line = (error as { linePos?: Array<{ line: number }> }).linePos?.[0]
      ?.line
    throw new SpecError(`YAML parse failed${line ? ` at line ${line}` : ""}`)
  }
}

export async function loadSpec(
  spec: string,
  deps: { projectDir: string; fetch: typeof fetch; timeoutMs: number }
): Promise<
  | { ok: true; spec: LoadedSpec }
  | { ok: false; kind: "invalid_input" | "request_failed"; message: string }
> {
  let source: LoadedSpec["source"]
  let bytes: Uint8Array
  if (/^https?:/i.test(spec)) {
    try {
      source = { kind: "url", location: sanitizeUrl(spec) }
    } catch {
      return { ok: false, kind: "invalid_input", message: "Invalid spec URL" }
    }
    let response: Response
    try {
      response = await deps.fetch(spec, {
        redirect: "manual",
        signal: AbortSignal.timeout(deps.timeoutMs)
      })
    } catch {
      return {
        ok: false,
        kind: "request_failed",
        message: `Spec request failed: ${source.location}`
      }
    }
    if (response.status >= 300 && response.status < 400)
      return {
        ok: false,
        kind: "request_failed",
        message: `Spec redirect refused: ${source.location}`
      }
    if (response.status < 200 || response.status >= 300)
      return {
        ok: false,
        kind: "invalid_input",
        message: `Spec HTTP ${response.status}: ${source.location}`
      }
    if (!response.body) bytes = new Uint8Array()
    else {
      const reader = response.body.getReader()
      const chunks: Uint8Array[] = []
      let size = 0
      try {
        while (true) {
          const next = await reader.read()
          if (next.done) break
          size += next.value.byteLength
          if (size > SPEC_MAX_BYTES) {
            void reader.cancel()
            return {
              ok: false,
              kind: "invalid_input",
              message: "Spec exceeds 5 MiB"
            }
          }
          chunks.push(next.value)
        }
      } catch {
        return {
          ok: false,
          kind: "request_failed",
          message: `Spec request failed: ${source.location}`
        }
      }
      bytes = new Uint8Array(size)
      let at = 0
      for (const chunk of chunks) {
        bytes.set(chunk, at)
        at += chunk.byteLength
      }
    }
  } else {
    const base = resolve(deps.projectDir)
    const path = resolve(base, spec)
    const suffix = relative(base, path)
    if (
      suffix === ".." ||
      suffix.startsWith(`..${sep}`) ||
      isAbsolute(suffix)
    ) {
      return {
        ok: false,
        kind: "invalid_input",
        message: "Spec path is outside projectDir"
      }
    }
    source = { kind: "file", location: path }
    try {
      if ((await stat(path)).size > SPEC_MAX_BYTES)
        return {
          ok: false,
          kind: "invalid_input",
          message: "Spec exceeds 5 MiB"
        }
      bytes = await readFile(path)
      if (bytes.byteLength > SPEC_MAX_BYTES)
        return {
          ok: false,
          kind: "invalid_input",
          message: "Spec exceeds 5 MiB"
        }
    } catch {
      return {
        ok: false,
        kind: "invalid_input",
        message: `Cannot read spec file: ${path}`
      }
    }
  }
  try {
    const doc = asObject(parseSpec(bytes))
    const version = text(doc.openapi)
    if (!version || !/^3\.[01](\.\d+)?$/.test(version)) {
      throw new SpecError(
        doc.swagger === "2.0" || version === "2.0"
          ? "Convert Swagger 2.0 to OpenAPI 3.x before loading"
          : "Unsupported OpenAPI version"
      )
    }
    if (!object(doc.paths))
      throw new SpecError("OpenAPI paths must be an object")
    checkExternalRefs(doc)
    const schemes: Record<string, SecurityScheme> = {}
    for (const [name, raw] of Object.entries(
      object(object(doc.components)?.securitySchemes) ?? {}
    )) {
      const scheme = extractRef(doc, raw, version)
      if (
        scheme.type === "apiKey" &&
        (scheme.in === "header" || scheme.in === "query") &&
        typeof scheme.name === "string"
      ) {
        schemes[name] = {
          name,
          type: "apiKey",
          in: scheme.in,
          paramName: scheme.name
        }
      } else if (
        scheme.type === "http" &&
        ["bearer", "basic"].includes(String(scheme.scheme).toLowerCase())
      ) {
        schemes[name] = {
          name,
          type: "http",
          scheme: String(scheme.scheme).toLowerCase() as "bearer" | "basic"
        }
      } else schemes[name] = { name, type: "unsupported" }
    }
    return { ok: true, spec: { doc, source, openapi: version, schemes } }
  } catch (error) {
    return {
      ok: false,
      kind: "invalid_input",
      message:
        error instanceof SpecError ? error.message : "Invalid OpenAPI document"
    }
  }
}

function schemaInfo(
  doc: Record<string, unknown>,
  raw: unknown,
  openapi: string
): Record<string, unknown> {
  const node = object(raw)
  // Schema Object siblings must not override a $ref target.
  if (!node?.$ref) return node ?? {}
  const result = resolveReference(doc, { $ref: node.$ref }, openapi, false)
  if (!result.ok) throw new SpecError(result.message)
  return asObject(result.value)
}

function examples(
  doc: Record<string, unknown>,
  owner: Record<string, unknown>,
  openapi: string
): unknown[] {
  const result: unknown[] = []
  if (object(owner.examples)) {
    for (const raw of Object.values(
      owner.examples as Record<string, unknown>
    )) {
      const example = extractRef(doc, raw, openapi)
      if ("value" in example) result.push(example.value)
    }
  } else if ("example" in owner) result.push(owner.example)
  return result
}

function mediaType(owner: Record<string, unknown>): [string, unknown] | null {
  return (
    Object.entries(object(owner.content) ?? {}).find(([key]) =>
      /^application\/json(?:;|$)/i.test(key)
    ) ?? null
  )
}

function parameters(
  doc: Record<string, unknown>,
  raw: unknown,
  openapi: string
): OperationParam[] {
  if (!Array.isArray(raw)) return []
  const result: OperationParam[] = []
  for (const entry of raw) {
    const param = extractRef(doc, entry, openapi)
    const location = param.in
    if (
      location === "cookie" ||
      (location === "header" &&
        /^(accept|content-type|authorization)$/i.test(String(param.name)))
    )
      continue
    if (location !== "path" && location !== "query" && location !== "header")
      continue
    const content = "content" in param
    const media = mediaType(param)
    const mediaObject = media ? extractRef(doc, media[1], openapi) : null
    const schema = schemaInfo(
      doc,
      content ? mediaObject?.schema : param.schema,
      openapi
    )
    const style =
      text(param.style) ?? (location === "query" ? "form" : "simple")
    const types = Array.isArray(schema.type)
      ? schema.type.filter((v): v is string => typeof v === "string")
      : typeof schema.type === "string"
        ? [schema.type]
        : null
    if (
      types &&
      openapi.startsWith("3.0") &&
      schema.nullable === true &&
      !types.includes("null")
    )
      types.push("null")
    const values =
      content && mediaObject
        ? examples(doc, mediaObject, openapi)
        : examples(doc, param, openapi)
    if ("example" in schema) values.push(schema.example)
    const parsed: OperationParam = {
      name: String(param.name),
      in: location,
      required: location === "path" || param.required === true,
      style,
      explode:
        typeof param.explode === "boolean" ? param.explode : style === "form",
      content,
      supported:
        (!content || !!mediaObject) && (style === "form" || style === "simple"),
      types,
      enum: Array.isArray(schema.enum) ? schema.enum : null,
      examples: values,
      description: text(param.description)
    }
    if ("default" in schema) parsed.default = schema.default
    result.push(parsed)
  }
  return result
}

function body(
  doc: Record<string, unknown>,
  raw: unknown,
  openapi: string
): OperationBody | null {
  if (!raw) return null
  const item = extractRef(doc, raw, openapi)
  const contentTypes = Object.keys(object(item.content) ?? {})
  const media = mediaType(item)
  const mediaObject = media ? extractRef(doc, media[1], openapi) : null
  const values = mediaObject ? examples(doc, mediaObject, openapi) : []
  const schema = schemaInfo(doc, mediaObject?.schema, openapi)
  if ("example" in schema) values.push(schema.example)
  return {
    required: item.required === true,
    contentTypes,
    json: !!mediaObject,
    examples: values,
    description: text(item.description)
  }
}

function servers(raw: unknown): string[] {
  if (!Array.isArray(raw)) return []
  return raw.flatMap((entry) => {
    const server = object(entry)
    if (!server || typeof server.url !== "string") return []
    const variables = object(server.variables)
    return [
      server.url.replace(/\{([^{}]+)\}/g, (match, name: string) => {
        const fallback = object(variables?.[name])?.default
        return fallback === undefined ? match : String(fallback)
      })
    ]
  })
}

function security(value: unknown): string[][] {
  if (!Array.isArray(value)) return []
  return value.map((entry) => Object.keys(object(entry) ?? {}))
}

export function operationName(
  method: HttpMethod,
  path: string,
  operationId: string | null
): string {
  if (operationId)
    return operationId.replace(/[^A-Za-z0-9_-]/g, "_").slice(0, 64)
  const slug =
    path
      .replace(/[{}]/g, "")
      .replace(/[^A-Za-z0-9]+/g, "_")
      .replace(/^_+|_+$/g, "") || "root"
  return `${method.toLowerCase()}_${slug}`.slice(0, 64)
}

export function listOperations(
  spec: LoadedSpec,
  include: Include | undefined,
  limit: 253 | 255
): { ok: true; operations: Operation[] } | { ok: false; message: string } {
  try {
    const found: Operation[] = []
    const paths = asObject(spec.doc.paths)
    for (const [path, raw] of Object.entries(paths)) {
      if (
        include?.pathPrefix !== undefined &&
        !path.startsWith(include.pathPrefix)
      )
        continue
      const item = extractRef(spec.doc, raw, spec.openapi)
      for (const method of METHODS) {
        if (!(include?.methods ?? DEFAULT_METHODS).includes(method)) continue
        const rawOperation = object(item[method.toLowerCase()])
        if (!rawOperation) continue
        const tags = Array.isArray(rawOperation.tags)
          ? rawOperation.tags.filter(
              (tag): tag is string => typeof tag === "string"
            )
          : []
        if (include?.tags && !include.tags.some((tag) => tags.includes(tag)))
          continue
        const inherited = parameters(spec.doc, item.parameters, spec.openapi)
        const own = parameters(spec.doc, rawOperation.parameters, spec.openapi)
        const merged = inherited
          .filter(
            (original) =>
              !own.some(
                (override) =>
                  original.name === override.name && original.in === override.in
              )
          )
          .concat(own)
        const bodyValue =
          spec.openapi.startsWith("3.0") &&
          ["GET", "HEAD", "DELETE"].includes(method)
            ? null
            : body(spec.doc, rawOperation.requestBody, spec.openapi)
        const operationId = text(rawOperation.operationId)
        found.push({
          name: operationName(method, path, operationId),
          operationId,
          method,
          path,
          summary: text(rawOperation.summary),
          description: text(rawOperation.description),
          tags,
          parameters: merged,
          body: bodyValue,
          responses: Object.keys(object(rawOperation.responses) ?? {}),
          security:
            "security" in rawOperation
              ? security(rawOperation.security)
              : "security" in spec.doc
                ? security(spec.doc.security)
                : null,
          servers: servers(
            "servers" in rawOperation
              ? rawOperation.servers
              : "servers" in item
                ? item.servers
                : spec.doc.servers
          ),
          supported: merged.every((param) => !param.required || param.supported)
        })
      }
    }
    const operations =
      limit === RUN_LIMIT ? found.filter((op) => op.supported) : found
    const seen = new Map<string, Operation>()
    for (const op of operations) {
      if (op.name === "done" || op.name === "stuck")
        throw new SpecError(
          `Reserved operation name ${op.name}: ${op.method} ${op.path}. Add operationId or narrow include`
        )
      const previous = seen.get(op.name)
      if (previous)
        throw new SpecError(
          `Duplicate operation name ${op.name}: ${previous.method} ${previous.path}, ${op.method} ${op.path}. Add operationId or narrow include`
        )
      seen.set(op.name, op)
    }
    if (operations.length > limit)
      throw new SpecError(
        `${operations.length} operations exceed ${limit}; narrow the selection with include`
      )
    return { ok: true, operations }
  } catch (error) {
    return {
      ok: false,
      message:
        error instanceof SpecError
          ? error.message
          : "Invalid OpenAPI operations"
    }
  }
}
