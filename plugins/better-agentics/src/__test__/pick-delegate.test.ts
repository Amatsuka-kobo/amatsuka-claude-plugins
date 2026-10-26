import fs from "node:fs"
import os from "node:os"
import path from "node:path"
import { fileURLToPath } from "node:url"
import { afterEach, beforeEach, describe, expect, it } from "vitest"
import { definition, environment, place } from "../hooks/__test__/helpers/hook"
import { runTs } from "../testing/run-ts"

const SCRIPT = fileURLToPath(new URL("../pick-delegate.ts", import.meta.url))
let project: string

beforeEach(() => {
  project = fs.mkdtempSync(path.join(os.tmpdir(), "better-agentics-"))
})

afterEach(() => {
  fs.rmSync(project, { recursive: true, force: true })
})

function run(input: string, env: NodeJS.ProcessEnv = {}): unknown {
  const output = runTs(SCRIPT, ["--dir", project], {
    input,
    env: environment(env),
    encoding: "utf8"
  })
  expect(output.trimEnd().split("\n")).toHaveLength(1)
  return JSON.parse(output)
}

describe("pick-delegate", () => {
  it("stdin の JSON を読み、--dir の定義から委譲先を返す", () => {
    place(project, "lead", definition("lead", "escalation"))
    expect(
      run(JSON.stringify({ reason: "stuck", task: { summary: "x" } }))
    ).toEqual({
      ok: true,
      reason: "stuck",
      agents: [{ agent: "lead", role: "escalation" }]
    })
  })

  it("CLAUDE_PROJECT_DIR を --dir より優先する", () => {
    const other = fs.mkdtempSync(path.join(os.tmpdir(), "better-agentics-"))
    try {
      place(other, "other-lead", definition("other-lead", "escalation"))
      place(project, "lead", definition("lead", "escalation"))
      expect(
        run(JSON.stringify({ reason: "stuck", task: { summary: "x" } }), {
          CLAUDE_PROJECT_DIR: other
        })
      ).toMatchObject({ agents: [{ agent: "other-lead" }] })
    } finally {
      fs.rmSync(other, { recursive: true, force: true })
    }
  })

  it("不正な JSON でも終了コード 0 で invalid-input を返す", () => {
    expect(run("{")).toMatchObject({ ok: false, error: "invalid-input" })
  })

  it("キーが空白だけで Jev が要るときは no-api-key を返す", () => {
    place(project, "a", definition("a", "code-review"))
    place(project, "b", definition("b", "design-review"))
    expect(
      run(
        JSON.stringify({
          reason: "review",
          task: { summary: "x", artifacts: [] }
        }),
        { TYPESAFE_API_KEY: "   " }
      )
    ).toMatchObject({ ok: false, error: "no-api-key" })
  })
})
