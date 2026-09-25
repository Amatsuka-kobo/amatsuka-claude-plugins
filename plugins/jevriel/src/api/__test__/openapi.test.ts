import { mkdtemp, readFile, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { dirname, join, resolve } from "node:path"
import { fileURLToPath } from "node:url"
import { describe, expect, it, vi } from "vitest"
import {
  LIST_LIMIT,
  listOperations,
  loadSpec,
  operationName,
  REF_MAX_DEPTH,
  RUN_LIMIT,
  resolveRef,
  SPEC_MAX_BYTES
} from "../openapi.js"

const projectDir = resolve(
  dirname(fileURLToPath(import.meta.url)),
  "../../fixtures/openapi"
)
const sample = JSON.parse(
  await readFile(join(projectDir, "sample-3.1.json"), "utf8")
)
const fetchFail: typeof fetch = async () => {
  throw new Error("offline")
}

async function fromDoc(doc: unknown) {
  const dir = await mkdtemp(join(tmpdir(), "jev-openapi-"))
  await writeFile(join(dir, "spec.json"), JSON.stringify(doc))
  return loadSpec("spec.json", {
    projectDir: dir,
    fetch: fetchFail,
    timeoutMs: 30_000
  })
}

async function loaded(doc: unknown) {
  const result = await fromDoc(doc)
  expect(result.ok).toBe(true)
  if (!result.ok) throw new Error(result.message)
  return result.spec
}

function ops(
  doc: Parameters<typeof listOperations>[0],
  limit: 253 | 255 = LIST_LIMIT,
  include?: Parameters<typeof listOperations>[1]
) {
  const result = listOperations(doc, include, limit)
  expect(result.ok).toBe(true)
  if (!result.ok) throw new Error(result.message)
  return result.operations
}

function responseFetch(response: Response): typeof fetch {
  return vi.fn(async () => response) as typeof fetch
}

describe("loadSpec", () => {
  it("reads JSON and YAML with identical operation lists", async () => {
    const json = await loadSpec("sample-3.1.json", {
      projectDir,
      fetch: fetchFail,
      timeoutMs: 100
    })
    const yaml = await loadSpec("sample-3.1.yaml", {
      projectDir,
      fetch: fetchFail,
      timeoutMs: 100
    })
    expect(json.ok && yaml.ok).toBe(true)
    if (json.ok && yaml.ok) expect(ops(json.spec)).toEqual(ops(yaml.spec))
  })

  it("accepts 3.0.3, 3.1 and 3.1.0, rejecting unsupported or missing versions and paths", async () => {
    for (const version of ["3.0.3", "3.1", "3.1.0"])
      expect((await fromDoc({ ...sample, openapi: version })).ok).toBe(true)
    for (const version of ["2.0", "3.2.0", "3.1.0-rc1", undefined]) {
      const result = await fromDoc({ ...sample, openapi: version })
      expect(result).toMatchObject({ ok: false, kind: "invalid_input" })
      if (version === "2.0" && !result.ok)
        expect(result.message).toMatch(/3\.x/)
    }
    expect(await fromDoc({ openapi: "3.1" })).toMatchObject({
      ok: false,
      kind: "invalid_input"
    })
    expect(await fromDoc([1, 2])).toMatchObject({
      ok: false,
      kind: "invalid_input"
    })
  })

  it("reads relative paths from projectDir even when cwd differs (G1)", async () => {
    const dir = await mkdtemp(join(tmpdir(), "jev-spec-relative-"))
    await writeFile(
      join(dir, "openapi.yaml"),
      await readFile(join(projectDir, "sample-3.1.yaml"))
    )
    expect(dir).not.toBe(process.cwd())
    const result = await loadSpec("openapi.yaml", {
      projectDir: dir,
      fetch: fetchFail,
      timeoutMs: 100
    })
    expect(result.ok).toBe(true)
  })

  it("rejects traversal, external absolute paths and files larger than 5MiB", async () => {
    const dir = await mkdtemp(join(tmpdir(), "jev-spec-boundary-"))
    const outside = join(tmpdir(), "outside.json")
    for (const path of ["../outside.json", outside]) {
      expect(
        await loadSpec(path, {
          projectDir: dir,
          fetch: fetchFail,
          timeoutMs: 100
        })
      ).toMatchObject({ ok: false, kind: "invalid_input" })
    }
    await writeFile(join(dir, "spec.json"), " ".repeat(SPEC_MAX_BYTES + 1))
    expect(
      await loadSpec("spec.json", {
        projectDir: dir,
        fetch: fetchFail,
        timeoutMs: 100
      })
    ).toMatchObject({ ok: false, kind: "invalid_input" })
  })

  it("stops reading a stream immediately after its sixth 1MiB chunk", async () => {
    let reads = 0
    const stream = new ReadableStream<Uint8Array>(
      {
        pull(controller) {
          reads++
          if (reads > 7) throw new Error("read too far")
          controller.enqueue(new Uint8Array(1024 * 1024))
        },
        cancel() {
          /* expected when size limit is reached */
        }
      },
      { highWaterMark: 0 }
    )
    const result = await loadSpec("https://host/spec", {
      projectDir,
      fetch: responseFetch(new Response(stream)),
      timeoutMs: 100
    })
    expect(result).toMatchObject({ ok: false, kind: "invalid_input" })
    expect(reads).toBe(6)
  })

  it("accepts a JSON document exactly 5MiB long", async () => {
    const text = JSON.stringify({ openapi: "3.1", paths: {} })
    const bytes = new TextEncoder().encode(
      text + " ".repeat(SPEC_MAX_BYTES - text.length)
    )
    const stream = new ReadableStream<Uint8Array>({
      start(controller) {
        for (let i = 0; i < 5; i++)
          controller.enqueue(
            bytes.subarray(i * 1024 * 1024, (i + 1) * 1024 * 1024)
          )
        controller.close()
      }
    })
    expect(
      (
        await loadSpec("https://host/spec", {
          projectDir,
          fetch: responseFetch(new Response(stream)),
          timeoutMs: 100
        })
      ).ok
    ).toBe(true)
  })

  it("rejects redirects without leaking Location, 404 as invalid_input, and failed fetch as request_failed", async () => {
    const url = "https://host/openapi.json?token=abc"
    const redirect = await loadSpec(url, {
      projectDir,
      fetch: responseFetch(
        new Response(null, {
          status: 302,
          headers: { Location: "https://evil.example/x" }
        })
      ),
      timeoutMs: 100
    })
    expect(redirect).toMatchObject({ ok: false, kind: "request_failed" })
    if (!redirect.ok) expect(redirect.message).not.toContain("evil.example")
    const notFound = await loadSpec(url, {
      projectDir,
      fetch: responseFetch(new Response("no", { status: 404 })),
      timeoutMs: 100
    })
    expect(notFound).toMatchObject({ ok: false, kind: "invalid_input" })
    if (!notFound.ok) expect(notFound.message).not.toContain("abc")
    expect(
      await loadSpec(url, { projectDir, fetch: fetchFail, timeoutMs: 100 })
    ).toMatchObject({ ok: false, kind: "request_failed" })
  })

  it("sanitizes successful URL locations and uses manual redirects", async () => {
    const fetcher = responseFetch(new Response(JSON.stringify(sample)))
    const result = await loadSpec("https://host/openapi.json?token=abc", {
      projectDir,
      fetch: fetcher,
      timeoutMs: 100
    })
    expect(fetcher).toHaveBeenCalledWith(
      expect.any(String),
      expect.objectContaining({ redirect: "manual" })
    )
    if (!result.ok) throw new Error(result.message)
    expect(result.spec.source.location).not.toContain("abc")
  })

  it("reports YAML parse type and line without including the source text", async () => {
    const dir = await mkdtemp(join(tmpdir(), "jev-yaml-invalid-"))
    await writeFile(
      join(dir, "spec.yaml"),
      "openapi: 3.1\nsecret-marker: [broken\n"
    )
    const result = await loadSpec("spec.yaml", {
      projectDir: dir,
      fetch: fetchFail,
      timeoutMs: 100
    })
    expect(result).toMatchObject({ ok: false, kind: "invalid_input" })
    if (!result.ok) {
      expect(result.message).toMatch(/YAML.*line [23]/)
      expect(result.message).not.toContain("secret-marker")
    }
  })

  it("classifies schemes and inherits security, preserving an explicit empty security", async () => {
    const spec = await loaded(sample)
    expect(spec.schemes).toMatchObject({
      HeaderKey: { type: "apiKey", in: "header", paramName: "X-Key" },
      QueryKey: { type: "apiKey", in: "query", paramName: "key" },
      Bearer: { type: "http", scheme: "bearer" },
      Basic: { type: "http", scheme: "basic" },
      OAuth: { type: "unsupported" }
    })
    const items = ops(spec)
    expect(items.find((x) => x.name === "users_list")?.security).toEqual([
      ["Bearer", "HeaderKey"],
      ["OAuth"]
    ])
    expect(items.find((x) => x.name === "create_user")?.security).toEqual([])
    const extra = structuredClone(sample)
    extra.components.securitySchemes.OpenID = { type: "openIdConnect" }
    extra.components.securitySchemes.Cookie = {
      type: "apiKey",
      in: "cookie",
      name: "session"
    }
    extra.components.securitySchemes.Digest = { type: "http", scheme: "digest" }
    expect((await loaded(extra)).schemes).toMatchObject({
      OpenID: { type: "unsupported" },
      Cookie: { type: "unsupported" },
      Digest: { type: "unsupported" }
    })
    delete extra.security
    delete extra.paths["/users/{id}"].get.security
    expect(
      ops(await loaded(extra)).find((x) => x.name === "users_list")?.security
    ).toBeNull()
  })
})

describe("references and operation extraction", () => {
  it("decodes percent escapes before pointer escapes and rejects external refs", async () => {
    const doc = {
      components: { schemas: { "a/b": { value: 7 }, "a~b": { value: 8 } } }
    }
    expect(
      resolveRef(doc, { $ref: "#/components/schemas/a~1b" }, "3.1")
    ).toEqual({ ok: true, value: { value: 7 } })
    expect(
      resolveRef(doc, { $ref: "#/components/schemas/a%7E0b" }, "3.1")
    ).toEqual({ ok: true, value: { value: 8 } })
    expect(
      resolveRef(doc, { $ref: "#/components/schemas/a%7E1b" }, "3.1")
    ).toEqual({ ok: true, value: { value: 7 } })
    const external = structuredClone(sample)
    external.paths["/users/{id}"].parameters[0].$ref = "other.yaml#/x"
    const result = await fromDoc(external)
    expect(result).toMatchObject({ ok: false, kind: "invalid_input" })
    if (!result.ok) expect(result.message).toContain("other.yaml#/x")
  })

  it("limits active reference chains to 16 without rejecting shared or recursive schemas", async () => {
    const spec = await loaded(sample)
    expect(ops(spec).some((x) => x.name === "create_user")).toBe(true)
    expect(REF_MAX_DEPTH).toBe(16)
    for (const length of [16, 17]) {
      const doc: Record<string, unknown> = {
        components: { schemas: {} as Record<string, unknown> }
      }
      const schemas = (doc.components as { schemas: Record<string, unknown> })
        .schemas
      for (let i = 0; i < length; i++)
        schemas[`s${i}`] =
          i === length - 1
            ? { type: "string" }
            : { $ref: `#/components/schemas/s${i + 1}` }
      expect(
        resolveRef(doc, { $ref: "#/components/schemas/s0" }, "3.1").ok
      ).toBe(length === 16)
    }
    const cyclic = {
      components: {
        schemas: {
          A: { $ref: "#/components/schemas/B" },
          B: { $ref: "#/components/schemas/A" }
        }
      }
    }
    expect(
      resolveRef(cyclic, { $ref: "#/components/schemas/A" }, "3.1").ok
    ).toBe(false)
    const broken = structuredClone(sample)
    broken.components.parameters.Id = {
      $ref: "#/components/parameters/Missing"
    }
    expect(
      listOperations(await loaded(broken), undefined, LIST_LIMIT)
    ).toMatchObject({ ok: false })
  })

  it("allows 3.1 Reference Object summary/description siblings, but ignores other siblings and all 3.0 siblings", async () => {
    const doc = {
      components: {
        parameters: {
          p: {
            name: "id",
            in: "query",
            required: true,
            description: "original",
            schema: { type: "string" }
          }
        }
      }
    }
    const node = {
      $ref: "#/components/parameters/p",
      summary: "new",
      description: "override",
      required: false
    }
    expect(resolveRef(doc, node, "3.1")).toMatchObject({
      ok: true,
      value: { summary: "new", description: "override", required: true }
    })
    expect(resolveRef(doc, node, "3.0.3")).toMatchObject({
      ok: true,
      value: { description: "original", required: true }
    })
    expect(
      resolveRef(
        { components: { schemas: { s: { type: "string" } } } },
        { $ref: "#/components/schemas/s", type: "number" },
        "3.1"
      )
    ).toEqual({ ok: true, value: { type: "string" } })
  })

  it("forces 3.0 path parameters to required and ignores GET bodies and Reference siblings (G3)", async () => {
    const result = await loadSpec("minimal-3.0.json", {
      projectDir,
      fetch: fetchFail,
      timeoutMs: 100
    })
    if (!result.ok) throw new Error(result.message)
    const get = ops(result.spec)[0]
    expect(get?.parameters[0]).toMatchObject({
      required: true,
      types: ["integer", "null"],
      examples: [4, 3],
      description: "original"
    })
    expect(get?.body).toBeNull()
    const updated = structuredClone(sample)
    updated.paths["/users/{id}"].get.requestBody = {
      content: { "application/json": { example: { x: 1 } } }
    }
    expect(
      ops(await loaded(updated)).find((x) => x.name === "users_list")?.body
        ?.json
    ).toBe(true)
  })

  it("uses path parameters, operation overrides, case-insensitive ignored headers and schema examples", async () => {
    const get = ops(await loaded(sample)).find((x) => x.name === "users_list")
    if (!get) throw new Error("sample operation missing")
    expect(get.parameters.map((p) => p.name)).toEqual([
      "shared",
      "q",
      "id",
      "filter"
    ])
    expect(get.parameters.find((p) => p.name === "id")?.examples).toEqual([
      "override"
    ])
    expect(get.parameters.find((p) => p.name === "q")).toMatchObject({
      examples: ["first", "second", "schema"],
      enum: ["one", "two"],
      default: "one"
    })
    const doc = structuredClone(sample)
    doc.paths["/users/{id}"].parameters.push({
      name: "AUTHORIZATION",
      in: "header",
      schema: { type: "string" }
    })
    for (const name of ["ACCEPT", "content-TYPE"]) {
      doc.paths["/users/{id}"].parameters.push({
        name,
        in: "header",
        schema: { type: "string" }
      })
    }
    expect(
      ops(await loaded(doc))[0]?.parameters.every((p) => p.in !== "header")
    ).toBe(true)
  })

  it("reads JSON content parameter types and examples, marking unsupported media types and styles", async () => {
    const items = ops(await loaded(sample))
    expect(
      items
        .find((x) => x.name === "users_list")
        ?.parameters.find((p) => p.name === "filter")
    ).toMatchObject({
      content: true,
      types: ["object"],
      examples: [{ active: false }, { active: true }]
    })
    expect(items.find((x) => x.name === "get_search")?.supported).toBe(false)
    expect(
      ops(await loaded(sample), RUN_LIMIT).some((x) => x.name === "get_search")
    ).toBe(false)
    const doc = structuredClone(sample)
    doc.paths["/search"].get.parameters[0] = {
      name: "advanced",
      in: "query",
      required: true,
      content: { "text/plain": { example: "hello" } }
    }
    expect(
      ops(await loaded(doc)).find((x) => x.name === "get_search")?.parameters[0]
        ?.supported
    ).toBe(false)
  })

  it("extracts body content types and media/schema examples, servers by priority and variable defaults", async () => {
    const items = ops(await loaded(sample))
    const get = items.find((x) => x.name === "users_list")
    if (!get) throw new Error("sample operation missing")
    expect(get.body).toMatchObject({
      required: true,
      json: true,
      contentTypes: ["application/json; charset=utf-8", "text/plain"],
      examples: [{ name: "body" }, { name: "example" }]
    })
    expect(get.servers).toEqual(["https://operation.example/user"])
    expect(items.find((x) => x.name === "create_user")?.servers).toEqual([
      "/path/test"
    ])
    expect(items.find((x) => x.name === "get_search")?.servers).toEqual([
      "https://api.example/v1"
    ])
  })
})

describe("additional OpenAPI boundaries", () => {
  it("does not expand YAML merge keys", async () => {
    const dir = await mkdtemp(join(tmpdir(), "jev-no-merge-"))
    await writeFile(
      join(dir, "spec.yaml"),
      "openapi: '3.1'\npaths: {}\nbase: &base\n  description: inherited\ncopy:\n  <<: *base\n"
    )
    const result = await loadSpec("spec.yaml", {
      projectDir: dir,
      fetch: fetchFail,
      timeoutMs: 100
    })
    if (!result.ok) throw new Error(result.message)
    expect(result.spec.doc.copy).toEqual({ "<<": { description: "inherited" } })
  })

  it("keeps an explicit empty operation security instead of inheriting the document", async () => {
    const operations = ops(await loaded(sample))
    expect(operations.find((x) => x.name === "create_user")?.security).toEqual(
      []
    )
    expect(operations.find((x) => x.name === "users_list")?.security).toEqual([
      ["Bearer", "HeaderKey"],
      ["OAuth"]
    ])
  })

  it("ignores Schema Object siblings even in a chained reference", async () => {
    const doc = structuredClone(sample)
    doc.components.schemas.Node = {
      $ref: "#/components/schemas/Base",
      description: "wrong"
    }
    doc.components.schemas.Base = { type: "string", description: "actual" }
    const operation = ops(await loaded(doc)).find(
      (x) => x.name === "create_user"
    )
    expect(operation?.parameters.find((p) => p.name === "id")?.types).toEqual([
      "string"
    ])
    expect(resolveRef(doc, { $ref: "#" }, "3.1")).toEqual({
      ok: true,
      value: doc
    })
  })

  it("reads media examples instead of media example and then schema example", async () => {
    const doc = structuredClone(sample)
    doc.paths["/users/{id}"].get.parameters[2].content[
      "application/json"
    ].examples = {
      first: { value: { active: 1 } },
      second: { value: { active: 2 } }
    }
    expect(
      ops(await loaded(doc))
        .find((x) => x.name === "users_list")
        ?.parameters.find((p) => p.name === "filter")?.examples
    ).toEqual([{ active: 1 }, { active: 2 }, { active: true }])
  })

  it("marks form-only request bodies non-JSON and preserves explicit explode false", async () => {
    const operations = ops(await loaded(sample))
    expect(operations.find((x) => x.name === "post_forms")?.body).toMatchObject(
      { json: false, contentTypes: ["application/x-www-form-urlencoded"] }
    )
    expect(
      operations
        .find((x) => x.name === "users_list")
        ?.parameters.find((p) => p.name === "q")?.explode
    ).toBe(false)
  })

  it("ignores 3.0 HEAD and DELETE request bodies but reads them in 3.1", async () => {
    for (const version of ["3.0.3", "3.1.0"]) {
      const doc = structuredClone(sample)
      doc.openapi = version
      for (const method of ["head", "delete"])
        doc.paths["/users/{id}"][method] = {
          requestBody: { content: { "application/json": {} } },
          responses: {}
        }
      const operations = ops(await loaded(doc), LIST_LIMIT, {
        methods: ["HEAD", "DELETE"],
        pathPrefix: "/users"
      })
      expect(operations.map((op) => op.body?.json ?? null)).toEqual(
        version === "3.0.3" ? [null, null] : [true, true]
      )
    }
  })

  it("preserves operation order after filtering and supports 253 operations exactly", async () => {
    const paths: Record<string, unknown> = {}
    for (let i = 0; i < 253; i++) paths[`/p${i}`] = { get: { responses: {} } }
    const result = listOperations(
      await loaded({ openapi: "3.1", paths }),
      undefined,
      RUN_LIMIT
    )
    expect(result.ok).toBe(true)
    if (result.ok) {
      expect(result.operations).toHaveLength(253)
      expect(result.operations[0]?.path).toBe("/p0")
      expect(result.operations[252]?.path).toBe("/p252")
    }
  })
})

describe("operation names, filtering and limits", () => {
  it("normalizes operationId and generates slugs and root names with 64-char truncation", () => {
    expect(operationName("GET", "/users/{id}/posts", null)).toBe(
      "get_users_id_posts"
    )
    expect(operationName("GET", "/", null)).toBe("get_root")
    expect(operationName("GET", "/users", "users.list")).toBe("users_list")
    expect(operationName("POST", "/users", "x".repeat(65))).toBe("x".repeat(64))
    expect(operationName("GET", "/users", "Good_id")).toBe("Good_id")
  })

  it("rejects duplicate and reserved names with operation details", async () => {
    const duplicate = structuredClone(sample)
    duplicate.paths["/search"].get.operationId = "users.list"
    const result = listOperations(
      await loaded(duplicate),
      undefined,
      LIST_LIMIT
    )
    expect(result.ok).toBe(false)
    if (!result.ok) {
      expect(result.message).toContain("GET /users/{id}")
      expect(result.message).toContain("GET /search")
    }
    for (const name of ["done", "stuck"]) {
      const doc = structuredClone(sample)
      doc.paths["/search"].get.operationId = name
      expect(listOperations(await loaded(doc), undefined, LIST_LIMIT).ok).toBe(
        false
      )
    }
  })

  it("applies tags, pathPrefix and methods together, using safe default methods", async () => {
    const doc = structuredClone(sample)
    doc.paths["/users/{id}"].get.tags = ["users"]
    const spec = await loaded(doc)
    expect(
      ops(spec).every((x) => !["DELETE", "HEAD", "OPTIONS"].includes(x.method))
    ).toBe(true)
    expect(
      ops(spec, LIST_LIMIT, { methods: ["DELETE"] }).map((x) => x.method)
    ).toEqual(["DELETE"])
    expect(
      ops(spec, LIST_LIMIT, {
        tags: ["users"],
        pathPrefix: "/users",
        methods: ["GET"]
      }).map((x) => x.name)
    ).toEqual(["users_list"])
    expect(
      ops(spec, LIST_LIMIT, {
        tags: ["none"],
        pathPrefix: "/users",
        methods: ["GET"]
      })
    ).toEqual([])
  })

  it("enforces 253/255 after run-only removal of unsupported operations, with count and include guidance", async () => {
    for (const count of [253, 254, 255, 256]) {
      const paths: Record<string, unknown> = {}
      for (let i = 0; i < count; i++)
        paths[`/p${i}`] = {
          get: {
            parameters:
              i === 0
                ? [
                    {
                      name: "bad",
                      in: "query",
                      required: true,
                      style: "deepObject"
                    }
                  ]
                : [],
            responses: {}
          }
        }
      const spec = await loaded({ openapi: "3.1", paths })
      const run = listOperations(spec, undefined, RUN_LIMIT)
      const listing = listOperations(spec, undefined, LIST_LIMIT)
      expect(run.ok).toBe(count <= 254)
      expect(listing.ok).toBe(count <= 255)
      if (run.ok) expect(run.operations).toHaveLength(count - 1)
      else expect(run.message).toMatch(/255|include/)
      if (!listing.ok) expect(listing.message).toMatch(/256.*include/)
    }
    const supported: Record<string, unknown> = {}
    for (let i = 0; i < 254; i++)
      supported[`/x${i}`] = { get: { responses: {} } }
    expect(
      listOperations(
        await loaded({ openapi: "3.1", paths: supported }),
        undefined,
        RUN_LIMIT
      ).ok
    ).toBe(false)
  })
})
