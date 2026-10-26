import { execFileSync } from "node:child_process"
import fs from "node:fs"
import { createRequire } from "node:module"
import os from "node:os"
import path from "node:path"
import { fileURLToPath } from "node:url"
import { afterEach, beforeEach, describe, expect, it } from "vitest"
import {
  contextOf,
  definition,
  ENABLED,
  environment,
  PLUGIN_ROOT,
  place,
  runHook
} from "./helpers/hook"

const POLICY = fs.readFileSync(
  path.join(PLUGIN_ROOT, "references", "subagent-policy.md"),
  "utf8"
)
let project: string

beforeEach(() => {
  project = fs.mkdtempSync(path.join(os.tmpdir(), "better-agentics-"))
})

afterEach(() => {
  fs.rmSync(project, { recursive: true, force: true })
})

function run(agentType: string, env: NodeJS.ProcessEnv): string {
  return runHook(
    "subagent-start",
    JSON.stringify({ agent_type: agentType, cwd: project }),
    env
  )
}

describe("subagent-start", () => {
  it("name が一致する better-agentics の定義に規律の全文を注入する", () => {
    place(project, "docs-check", definition("docs-reviewer", "design-review"))
    const output = run("docs-reviewer", ENABLED)
    expect(contextOf(output)).toBe(POLICY)
    expect(JSON.parse(output).hookSpecificOutput.hookEventName).toBe(
      "SubagentStart"
    )
  })

  it("キーが無い状態でも注入する", () => {
    place(project, "a", definition("a", "explore"))
    expect(
      contextOf(run("a", { AMATSUKA_AGENT_ENABLE_ORCHESTRATION: "1" }))
    ).toBe(POLICY)
  })

  it("規律を注入しない状態では何も出力しない", () => {
    place(project, "a", definition("a", "explore"))
    for (const env of [
      {},
      { ...ENABLED, AMATSUKA_AGENT_AUTO_INJECTION: "claude" },
      { ...ENABLED, AMATSUKA_AGENT_DELEGATION_GATE: "on" },
      { AMATSUKA_AGENT_ENABLE_ORCHESTRATION: "yes" }
    ]) {
      expect(run("a", env)).toBe("")
    }
  })

  it("マーカーの無い定義・定義ディレクトリが無い・一致しない名前では何も出力しない", () => {
    expect(run("a", ENABLED)).toBe("")
    place(project, "a", ["---", "name: a", "---", ""])
    expect(run("a", ENABLED)).toBe("")
    place(project, "b", definition("b", "explore"))
    expect(run("docs-check", ENABLED)).toBe("")
  })

  it("stdin が JSON でなければ標準エラーに書いて終了コード 0 で終わる", () => {
    const tsx = createRequire(import.meta.url).resolve("tsx/cli")
    const script = fileURLToPath(
      new URL("../subagent-start.ts", import.meta.url)
    )
    const result = execFileSync(process.execPath, [tsx, script], {
      input: "not json",
      env: environment(ENABLED),
      encoding: "utf8",
      stdio: ["pipe", "pipe", "pipe"]
    })
    expect(result).toBe("")
  })

  it("規律の文字数は additionalContext の上限 10,000 未満である", () => {
    expect([...POLICY].length).toBeLessThan(10_000)
  })
})
