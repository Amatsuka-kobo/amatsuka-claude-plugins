// `metatron check` の終了コードと出力。実行は tsx 経由の子プロセス。

import fs from "node:fs"
import os from "node:os"
import path from "node:path"
import { fileURLToPath, pathToFileURL } from "node:url"
import { afterAll, expect, test } from "vitest"
import { runTs } from "../../testing/run-ts.js"

const CLI = fileURLToPath(new URL("../../metatron-cli.ts", import.meta.url))
const FAULT_CHECKS = fileURLToPath(
  new URL("../../testing/fault-checks.mjs", import.meta.url)
)

const tmpDirs: string[] = []
afterAll(() => {
  for (const dir of tmpDirs) fs.rmSync(dir, { recursive: true, force: true })
})

function project(files: Record<string, string>): string {
  const root = fs.realpathSync(
    fs.mkdtempSync(path.join(os.tmpdir(), "metatron-check-cli-"))
  )
  tmpDirs.push(root)
  const all = { "metatron.config.json": "{}", ...files }
  for (const [rel, body] of Object.entries(all)) {
    const full = path.join(root, rel)
    fs.mkdirSync(path.dirname(full), { recursive: true })
    fs.writeFileSync(full, body, "utf8")
  }
  return root
}

function run(
  cwd: string,
  env: NodeJS.ProcessEnv = process.env
): { status: number; json: Record<string, unknown> | null; stderr: string } {
  let status = 0
  let stdout = ""
  let stderr = ""
  try {
    stdout = runTs(CLI, ["check"], {
      cwd,
      env,
      stdio: ["pipe", "pipe", "pipe"],
      encoding: "utf8"
    })
  } catch (error) {
    const failure = error as {
      status?: number
      stdout?: string
      stderr?: string
    }
    status = typeof failure.status === "number" ? failure.status : -1
    stdout = String(failure.stdout ?? "")
    stderr = String(failure.stderr ?? "")
  }
  let json: Record<string, unknown> | null = null
  try {
    json = JSON.parse(stdout) as Record<string, unknown>
  } catch {
    json = null
  }
  return { status, json, stderr }
}

const DEFINITION = JSON.stringify([
  {
    id: "no-lib-to-app",
    kind: "no-import",
    from: ["src/lib/**"],
    to: ["src/app/**"],
    message: "lib は app を import しない"
  }
])

function architecture(block: string | null): string {
  const body =
    block === null ? "- なし" : `\`\`\`json metatron:checks\n${block}\n\`\`\``
  return `# ARCHITECTURE\n\n## 禁止事項\n\n${body}\n`
}

test("K1: 違反が無ければ 0、あれば 1 で、違反をファイルと行で返す", () => {
  const clean = project({
    "docs/ARCHITECTURE.md": architecture(DEFINITION),
    "src/lib/a.ts": 'import { b } from "./b"\n',
    "src/lib/b.ts": "export const b = 1\n"
  })
  const ok = run(clean)
  expect(ok.status).toBe(0)
  expect(ok.json?.violations).toEqual([])

  const dirty = project({
    "docs/ARCHITECTURE.md": architecture(DEFINITION),
    "src/lib/a.ts": '\nimport { v } from "../app/view"\n',
    "src/app/view.ts": "export const v = 1\n"
  })
  const ng = run(dirty)
  expect(ng.status).toBe(1)
  expect(ng.json?.violations).toEqual([
    {
      check: "no-lib-to-app",
      file: "src/lib/a.ts",
      line: 2,
      specifier: "../app/view",
      target: "src/app/view",
      message: "lib は app を import しない"
    }
  ])
  expect(ng.stderr).toContain(
    "src/lib/a.ts:2: lib は app を import しない(../app/view)"
  )
})

test("K2: ARCHITECTURE・ブロック・読める定義・一致するファイルのどれかが無ければ 2", () => {
  const cases: [Record<string, string>, string][] = [
    [{}, "architecture_missing"],
    [{ "docs/ARCHITECTURE.md": architecture(null) }, "block_not_found"],
    [{ "docs/ARCHITECTURE.md": architecture("[") }, "invalid_checks"],
    [{ "docs/ARCHITECTURE.md": architecture(DEFINITION) }, "no_match"]
  ]
  for (const [files, error] of cases) {
    const result = run(project(files))
    expect(result.status, error).toBe(2)
    expect(result.json?.error).toBe(error)
  }
})

test("K3: 想定外の内部エラーは 3 で、違反の 1 と区別する", () => {
  const root = project({ "docs/ARCHITECTURE.md": architecture(DEFINITION) })
  const result = run(root, {
    ...process.env,
    NODE_OPTIONS: `--import ${pathToFileURL(FAULT_CHECKS).href}`
  })
  expect(result.status).toBe(3)
  expect(result.json?.error).toBe("internal_error")
})
