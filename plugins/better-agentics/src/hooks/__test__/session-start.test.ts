import fs from "node:fs"
import os from "node:os"
import path from "node:path"
import { afterEach, beforeEach, describe, expect, it } from "vitest"
import { contextOf, definition, ENABLED, place, runHook } from "./helpers/hook"

const INSTRUCTION =
  "最初に better-agentics:orchestration スキルを使用する。スキルの規律に従う。"
let project: string

beforeEach(() => {
  project = fs.mkdtempSync(path.join(os.tmpdir(), "better-agentics-"))
})

afterEach(() => {
  fs.rmSync(project, { recursive: true, force: true })
})

function writeConfig(dir: string): void {
  fs.mkdirSync(path.join(dir, ".claude", "better-agentics"), {
    recursive: true
  })
  fs.writeFileSync(
    path.join(dir, ".claude", "better-agentics", "config.json"),
    '{"disabledRoles":[]}'
  )
}

function run(env: NodeJS.ProcessEnv): string {
  return runHook("session-start", JSON.stringify({ cwd: project }), env)
}

describe("session-start", () => {
  it("off では何も出力しない", () => {
    expect(run({})).toBe("")
  })

  it("警告の状態では警告の 1 文だけを注入する", () => {
    const cases: NodeJS.ProcessEnv[] = [
      { AMATSUKA_AGENT_ENABLE_ORCHESTRATION: "yes" },
      { ...ENABLED, AMATSUKA_AGENT_AUTO_INJECTION: "claude" },
      { ...ENABLED, AMATSUKA_AGENT_DELEGATION_GATE: "1" },
      { AMATSUKA_AGENT_ENABLE_ORCHESTRATION: "1" }
    ]
    const expected = [
      /AMATSUKA_AGENT_ENABLE_ORCHESTRATION の値 "yes" は未知/,
      /AMATSUKA_AGENT_AUTO_INJECTION が同時に有効/,
      /AMATSUKA_AGENT_DELEGATION_GATE が有効/,
      /TYPESAFE_API_KEY が設定されていない/
    ]
    cases.forEach((env, index) => {
      const context = contextOf(run(env)) ?? ""
      expect(context).toMatch(expected[index] as RegExp)
      expect(context).not.toContain("better-agentics:orchestration")
      expect(context.split("\n")).toHaveLength(1)
    })
  })

  it("inject では使用指示を先頭に置き、定義が無ければ Standard Agent モードを案内する", () => {
    const context = contextOf(run(ENABLED)) ?? ""
    expect(context.startsWith(INSTRUCTION)).toBe(true)
    expect(context).toContain(
      "定義の無い役割は Standard Agent モードで委譲する。調整したい役割の定義と、外す役割は better-agentics:setup で決める。"
    )
  })

  it("警告と知らせを使用指示の後に並べる", () => {
    place(project, "a", definition("a", "code-review"))
    const context =
      contextOf(run({ ...ENABLED, CLAUDE_CODE_EFFORT_LEVEL: "high" })) ?? ""
    const parts = context.split("\n\n")
    expect(parts[0]).toBe(INSTRUCTION)
    expect(parts[1]).toContain("Standard Agent モード")
    expect(parts.at(-1)).toContain("CLAUDE_CODE_EFFORT_LEVEL")
  })

  it("同じ役割の定義が 2 件あれば役割名と定義名を並べる", () => {
    place(project, "a", definition("a", "code-review"))
    place(project, "b", definition("b", "code-review"))
    const context = contextOf(run(ENABLED)) ?? ""
    expect(context).toContain("- コードレビュー [code-review]: a, b")
    expect(context).not.toContain(
      "定義の無い役割は Standard Agent モードで委譲する。調整"
    )
  })

  it("役割表に無い role-id の定義を並べる", () => {
    place(project, "x", definition("x", "final-review"))
    expect(contextOf(run(ENABLED))).toContain("- x: final-review")
  })

  it("定義がそろっていれば使用指示だけを注入する", () => {
    place(project, "a", definition("a", "code-review"))
    writeConfig(project)
    expect(contextOf(run(ENABLED))).toBe(INSTRUCTION)
  })

  it("CLAUDE_PROJECT_DIR を stdin の cwd より優先する", () => {
    const other = fs.mkdtempSync(path.join(os.tmpdir(), "better-agentics-"))
    try {
      place(other, "a", definition("a", "code-review"))
      writeConfig(other)
      expect(contextOf(run({ ...ENABLED, CLAUDE_PROJECT_DIR: other }))).toBe(
        INSTRUCTION
      )
    } finally {
      fs.rmSync(other, { recursive: true, force: true })
    }
  })

  it("SessionStart の形の JSON を 1 行で出す", () => {
    const output = run(ENABLED)
    expect(output.trimEnd().split("\n")).toHaveLength(1)
    expect(JSON.parse(output).hookSpecificOutput.hookEventName).toBe(
      "SessionStart"
    )
  })
})
