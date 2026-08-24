import fs from "node:fs"
import os from "node:os"
import path from "node:path"
import { fileURLToPath } from "node:url"
import { afterEach, beforeEach, describe, expect, it } from "vitest"
import { runTs } from "../testing/run-ts.js"

const CLI = fileURLToPath(new URL("../setup-agents.ts", import.meta.url))
const PLUGIN_ROOT = fileURLToPath(new URL("../../", import.meta.url))

let project: string

beforeEach(() => {
  project = fs.mkdtempSync(path.join(os.tmpdir(), "agent-policy-"))
  fs.mkdirSync(path.join(project, ".claude", "agents"), { recursive: true })
})

afterEach(() => {
  fs.rmSync(project, { recursive: true, force: true })
})

// CLI が stdout へ書く JSON。実行時にはエラー系で一部フィールドが欠けるが、
// 各テストは自分が検証するフィールドしか触らないため非 optional で受ける。
interface CheckResult {
  ok: boolean
  error: string
  target: string
  exists: boolean
  identical: boolean
  preambleChanged: boolean
  frontmatter: {
    changed: { key: string; existing: string; template: string }[]
    toolsOnlyInExisting: string[]
    toolsOnlyInTemplate: string[]
    keysOnlyInExisting: string[]
  }
  body: {
    sectionsOnlyInExisting: string[]
    sectionsOnlyInTemplate: string[]
    sectionsChanged: string[]
  }
  action: string
  kept: string[]
}

function run(args: string[]): CheckResult {
  let output: string
  try {
    output = runTs(CLI, args, {
      env: { ...process.env, CLAUDE_PLUGIN_ROOT: PLUGIN_ROOT }
    })
  } catch (error) {
    // CLI はエラー時も JSON を stdout へ書いてから終了コード 1 で終わる。
    // runTs(execFileSync)は非ゼロ終了で例外を投げるため、stdout を取り出す。
    const stdout = (error as { stdout?: string }).stdout
    if (stdout === undefined || stdout === "") throw error
    output = stdout
  }
  return JSON.parse(output.trim().split("\n").at(-1) ?? "{}") as CheckResult
}

function check(extra: string[] = []): CheckResult {
  return run([
    "--vendor",
    "gpt",
    "--name",
    "gpt-sol",
    "--model",
    "claude-gpt-5-6-sol",
    "--roles",
    "complex-impl",
    "--dir",
    project,
    "--check",
    ...extra
  ])
}

function target(): string {
  return path.join(project, ".claude", "agents", "gpt-sol.md")
}

describe("--check", () => {
  it("既存が無いとき exists: false を返す", () => {
    const result = check()
    expect(result.ok).toBe(true)
    expect(result.exists).toBe(false)
  })

  it("既存がテンプレートと同一のとき identical: true を返す", () => {
    run([
      "--vendor",
      "gpt",
      "--name",
      "gpt-sol",
      "--model",
      "claude-gpt-5-6-sol",
      "--roles",
      "complex-impl",
      "--dir",
      project,
      "--write"
    ])
    const result = check()
    expect(result.exists).toBe(true)
    expect(result.identical).toBe(true)
  })

  it("既存にしかない tools を toolsOnlyInExisting に出す", () => {
    seed({
      tools:
        "Read, Grep, Glob, Write, Edit, Bash, Skill, LSP, Agent, mcp__context7"
    })
    const result = check()
    expect(result.frontmatter.toolsOnlyInExisting).toContain("mcp__context7")
  })

  it("既存にしかない frontmatter キーを keysOnlyInExisting に出す", () => {
    seed({ extraKeys: { permissionMode: "plan" } })
    const result = check()
    expect(result.frontmatter.keysOnlyInExisting).toContain("permissionMode")
  })

  it("値の違う共通キーを changed に出す", () => {
    seed({ model: "my-own-alias" })
    const entry = check().frontmatter.changed.find(
      (item) => item.key === "model"
    )
    expect(entry?.existing).toBe("my-own-alias")
    expect(entry?.template).toBe("claude-gpt-5-6-sol")
  })

  it("既存にしかない節を sectionsOnlyInExisting に出す", () => {
    seed({ extraSection: "## ツール運用\n\n- Context7 を使う。\n" })
    const result = check()
    expect(result.body.sectionsOnlyInExisting).toContain("## ツール運用")
  })

  it("冒頭宣言の変更を preambleChanged に出す", () => {
    seed({ preamble: "あなたは私が書き換えた冒頭である。" })
    const result = check()
    expect(result.preambleChanged).toBe(true)
  })

  it("節の中身の変更を sectionsChanged に出す", () => {
    seed({ replaceConstraints: "- 私が書き換えた制約。\n" })
    const result = check()
    expect(result.body.sectionsChanged).toContain("## 制約")
  })

  it("不正な役割 ID でエラーを返す", () => {
    const result = run([
      "--vendor",
      "gpt",
      "--name",
      "x",
      "--model",
      "m",
      "--roles",
      "no-such-role",
      "--dir",
      project,
      "--check"
    ])
    expect(result.ok).toBe(false)
    expect(String(result.error)).toContain("no-such-role")
  })
})

// テンプレートを生成してから指定箇所を書き換え、既存ファイルとして置く。
function seed(options: {
  tools?: string
  model?: string
  extraKeys?: Record<string, string>
  extraSection?: string
  preamble?: string
  replaceConstraints?: string
}): void {
  run([
    "--vendor",
    "gpt",
    "--name",
    "gpt-sol",
    "--model",
    "claude-gpt-5-6-sol",
    "--roles",
    "complex-impl",
    "--dir",
    project,
    "--write"
  ])
  let content = fs.readFileSync(target(), "utf8")

  if (options.tools !== undefined) {
    content = content.replace(/^tools: .*$/m, `tools: ${options.tools}`)
  }
  if (options.model !== undefined) {
    content = content.replace(/^model: .*$/m, `model: ${options.model}`)
  }
  for (const [key, value] of Object.entries(options.extraKeys ?? {})) {
    content = content
      .replace(/^---$/m, "---")
      .replace(/^(name: .*)$/m, `$1\n${key}: ${value}`)
  }
  if (options.extraSection !== undefined) {
    content = `${content}\n${options.extraSection}`
  }
  if (options.preamble !== undefined) {
    content = content.replace(/あなたは gpt-sol。[^\n]*/, options.preamble)
  }
  if (options.replaceConstraints !== undefined) {
    content = content.replace(
      /## 制約\n\n[\s\S]*?(?=\n## )/,
      `## 制約\n\n${options.replaceConstraints}`
    )
  }

  fs.writeFileSync(target(), content)
}
