import { fileURLToPath } from "node:url"
import { expect, test } from "vitest"
import { runTs } from "../../testing/run-ts.js"

const HOOK = fileURLToPath(new URL("../session-start.ts", import.meta.url))

function environment(overrides: NodeJS.ProcessEnv): NodeJS.ProcessEnv {
  const base: NodeJS.ProcessEnv = { ...process.env }
  for (const key of Object.keys(base)) {
    if (key.startsWith("AMATSUKA_AGENT_")) delete base[key]
  }
  delete base.CLAUDE_PROJECT_DIR
  return { ...base, ...overrides }
}

function context(overrides: NodeJS.ProcessEnv): string | undefined {
  const stdout = runTs(HOOK, [], { env: environment(overrides) })
  if (stdout === "") return undefined
  expect(stdout.endsWith("\n")).toBe(true)
  const payload = JSON.parse(stdout) as {
    hookSpecificOutput: { hookEventName: string; additionalContext: string }
  }
  expect(payload.hookSpecificOutput.hookEventName).toBe("SessionStart")
  return payload.hookSpecificOutput.additionalContext
}

test("環境変数が無いときは何も出力しない", () => {
  expect(context({})).toBeUndefined()
})

test("AUTO_INJECTION が none のときは何も出力しない", () => {
  expect(context({ AMATSUKA_AGENT_AUTO_INJECTION: "none" })).toBeUndefined()
})

test.each([
  ["claude", "claude-model-policy"],
  ["with-codex", "with-codex-policy"],
  ["with-grok", "with-grok-policy"],
  ["with-codex-grok", "codex-grok-policy"]
])("AUTO_INJECTION が %s のとき %s を注入する", (value, policy) => {
  expect(context({ AMATSUKA_AGENT_AUTO_INJECTION: value })).toBe(
    `最初に必ず agent-policy:${policy} スキルを使用し、この規律に従う`
  )
})

test("AUTO_INJECTION が未知の値のときは方針を注入せず警告だけ出す", () => {
  const injected = context({ AMATSUKA_AGENT_AUTO_INJECTION: "with-gemini" })
  expect(injected).toContain("with-gemini")
  expect(injected).not.toContain("スキルを使用し")
})
