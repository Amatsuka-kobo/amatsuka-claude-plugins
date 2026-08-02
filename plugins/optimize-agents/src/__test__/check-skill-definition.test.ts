import { spawnSync } from "node:child_process"
import fs from "node:fs"
import { createRequire } from "node:module"
import os from "node:os"
import path from "node:path"
import { fileURLToPath } from "node:url"
import { afterEach, expect, test } from "vitest"

const SCRIPT = fileURLToPath(
  new URL("../check-skill-definition.ts", import.meta.url)
)
const TSX_CLI = createRequire(import.meta.url).resolve("tsx/cli")
const directories: string[] = []

function tmpdir(): string {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "skill-definition-"))
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

function skillFile(content: string, name = "sample-skill"): string {
  const directory = path.join(tmpdir(), "plugins", "sample", "skills", name)
  fs.mkdirSync(directory, { recursive: true })
  const file = path.join(directory, "SKILL.md")
  fs.writeFileSync(file, content)
  return file
}

function commandFile(content: string, name = "deploy-app.md"): string {
  const directory = path.join(tmpdir(), "plugins", "sample", "commands")
  fs.mkdirSync(directory, { recursive: true })
  const file = path.join(directory, name)
  fs.writeFileSync(file, content)
  return file
}

function run(file: string, type?: "skill" | "command") {
  const args = [TSX_CLI, SCRIPT, file]
  if (type) args.push("--type", type)
  const result = spawnSync(process.execPath, args, { encoding: "utf8" })
  return {
    status: result.status,
    stderr: result.stderr,
    output: JSON.parse(result.stdout) as {
      path: string
      type: string
      name: string
      command: string
      errors: string[]
      warnings: string[]
    }
  }
}

const complete = ["name: sample-skill", "description: 完全な定義"]

test("完全な skill 定義は errors と warnings なし", () => {
  const result = run(skillFile(definition(complete)))
  expect(result.status).toBe(0)
  expect(result.output.errors).toEqual([])
  expect(result.output.warnings).toEqual([])
  expect(result.output.command).toBe("/sample:sample-skill")
})

test("frontmatter がない skill は error", () => {
  const result = run(skillFile("本文"))
  expect(result.status).toBe(1)
  expect(result.output.errors).toContain("frontmatter が --- で始まっていない")
})

test("frontmatter 終端がない skill は error", () => {
  const result = run(skillFile(["---", ...complete, "本文"].join("\n")))
  expect(result.status).toBe(1)
  expect(result.output.errors).toContain("frontmatter の終端 --- がない")
})

test("形式違反の skill name は error", () => {
  const result = run(skillFile(definition(["name: Foo_Bar", "description: 説明"])))
  expect(result.status).toBe(1)
  expect(result.output.errors).toContain(
    "name は英小文字・数字・ハイフンのみで指定し、先頭と末尾はハイフン以外にする"
  )
})

test("先頭がハイフンの skill name は error", () => {
  const result = run(skillFile(definition(["name: -foo", "description: 説明"])))
  expect(result.status).toBe(1)
  expect(result.output.errors).toContain(
    "name は英小文字・数字・ハイフンのみで指定し、先頭と末尾はハイフン以外にする"
  )
})

test("description も本文もない skill は error", () => {
  const result = run(skillFile(definition(["name: sample-skill"], "")))
  expect(result.status).toBe(1)
  expect(result.output.errors).toContain(
    "description も本文も無い。どちらか一方は要る"
  )
})

test("未知の skill frontmatter キーは error", () => {
  const result = run(
    skillFile(definition([...complete, "allowed_tools: Read"]))
  )
  expect(result.status).toBe(1)
  expect(result.output.errors).toContain(
    "使用できない frontmatter フィールド: allowed_tools"
  )
})

test("description のない本文付き skill は warning", () => {
  const result = run(skillFile(definition([], "本文"), "fallback-name"))
  expect(result.status).toBe(0)
  expect(result.output.warnings).toContain(
    "description が未指定。本文の第 1 段落が使われる"
  )
  expect(result.output.name).toBe("fallback-name")
})

test("1536 文字超の skill metadata は W2", () => {
  const result = run(
    skillFile(definition([`description: ${"あ".repeat(1600)}`]))
  )
  expect(result.status).toBe(0)
  expect(result.output.warnings).toContain(
    "description と when_to_use の合計が 1536 文字を超えている(1600 文字)。一覧で切り詰められる"
  )
  expect(result.output.warnings).not.toContain(
    "description と when_to_use の合計が上限に近い(1600 文字 / 1536)"
  )
})

test("上限に近い skill metadata は W3", () => {
  const result = run(
    skillFile(definition([`description: ${"あ".repeat(1400)}`]))
  )
  expect(result.status).toBe(0)
  expect(result.output.warnings).toContain(
    "description と when_to_use の合計が上限に近い(1400 文字 / 1536)"
  )
  expect(result.output.warnings).not.toContain(
    "description と when_to_use の合計が 1536 文字を超えている(1400 文字)。一覧で切り詰められる"
  )
})

test("本文が 500 行超の skill は warning", () => {
  const result = run(skillFile(definition(complete, Array(520).fill("本文").join("\n"))))
  expect(result.status).toBe(0)
  expect(result.output.warnings).toContain(
    "本文が 500 行を超えている(520 行)。references/ への分割を検討する"
  )
})

test("agent のない context: fork は warning", () => {
  const result = run(skillFile(definition([...complete, "context: fork"])))
  expect(result.status).toBe(0)
  expect(result.output.warnings).toContain(
    "context: fork に対する agent が未指定"
  )
})

test("完全な command 定義はファイル名を使う", () => {
  const result = run(commandFile(definition(["description: 完全な定義"])))
  expect(result.status).toBe(0)
  expect(result.output.errors).toEqual([])
  expect(result.output.warnings).toEqual([])
  expect(result.output.name).toBe("deploy-app")
  expect(result.output.command).toBe("/sample:deploy-app")
})

test("command の name は warning で呼び出し名を変えない", () => {
  const result = run(commandFile(definition(["name: other", "description: 説明"])))
  expect(result.status).toBe(0)
  expect(result.output.warnings).toContain(
    "command の name はコマンド名を決めない。呼び出し名はファイル名(deploy-app)になる"
  )
  expect(result.output.command).toBe("/sample:deploy-app")
})

test("形式違反の command ファイル名は error", () => {
  const result = run(commandFile(definition(["description: 説明"]), "Deploy_App.md"))
  expect(result.status).toBe(1)
  expect(result.output.errors).toContain(
    "name は英小文字・数字・ハイフンのみで指定し、先頭と末尾はハイフン以外にする"
  )
})

test("command でも未知キー error と metadata warning が両方出る", () => {
  const result = run(
    commandFile(definition(["allowed_tools: Read", `description: ${"あ".repeat(1600)}`]))
  )
  expect(result.status).toBe(1)
  expect(result.output.errors).toContain(
    "使用できない frontmatter フィールド: allowed_tools"
  )
  expect(result.output.warnings).toContain(
    "description と when_to_use の合計が 1536 文字を超えている(1600 文字)。一覧で切り詰められる"
  )
})

test("--type は判別不能なパスでも command を明示できる", () => {
  const directory = tmpdir()
  const file = path.join(directory, "definition.md")
  fs.writeFileSync(file, definition(["description: 説明"]))

  const explicit = run(file, "command")
  expect(explicit.status).toBe(0)
  expect(explicit.output.type).toBe("command")

  const implicit = spawnSync(process.execPath, [TSX_CLI, SCRIPT, file], {
    encoding: "utf8"
  })
  expect(implicit.status).toBe(2)
  expect(implicit.stderr).toContain("--type を指定する")
})
