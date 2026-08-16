import fs from "node:fs"
import os from "node:os"
import path from "node:path"
import { fileURLToPath } from "node:url"
import { expect, test } from "vitest"
import { runTs } from "../../testing/run-ts.js"

const HOOK = fileURLToPath(new URL("../session-start.ts", import.meta.url))

const PLUGIN_ROOT = fileURLToPath(new URL("../../../", import.meta.url))

function project(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), "agent-policy-hook-"))
}

function generated(dir: string, name: string): string {
  return fs.readFileSync(
    path.join(dir, ".claude", "agents", `${name}.md`),
    "utf8"
  )
}

function place(dir: string, name: string, content: string): void {
  const target = path.join(dir, ".claude", "agents")
  fs.mkdirSync(target, { recursive: true })
  fs.writeFileSync(path.join(target, `${name}.md`), content)
}

function listing(dir: string): string[] {
  try {
    return fs.readdirSync(path.join(dir, ".claude", "agents")).sort()
  } catch {
    return []
  }
}

function environment(overrides: NodeJS.ProcessEnv): NodeJS.ProcessEnv {
  const base: NodeJS.ProcessEnv = { ...process.env }
  for (const key of Object.keys(base)) {
    if (key.startsWith("AMATSUKA_AGENT_")) delete base[key]
  }
  delete base.CLAUDE_PROJECT_DIR
  return { ...base, CLAUDE_PLUGIN_ROOT: PLUGIN_ROOT, ...overrides }
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

test("エイリアスが既定と同じときは何も生成しない", () => {
  const dir = project()
  const injected = context({
    CLAUDE_PROJECT_DIR: dir,
    AMATSUKA_AGENT_GPT_SOL_ALIAS: "claude-gpt-5-6-sol"
  })
  expect(injected).toBeUndefined()
  expect(listing(dir)).toEqual([])
})

test("エイリアスが既定と違うときは該当定義だけを生成する", () => {
  const dir = project()
  const injected = context({
    CLAUDE_PROJECT_DIR: dir,
    AMATSUKA_AGENT_GPT_SOL_ALIAS: "my-sol"
  })
  expect(listing(dir)).toEqual(["gpt-sol.md"])
  expect(generated(dir, "gpt-sol")).toContain("model: my-sol")
  expect(generated(dir, "gpt-sol")).not.toContain("claude-gpt-5-6-sol")
  expect(injected).toContain("gpt-sol")
  expect(injected).toContain("再起動")
})

test("TERRA のエイリアス変更は gpt-terra と gpt-researcher の両方を生成する", () => {
  const dir = project()
  context({
    CLAUDE_PROJECT_DIR: dir,
    AMATSUKA_AGENT_GPT_TERRA_ALIAS: "my-terra"
  })
  expect(listing(dir)).toEqual(["gpt-researcher.md", "gpt-terra.md"])
  expect(generated(dir, "gpt-researcher")).toContain("model: my-terra")
})

test("GROK のエイリアス変更は grok の 2 定義を生成する", () => {
  const dir = project()
  context({
    CLAUDE_PROJECT_DIR: dir,
    AMATSUKA_AGENT_GROK_ALIAS: "my-grok"
  })
  expect(listing(dir)).toEqual(["grok-implementer.md", "grok-researcher.md"])
})

test("同一内容が既にあるときは書き込まず再起動も促さない", () => {
  const dir = project()
  context({ CLAUDE_PROJECT_DIR: dir, AMATSUKA_AGENT_GPT_SOL_ALIAS: "my-sol" })
  const first = fs.statSync(
    path.join(dir, ".claude", "agents", "gpt-sol.md")
  ).mtimeMs

  const injected = context({
    CLAUDE_PROJECT_DIR: dir,
    AMATSUKA_AGENT_GPT_SOL_ALIAS: "my-sol"
  })
  const second = fs.statSync(
    path.join(dir, ".claude", "agents", "gpt-sol.md")
  ).mtimeMs

  expect(second).toBe(first)
  expect(injected).toContain("gpt-sol")
  expect(injected).not.toContain("再起動")
})

test("差分が無いのに定義が置かれているときは残骸として通知する", () => {
  const dir = project()
  place(dir, "grok-researcher", "---\nname: grok-researcher\n---\n")
  const injected = context({ CLAUDE_PROJECT_DIR: dir })
  expect(injected).toContain("grok-researcher")
  expect(injected).toContain("旧セットアップ")
})

test("CLAUDE_PROJECT_DIR が無いときは生成せず注入だけ行う", () => {
  const injected = context({
    AMATSUKA_AGENT_AUTO_INJECTION: "claude",
    AMATSUKA_AGENT_GPT_SOL_ALIAS: "my-sol"
  })
  expect(injected).toBe(
    "最初に必ず agent-policy:claude-model-policy スキルを使用し、この規律に従う"
  )
})

test("エイリアスの前後の空白は無視する", () => {
  const dir = project()
  const injected = context({
    CLAUDE_PROJECT_DIR: dir,
    AMATSUKA_AGENT_GPT_SOL_ALIAS: " claude-gpt-5-6-sol ",
    AMATSUKA_AGENT_GPT_LUNA_ALIAS: " my-luna "
  })
  expect(listing(dir)).toEqual(["gpt-luna.md"])
  expect(generated(dir, "gpt-luna")).toContain("model: my-luna\n")
  expect(injected).not.toContain("gpt-sol")
})

test("エイリアス 4 変数を全て変えても生成対象は 6 定義に限られる", () => {
  const dir = project()
  context({
    CLAUDE_PROJECT_DIR: dir,
    AMATSUKA_AGENT_GPT_SOL_ALIAS: "my-sol",
    AMATSUKA_AGENT_GPT_TERRA_ALIAS: "my-terra",
    AMATSUKA_AGENT_GPT_LUNA_ALIAS: "my-luna",
    AMATSUKA_AGENT_GROK_ALIAS: "my-grok"
  })
  expect(listing(dir)).toEqual([
    "gpt-luna.md",
    "gpt-researcher.md",
    "gpt-sol.md",
    "gpt-terra.md",
    "grok-implementer.md",
    "grok-researcher.md"
  ])
  expect(listing(dir)).not.toContain("claude-researcher.md")
})

test("生成に失敗しても方針注入は失われない", () => {
  const dir = project()
  const injected = context({
    CLAUDE_PROJECT_DIR: dir,
    CLAUDE_PLUGIN_ROOT: path.join(dir, "missing"),
    AMATSUKA_AGENT_AUTO_INJECTION: "claude",
    AMATSUKA_AGENT_GPT_SOL_ALIAS: "my-sol"
  })
  expect(injected).toContain(
    "最初に必ず agent-policy:claude-model-policy スキルを使用し、この規律に従う"
  )
  expect(injected).toContain("生成に失敗")
  expect(injected).toContain("gpt-sol")
  expect(listing(dir)).toEqual([])
})

test("同梱定義が読めないときは stdout へ何も出さない", () => {
  const dir = project()
  const stdout = runTs(HOOK, [], {
    env: environment({
      CLAUDE_PROJECT_DIR: dir,
      CLAUDE_PLUGIN_ROOT: path.join(dir, "missing"),
      AMATSUKA_AGENT_GPT_SOL_ALIAS: "my-sol"
    })
  })
  expect(stdout).toBe("")
})
