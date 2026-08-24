import fs from "node:fs"
import os from "node:os"
import path from "node:path"
import { fileURLToPath } from "node:url"
import { afterEach, beforeEach, describe, expect, it } from "vitest"
import { runTs } from "../../testing/run-ts.js"

const HOOK = fileURLToPath(new URL("../session-start.ts", import.meta.url))
const PLUGIN_ROOT = fileURLToPath(new URL("../../../", import.meta.url))

let project: string

beforeEach(() => {
  project = fs.mkdtempSync(path.join(os.tmpdir(), "agent-policy-"))
})

afterEach(() => {
  fs.rmSync(project, { recursive: true, force: true })
})

function agentsDir(): string {
  const dir = path.join(project, ".claude", "agents")
  fs.mkdirSync(dir, { recursive: true })
  return dir
}

function place(name: string, frontmatter: string[]): void {
  fs.writeFileSync(
    path.join(agentsDir(), `${name}.md`),
    ["---", `name: ${name}`, ...frontmatter, "---", "", "本文", ""].join("\n")
  )
}

function environment(overrides: NodeJS.ProcessEnv): NodeJS.ProcessEnv {
  const base: NodeJS.ProcessEnv = { ...process.env }
  for (const key of Object.keys(base)) {
    if (key.startsWith("AMATSUKA_AGENT_")) delete base[key]
  }
  delete base.CLAUDE_PROJECT_DIR
  return { ...base, CLAUDE_PLUGIN_ROOT: PLUGIN_ROOT, ...overrides }
}

function context(env: Record<string, string> = {}): string {
  const output = runTs(HOOK, [], {
    env: environment({ CLAUDE_PROJECT_DIR: project, ...env })
  }).trim()
  if (output === "") return ""
  const parsed = JSON.parse(output.split("\n").at(-1) ?? "{}")
  return parsed.hookSpecificOutput?.additionalContext ?? ""
}

function listFiles(): string[] {
  const dir = path.join(project, ".claude", "agents")
  return fs.existsSync(dir) ? fs.readdirSync(dir).sort() : []
}

describe("方針の注入", () => {
  it("値が未設定なら何も出さない", () => {
    expect(context()).toBe("")
  })

  it("既知の値で方針スキルを指す", () => {
    expect(context({ AMATSUKA_AGENT_AUTO_INJECTION: "with-codex" })).toContain(
      "agent-policy:with-codex-policy"
    )
    expect(
      context({ AMATSUKA_AGENT_AUTO_INJECTION: "with-codex-grok" })
    ).toContain("agent-policy:codex-grok-policy")
  })

  it("未知の値では方針を指さず、未知である旨だけを出す", () => {
    const output = context({ AMATSUKA_AGENT_AUTO_INJECTION: "bogus" })
    expect(output).toContain("bogus")
    expect(output).not.toContain("スキルを使用し")
  })
})

describe("ファイルを書かない", () => {
  it("エイリアス差分があっても定義を生成しない", () => {
    expect(context({ AMATSUKA_AGENT_GPT_SOL_ALIAS: "my-sol" })).not.toBe(
      undefined
    )
    expect(listFiles()).toEqual([])
  })

  it("役割マーカーを読んでもファイルを増やさない", () => {
    place("my-agent", ["agent-policy-role: complex-impl"])
    context()
    expect(listFiles()).toEqual(["my-agent.md"])
  })
})

describe("役割マーカーの走査", () => {
  it("帯 → 名前の対応を注入する", () => {
    place("my-heavy", ["agent-policy-role: complex-impl, explore"])
    const output = context()
    expect(output).toContain("my-heavy")
    expect(output).toContain("複雑または重要な実装")
    expect(output).toContain("コードベース探索実働")
  })

  it("同じ役割を複数定義が宣言したとき全て列挙する", () => {
    place("first", ["agent-policy-role: normal-impl"])
    place("second", ["agent-policy-role: normal-impl"])
    const output = context()
    expect(output).toContain("first")
    expect(output).toContain("second")
  })

  it("未知の役割 ID を無視し、その旨を出す", () => {
    place("odd", ["agent-policy-role: no-such-role"])
    const output = context()
    expect(output).toContain("no-such-role")
    expect(output).toContain("odd")
  })

  it("プロジェクト側断片の役割 ID を label で解決する", () => {
    const roles = path.join(project, ".claude", "agent-policy", "roles")
    fs.mkdirSync(roles, { recursive: true })
    fs.writeFileSync(
      path.join(roles, "triage.md"),
      [
        "---",
        "id: triage",
        "label: 障害の切り分け",
        "description: 障害の切り分け",
        "tools: Read, Grep, Glob, Bash",
        "kind: readonly",
        "---",
        "",
        "## When to invoke",
        "",
        "- **切り分け。** 障害の原因を切り分けるとき。",
        ""
      ].join("\n")
    )
    place("triager", ["agent-policy-role: triage"])
    const output = context()
    expect(output).toContain("障害の切り分け")
    expect(output).toContain("triager")
    expect(output).not.toContain("未知の役割 ID")
  })

  it("マーカーの無い定義は対応表に出さない", () => {
    place("plain", ["model: sonnet"])
    expect(context()).not.toContain("plain")
  })

  it("同梱プリセットを走査しない", () => {
    // 走査を発火させるため、プロジェクト側に 1 件置く。
    place("dummy", ["agent-policy-role: explore"])
    const output = context()
    expect(output).toContain("コードベース探索実働")
    // 同梱 gpt-sol は complex-impl を宣言しているが、走査対象外なので出ない。
    expect(output).not.toContain("複雑または重要な実装")
  })
})

describe("setup の促し", () => {
  it("エイリアス差分があり定義が無いとき促す", () => {
    const output = context({ AMATSUKA_AGENT_GPT_SOL_ALIAS: "my-sol" })
    expect(output).toContain("setup-gpt")
    expect(output).toContain("gpt-sol")
  })

  it("エイリアス差分があり model が食い違うとき促す", () => {
    place("gpt-sol", ["model: claude-gpt-5-6-sol"])
    const output = context({ AMATSUKA_AGENT_GPT_SOL_ALIAS: "my-sol" })
    expect(output).toContain("setup-gpt")
  })

  it("エイリアス差分があり model も一致するとき促さない", () => {
    place("gpt-sol", ["model: my-sol"])
    const output = context({ AMATSUKA_AGENT_GPT_SOL_ALIAS: "my-sol" })
    expect(output).not.toContain("setup-gpt")
  })

  it("エイリアスが既定と同じなら促さない", () => {
    const output = context({ AMATSUKA_AGENT_GROK_ALIAS: "claude-grok-4-6" })
    expect(output).not.toContain("setup-grok")
  })
})

describe("旧定義の残骸通知", () => {
  it("廃止した 4 種を検出する", () => {
    for (const name of [
      "claude-researcher",
      "gpt-researcher",
      "grok-researcher",
      "grok-implementer"
    ]) {
      place(name, ["model: sonnet"])
    }
    const output = context()
    expect(output).toContain("claude-researcher")
    expect(output).toContain("grok-implementer")
    expect(output).toContain("廃止")
  })

  it("現行のプリセット名は残骸として扱わない", () => {
    place("gpt-sol", ["model: claude-gpt-5-6-sol"])
    expect(context()).not.toContain("廃止")
  })
})

describe("フェイルオープン", () => {
  it("CLAUDE_PROJECT_DIR が無いとき走査せず方針だけ出す", () => {
    const output = runTs(HOOK, [], {
      env: environment({ AMATSUKA_AGENT_AUTO_INJECTION: "claude" })
    }).trim()
    expect(output).toContain("claude-model-policy")
  })

  it("壊れた symlink があっても方針を注入する", () => {
    fs.symlinkSync(
      "/nonexistent/agent-policy-target.md",
      path.join(agentsDir(), "broken.md")
    )

    const output = context({ AMATSUKA_AGENT_AUTO_INJECTION: "with-codex" })
    expect(output).toContain("agent-policy:with-codex-policy")
  })

  it("壊れた symlink があっても正常な定義の役割マーカーを拾う", () => {
    fs.symlinkSync(
      "/nonexistent/agent-policy-target.md",
      path.join(agentsDir(), "broken.md")
    )
    place("healthy", ["agent-policy-role: explore"])

    const output = context()
    expect(output).toContain("healthy")
    expect(output).toContain("コードベース探索実働")
  })
})
