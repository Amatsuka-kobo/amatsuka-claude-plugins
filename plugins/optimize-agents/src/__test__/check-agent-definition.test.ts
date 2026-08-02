import { spawnSync } from "node:child_process"
import fs from "node:fs"
import { createRequire } from "node:module"
import os from "node:os"
import path from "node:path"
import { fileURLToPath } from "node:url"
import { afterEach, expect, test } from "vitest"

const SCRIPT = fileURLToPath(
  new URL("../check-agent-definition.ts", import.meta.url)
)
const TSX_CLI = createRequire(import.meta.url).resolve("tsx/cli")
const directories: string[] = []

function tmpdir(): string {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "agent-definition-"))
  directories.push(directory)
  return directory
}

afterEach(() => {
  while (directories.length > 0)
    fs.rmSync(directories.pop() as string, { recursive: true, force: true })
})

function definition(fields: string[], body = "本文"): string {
  return ["---", ...fields, "---", "", body].join("\n")
}

function writeDefinition(
  content: string,
  filename = "gpt-sol.md",
  directory = tmpdir()
): string {
  const file = path.join(directory, filename)
  fs.writeFileSync(file, content)
  return file
}

function run(file: string, scope?: "project" | "user" | "plugin") {
  const args = [TSX_CLI, SCRIPT, file]
  if (scope) args.push("--scope", scope)
  const result = spawnSync(process.execPath, args, { encoding: "utf8" })
  return {
    status: result.status,
    stderr: result.stderr,
    output: JSON.parse(result.stdout) as {
      path: string
      scope: string
      errors: string[]
      warnings: string[]
    }
  }
}

const complete = [
  "name: gpt-sol",
  "description: 完全な定義",
  "model: sonnet",
  "color: yellow",
  "tools: Read, Grep, Glob"
]

test("完全な project 定義は errors なし", () => {
  const result = run(writeDefinition(definition(complete)))
  expect(result.status).toBe(0)
  expect(result.output.scope).toBe("project")
  expect(result.output.errors).toEqual([])
})

test("パスから推定した完全な plugin 定義は errors なし", () => {
  const directory = path.join(tmpdir(), "plugins", "sample", "agents")
  fs.mkdirSync(directory, { recursive: true })
  const result = run(
    writeDefinition(definition(complete), "gpt-sol.md", directory)
  )
  expect(result.status).toBe(0)
  expect(result.output.scope).toBe("plugin")
  expect(result.output.errors).toEqual([])
})

test("color なしは warning", () => {
  const result = run(writeDefinition(definition(complete.slice(0, -2))))
  expect(result.status).toBe(0)
  expect(result.output.warnings).toContain("color が未指定")
})

test("name 欠落は error", () => {
  const result = run(writeDefinition(definition(complete.slice(1))))
  expect(result.status).toBe(1)
  expect(result.output.errors).toContain("name が未指定")
})

test("description 欠落は error", () => {
  const result = run(
    writeDefinition(
      definition(complete.filter((line) => !line.startsWith("description:")))
    )
  )
  expect(result.status).toBe(1)
  expect(result.output.errors).toContain("description が未指定")
})

test("大文字を含む name は error", () => {
  const result = run(
    writeDefinition(
      definition(
        complete.map((line) => line.replace("gpt-sol", "GptSol")),
        "GptSol.md"
      )
    )
  )
  expect(result.status).toBe(1)
  expect(result.output.errors).toContain(
    "name は英小文字・数字・ハイフンのみで指定する"
  )
})

test("アンダースコアを含む name は error", () => {
  const result = run(
    writeDefinition(
      definition(
        complete.map((line) => line.replace("gpt-sol", "gpt_sol")),
        "gpt_sol.md"
      )
    )
  )
  expect(result.status).toBe(1)
  expect(result.output.errors).toContain(
    "name は英小文字・数字・ハイフンのみで指定する"
  )
})

test("name とファイル名の不一致は warning", () => {
  const result = run(writeDefinition(definition(complete), "other.md"))
  expect(result.status).toBe(0)
  expect(result.output.warnings).toContain("name がファイル名と一致しない")
})

test("plugin scope の hooks は error", () => {
  const result = run(
    writeDefinition(definition([...complete, "hooks: {}"])),
    "plugin"
  )
  expect(result.status).toBe(1)
  expect(result.output.errors).toContain("plugin 配下では hooks を使えない")
})

test("plugin scope の mcpServers は error", () => {
  const result = run(
    writeDefinition(definition([...complete, "mcpServers: {}"])),
    "plugin"
  )
  expect(result.status).toBe(1)
  expect(result.output.errors).toContain(
    "plugin 配下では mcpServers を使えない"
  )
})

test("plugin scope の permissionMode は error", () => {
  const result = run(
    writeDefinition(definition([...complete, "permissionMode: default"])),
    "plugin"
  )
  expect(result.status).toBe(1)
  expect(result.output.errors).toContain(
    "plugin 配下では permissionMode を使えない"
  )
})

test("plugin scope の isolation: docker は error", () => {
  const result = run(
    writeDefinition(definition([...complete, "isolation: docker"])),
    "plugin"
  )
  expect(result.status).toBe(1)
  expect(result.output.errors).toContain(
    "plugin 配下の isolation は worktree のみ指定できる"
  )
})

test("frontmatter 終端の欠落は error", () => {
  const result = run(writeDefinition(["---", ...complete, "本文"].join("\n")))
  expect(result.status).toBe(1)
  expect(result.output.errors).toContain("frontmatter の終端 --- がない")
})

test("本文が空なら error", () => {
  const result = run(writeDefinition(definition(complete, "")))
  expect(result.status).toBe(1)
  expect(result.output.errors).toContain("本文が空")
})

test("project scope の hooks は許可される", () => {
  const result = run(writeDefinition(definition([...complete, "hooks: {}"])))
  expect(result.status).toBe(0)
  expect(result.output.errors).toEqual([])
})

test("plugin scope の isolation: worktree は許可される", () => {
  const result = run(
    writeDefinition(definition([...complete, "isolation: worktree"])),
    "plugin"
  )
  expect(result.status).toBe(0)
  expect(result.output.errors).toEqual([])
})

test("独自 model エイリアスは許可される", () => {
  const result = run(
    writeDefinition(
      definition(
        complete.map((line) =>
          line.replace("model: sonnet", "model: claude-gpt-5-6-sol")
        )
      )
    )
  )
  expect(result.status).toBe(0)
  expect(result.output.errors).toEqual([])
})

test("model: inherit は許可される", () => {
  const result = run(
    writeDefinition(
      definition(
        complete.map((line) => line.replace("model: sonnet", "model: inherit"))
      )
    )
  )
  expect(result.status).toBe(0)
  expect(result.output.errors).toEqual([])
})

test("未知の tools は warning", () => {
  const result = run(
    writeDefinition(
      definition(
        complete.map((line) =>
          line.replace("Read, Grep, Glob", "Read, FutureTool")
        )
      )
    )
  )
  expect(result.status).toBe(0)
  expect(result.output.warnings).toContain("未知のツール名: FutureTool")
})

test("未知の frontmatter キーは warning", () => {
  const result = run(writeDefinition(definition([...complete, "foo: bar"])))
  expect(result.status).toBe(0)
  expect(result.output.warnings).toContain("未知の frontmatter フィールド: foo")
})
