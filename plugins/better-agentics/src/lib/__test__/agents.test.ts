import fs from "node:fs"
import os from "node:os"
import path from "node:path"
import { fileURLToPath } from "node:url"
import { afterEach, beforeEach, describe, expect, it } from "vitest"
import { inspect, projectDirOf, scanDefinitions } from "../agents"

const FIXTURE = fileURLToPath(
  new URL("../../fixtures/project", import.meta.url)
)
let project: string

beforeEach(() => {
  project = fs.mkdtempSync(path.join(os.tmpdir(), "better-agentics-"))
})

afterEach(() => {
  fs.rmSync(project, { recursive: true, force: true })
})

function place(file: string, lines: string[]): void {
  const dir = path.join(project, ".claude", "agents")
  fs.mkdirSync(dir, { recursive: true })
  fs.writeFileSync(path.join(dir, `${file}.md`), lines.join("\n"))
}

function byFile(file: string) {
  return scanDefinitions(FIXTURE).find((entry) => entry.file === file)
}

describe("scanDefinitions", () => {
  it("better-agentics-role を持つ定義だけを file の昇順で返す", () => {
    expect(scanDefinitions(FIXTURE).map((entry) => entry.file)).toEqual([
      "block-tools",
      "code-reviewer",
      "docs-check",
      "no-criteria",
      "no-tools",
      "twice",
      "unknown-role"
    ])
  })

  it("name はファイル名でなく frontmatter の値を使う", () => {
    expect(byFile("docs-check")).toMatchObject({
      name: "docs-reviewer",
      role: "design-review",
      model: "opus"
    })
  })

  it("When to invoke が無ければ空文字、2 回あれば最初の配下を返す", () => {
    expect(byFile("no-criteria")?.whenToInvoke).toBe("")
    expect(byFile("twice")?.whenToInvoke).toBe("- first")
    expect(byFile("code-reviewer")?.whenToInvoke).toBe(
      "- Use when reading a change diff."
    )
  })

  it("tools の書式を判定し、block 配列も配列として読む", () => {
    expect(byFile("block-tools")).toMatchObject({
      tools: ["Read", "Grep"],
      toolsFormat: "other"
    })
    expect(byFile("code-reviewer")).toMatchObject({
      tools: ["Read", "Grep", "Glob", "Bash"],
      toolsFormat: "csv",
      effort: "high"
    })
    expect(byFile("no-tools")).toMatchObject({
      tools: undefined,
      toolsFormat: "none"
    })
  })

  it(".claude/agents が無ければ空を返す", () => {
    expect(scanDefinitions(project)).toEqual([])
  })

  it("frontmatter が閉じていない定義は飛ばし、他の定義は返す", () => {
    place("broken", ["---", "name: broken", "better-agentics-role: explore"])
    place("ok", ["---", "name: ok", "better-agentics-role: explore", "---", ""])
    expect(scanDefinitions(project).map((entry) => entry.file)).toEqual(["ok"])
  })
})

describe("引用符付きの name", () => {
  it("name の引用符を外して読む", () => {
    place("q", [
      "---",
      'name: "quoted"',
      "better-agentics-role: explore",
      "---",
      ""
    ])
    place("s", [
      "---",
      "name: 'single'",
      "better-agentics-role: code-review",
      "---",
      ""
    ])
    expect(scanDefinitions(project).map((entry) => entry.name)).toEqual([
      "quoted",
      "single"
    ])
  })
})

describe("inspect", () => {
  it("役割表に無い role-id を unknownRoles に入れ、known に入れない", () => {
    const result = inspect(scanDefinitions(FIXTURE))
    expect(result.unknownRoles).toEqual([
      { file: "unknown-role", name: "unknown-role", role: "final-review" }
    ])
    expect(result.known.map((entry) => entry.file)).not.toContain(
      "unknown-role"
    )
    expect(result.duplicates).toEqual([])
  })

  it("同じ役割を 2 件以上が持つと duplicates に入る", () => {
    for (const name of ["a", "b"]) {
      place(name, [
        "---",
        `name: ${name}`,
        "better-agentics-role: code-review",
        "---",
        ""
      ])
    }
    expect(inspect(scanDefinitions(project)).duplicates).toEqual([
      { role: "code-review", names: ["a", "b"] }
    ])
  })
})

describe("projectDirOf", () => {
  it("CLAUDE_PROJECT_DIR を優先し、空なら fallback を使う", () => {
    expect(projectDirOf({ CLAUDE_PROJECT_DIR: "/a" }, "/b")).toBe("/a")
    expect(projectDirOf({ CLAUDE_PROJECT_DIR: "" }, "/b")).toBe("/b")
    expect(projectDirOf({}, "/b")).toBe("/b")
  })
})
