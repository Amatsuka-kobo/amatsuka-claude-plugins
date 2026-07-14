import { execFile } from "node:child_process"
import { access, mkdtemp, readFile, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import path from "node:path"
import { fileURLToPath } from "node:url"
import { promisify } from "node:util"
import { expect, test } from "vitest"

const execFileAsync = promisify(execFile)
const BUNDLED_CLI = fileURLToPath(new URL("../scripts/design-gen.mjs", import.meta.url))

const erSpec = {
  type: "er",
  title: "テスト ER図",
  entities: [
    { name: "users", columns: [{ name: "id", pk: true }] },
    { name: "orders", columns: [{ name: "id", pk: true }] },
  ],
  relations: [{ from: "users", to: "orders", cardinality: "1:N" }],
}

const screenFlowSpec = {
  type: "screen-flow",
  title: "画面遷移",
  screens: [
    { id: "login", label: "ログイン", kind: "start" },
    { id: "home", label: "ホーム" },
  ],
  transitions: [{ from: "login", to: "home", trigger: "成功" }],
}

const architectureSpec = {
  type: "architecture",
  title: "構成図",
  zones: [{ id: "aws", label: "AWS", children: ["app"] }],
  nodes: [
    { id: "browser", label: "ブラウザ" },
    { id: "app", label: "App" },
  ],
  edges: [{ from: "browser", to: "app", label: "HTTPS" }],
}

const sequenceSpec = {
  type: "sequence",
  title: "シーケンス",
  actors: [
    { id: "u", label: "ユーザー" },
    { id: "w", label: "Web" },
  ],
  messages: [
    { from: "u", to: "w", label: "要求" },
    { from: "w", to: "u", label: "応答", style: "return" },
  ],
}

async function writeSpec(spec: unknown, filename = "sample.spec.json") {
  const dir = await mkdtemp(path.join(tmpdir(), "design-gen-"))
  const specPath = path.join(dir, filename)
  await writeFile(specPath, JSON.stringify(spec))
  return { dir, specPath }
}

async function invoke(args: string[]) {
  try {
    const { stdout, stderr } = await execFileAsync("node", [BUNDLED_CLI, ...args])
    return { code: 0, stdout, stderr }
  } catch (error) {
    const failure = error as Error & { code: number; stdout: string; stderr: string }
    return { code: failure.code, stdout: failure.stdout, stderr: failure.stderr }
  }
}

function expectOneJsonLine(result: { stdout: string; stderr: string }) {
  expect(result.stderr).toBe("")
  expect(result.stdout.trim().split("\n")).toHaveLength(1)
  return JSON.parse(result.stdout) as { ok: boolean; files?: string[]; errors?: string[] }
}

test("usage failure", async () => {
  const result = await invoke([])
  expect(result.code).toBe(1)
  expect(expectOneJsonLine(result)).toEqual({
    ok: false,
    errors: ["usage: node design-gen.mjs <spec.json> --format <drawio|html|both>"],
  })
})

test("invalid format", async () => {
  const { specPath } = await writeSpec(erSpec)
  const result = await invoke([specPath, "--format", "pdf"])
  expect(result.code).toBe(1)
  expect(expectOneJsonLine(result)).toEqual({
    ok: false,
    errors: ['--format: "pdf" は不正です(対応: drawio, html, both)'],
  })
})

test("missing format value", async () => {
  const { specPath } = await writeSpec(erSpec)
  const result = await invoke([specPath, "--format"])
  expect(result.code).toBe(1)
  expect(expectOneJsonLine(result)).toEqual({
    ok: false,
    errors: ['--format: "undefined" は不正です(対応: drawio, html, both)'],
  })
})

test("unreadable spec", async () => {
  const result = await invoke(["/no/such/file.spec.json", "--format", "both"])
  expect(result.code).toBe(1)
  const json = expectOneJsonLine(result)
  expect(json.ok).toBe(false)
  expect(json.errors?.[0]).toContain("spec ファイルを読めません:")
})

test("invalid JSON", async () => {
  const { dir } = await writeSpec(erSpec)
  const specPath = path.join(dir, "broken.spec.json")
  await writeFile(specPath, "{not json")
  const result = await invoke([specPath, "--format", "both"])
  expect(result.code).toBe(1)
  const json = expectOneJsonLine(result)
  expect(json.ok).toBe(false)
  expect(json.errors?.[0]).toContain("spec ファイルを読めません:")
})

test("validation errors", async () => {
  const { specPath } = await writeSpec({ type: "er", title: "x", entities: [] })
  const result = await invoke([specPath, "--format", "both"])
  expect(result.code).toBe(1)
  const json = expectOneJsonLine(result)
  expect(json.ok).toBe(false)
  expect(json.errors?.some((error) => error.includes("entities"))).toBe(true)
})

test("default both", async () => {
  const { specPath } = await writeSpec(erSpec)
  const result = await invoke([specPath])
  expect(result.code).toBe(0)
  const json = expectOneJsonLine(result)
  expect(json).toEqual({
    ok: true,
    files: [path.join(path.dirname(specPath), "sample.drawio"), path.join(path.dirname(specPath), "sample.html")],
  })
  for (const file of json.files ?? []) await access(file)
})

test("drawio only", async () => {
  const { dir, specPath } = await writeSpec(erSpec, "er-diagram.json")
  const result = await invoke([specPath, "--format", "drawio"])
  expect(result.code).toBe(0)
  const json = expectOneJsonLine(result)
  expect(json).toEqual({ ok: true, files: [path.join(dir, "er-diagram.drawio")] })
  expect(await readFile(path.join(dir, "er-diagram.drawio"), "utf8")).toMatch(/^<mxfile/)
})

test("html only", async () => {
  const { dir, specPath } = await writeSpec(erSpec)
  const result = await invoke([specPath, "--format", "html"])
  expect(result.code).toBe(0)
  const json = expectOneJsonLine(result)
  expect(json).toEqual({ ok: true, files: [path.join(dir, "sample.html")] })
  expect(await readFile(path.join(dir, "sample.html"), "utf8")).toMatch(/^<!doctype html>/)
})

test.each([
  ["screen-flow success", screenFlowSpec],
  ["architecture success", architectureSpec],
  ["sequence success", sequenceSpec],
] as const)("%s", async (_name, spec) => {
  const { specPath } = await writeSpec(spec, `${spec.type}.spec.json`)
  const result = await invoke([specPath, "--format", "both"])
  expect(result.code).toBe(0)
  const json = expectOneJsonLine(result)
  expect(json.ok).toBe(true)
  expect(json.files?.map((file) => path.basename(file))).toEqual([`${spec.type}.drawio`, `${spec.type}.html`])
  expect(await readFile(json.files![0], "utf8")).toMatch(/^<mxfile/)
  expect(await readFile(json.files![1], "utf8")).toMatch(/^<!doctype html>/)
})
