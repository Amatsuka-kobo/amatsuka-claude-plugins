import { spawn, spawnSync } from "node:child_process"
import fs from "node:fs"
import { createRequire } from "node:module"
import os from "node:os"
import path from "node:path"
import { fileURLToPath } from "node:url"
import { afterEach, beforeEach, describe, expect, it } from "vitest"
import { runTs } from "../../testing/run-ts.js"
import { markerTable, scanAgents } from "../marker-scan"

const HOOK = fileURLToPath(new URL("../subagent-start.ts", import.meta.url))
const SESSION_HOOK = fileURLToPath(
  new URL("../session-start.ts", import.meta.url)
)
const PLUGIN_ROOT = fileURLToPath(new URL("../../../", import.meta.url))
const TSX_CLI = createRequire(import.meta.url).resolve("tsx/cli")
const TABLE_INTRO =
  "次の Agent は役割マーカーを宣言している。担当表の該当する帯は、これらを優先して使う。同じ帯に複数あるときは依頼内容に近いものを選ぶ。"

const ROLE_IDS = [
  "complex-impl",
  "normal-impl",
  "light-impl",
  "escalation",
  "general",
  "explore",
  "realtime-research",
  "e2e-verify",
  "independent-review",
  "doc-review",
  "code-review",
  "final-review",
  "gate-review",
  "advisor"
] as const

let project: string

beforeEach(() => {
  project = fs.mkdtempSync(path.join(os.tmpdir(), "agent-policy-substart-"))
})

afterEach(() => {
  fs.rmSync(project, { recursive: true, force: true })
})

function agentsDir(): string {
  const dir = path.join(project, ".claude", "agents")
  fs.mkdirSync(dir, { recursive: true })
  return dir
}

function place(
  name: string,
  frontmatter: string[],
  fileName: string = name
): void {
  fs.writeFileSync(
    path.join(agentsDir(), `${fileName}.md`),
    ["---", `name: ${name}`, ...frontmatter, "---", "", "本文", ""].join("\n")
  )
}

function placeBulkyRoleTable(): void {
  for (const [roleIndex, role] of ROLE_IDS.entries()) {
    for (let agentIndex = 0; agentIndex < 8; agentIndex += 1) {
      const name = `marked-${roleIndex}-${agentIndex}-${"x".repeat(128)}`
      place(name, ["tools: Read, Agent", `agent-policy-role: ${role}`])
    }
  }
}

function environment(
  overrides: NodeJS.ProcessEnv = {},
  unset: string[] = []
): NodeJS.ProcessEnv {
  const base: NodeJS.ProcessEnv = { ...process.env }
  for (const key of Object.keys(base)) {
    if (key.startsWith("AMATSUKA_AGENT_")) delete base[key]
  }
  delete base.CLAUDE_PROJECT_DIR
  delete base.CLAUDE_PLUGIN_ROOT

  const env: NodeJS.ProcessEnv = {
    ...base,
    CLAUDE_PLUGIN_ROOT: PLUGIN_ROOT,
    CLAUDE_PROJECT_DIR: project,
    ...overrides
  }
  for (const key of unset) delete env[key]
  return env
}

function invoke(
  agentType: unknown,
  envOverrides: NodeJS.ProcessEnv = {},
  unset: string[] = []
): string {
  return runTs(HOOK, [], {
    env: environment(envOverrides, unset),
    input: JSON.stringify({
      hook_event_name: "SubagentStart",
      agent_type: agentType,
      cwd: path.join(project, "ignored-cwd")
    })
  })
}

function invokeInput(
  input: string,
  envOverrides: NodeJS.ProcessEnv = {},
  unset: string[] = []
): string {
  return runTs(HOOK, [], {
    env: environment(envOverrides, unset),
    input
  })
}

function additionalContext(stdout: string): string {
  const parsed = JSON.parse(stdout.trim())
  return parsed.hookSpecificOutput?.additionalContext ?? ""
}

function sessionContext(policy: string): string {
  const stdout = runTs(SESSION_HOOK, [], {
    env: environment({ AMATSUKA_AGENT_AUTO_INJECTION: policy })
  }).trim()
  const parsed = JSON.parse(stdout.split("\n").at(-1) ?? "{}")
  return parsed.hookSpecificOutput?.additionalContext ?? ""
}

function tableBlock(context: string): string {
  const start = context.indexOf(TABLE_INTRO)
  if (start < 0) return ""
  return context.slice(start).split("\n\n", 1)[0] ?? ""
}

describe("定義照合と deny-list", () => {
  it("tools に Agent が無い project 定義には注入しない", () => {
    place("without-agent", ["tools: Read, Bash"])

    expect(invoke("without-agent")).toBe("")
  })

  it("tools に Agent を含む project 定義には注入する", () => {
    place("with-agent", ["tools: Read, Agent"])

    expect(additionalContext(invoke("with-agent"))).toContain(
      "あなたはサブエージェントである"
    )
  })

  it("tools 欄が無い project 定義には注入する", () => {
    place("inherited-tools", [])

    expect(additionalContext(invoke("inherited-tools"))).toContain(
      "あなたはサブエージェントである"
    )
  })

  it("未知の agent_type には注入する", () => {
    expect(additionalContext(invoke("unknown-agent"))).toContain(
      "あなたはサブエージェントである"
    )
  })

  it.each(["Explore", "Plan"])("ビルトイン %s には注入しない", (type) => {
    expect(invoke(type)).toBe("")
  })

  it("完全形一致を末段一致より優先する", () => {
    place("agent-policy:worker", ["tools: Read"], "exact")
    place("worker", ["tools: Read, Agent"], "suffix")

    expect(invoke("agent-policy:worker")).toBe("")
  })

  it("末段一致が複数の定義に当たるときは注入する", () => {
    place("shared", ["tools: Read"], "first")
    place("shared", ["tools: Bash"], "second")

    expect(additionalContext(invoke("vendor:shared"))).toContain(
      "あなたはサブエージェントである"
    )
  })

  it("block 配列の tools に Agent が無い project 定義には注入しない", () => {
    place("block-tools", ["tools:", "  - Read", "  - Bash"])

    expect(invoke("block-tools")).toBe("")
  })
})

describe("断片の合成", () => {
  it("サブエージェント宣言と対応表を含み policy スキル名を含まない", () => {
    place("marked", ["tools: Read, Agent", "agent-policy-role: complex-impl"])

    const context = additionalContext(
      invoke("marked", { AMATSUKA_AGENT_AUTO_INJECTION: "custom" })
    )
    expect(context).toContain("あなたはサブエージェントである")
    expect(context).toContain(TABLE_INTRO)
    expect(context).not.toContain("agent-policy:")
    expect(context).not.toMatch(/[A-Za-z0-9:-]+-policy\\b/)
  })

  it("アドバイザーは対応表を優先する規律を含む", () => {
    const context = additionalContext(invoke("unknown-agent"))

    expect(context).toContain(
      "対応表の「設計・計画・実装のアドバイザー」の帯の定義を使う"
    )
  })

  it("custom 系で marker が 0 件なら対応表なしの固定文を含める", () => {
    const context = additionalContext(
      invoke("unknown-agent", { AMATSUKA_AGENT_AUTO_INJECTION: "custom" })
    )

    expect(context).toContain(
      "対応表なし(このプロジェクトに役割マーカー付き定義は無い)"
    )
  })

  it("marker 行が無い断片の後ろへ空行 1 つで対応表を連結する", () => {
    const customRoot = path.join(project, "markerless-plugin")
    fs.mkdirSync(path.join(customRoot, "references"), { recursive: true })
    fs.writeFileSync(
      path.join(customRoot, "references", "subagent-discipline.md"),
      "# Custom discipline\n\n"
    )

    const context = additionalContext(
      invoke("unknown-agent", { CLAUDE_PLUGIN_ROOT: customRoot })
    )
    expect(context).toBe(
      `# Custom discipline\n\n対応表なし(このプロジェクトに役割マーカー付き定義は無い)`
    )
  })

  it("断片ファイルが読めないときは対応表だけを注入する", () => {
    place("marked", ["tools: Read, Agent", "agent-policy-role: complex-impl"])
    const missingRoot = path.join(project, "fragmentless-plugin")
    const env = environment({
      CLAUDE_PLUGIN_ROOT: missingRoot,
      AMATSUKA_AGENT_AUTO_INJECTION: "custom"
    })
    const expected = markerTable(env, scanAgents(agentsDir()))
    if (expected === undefined) throw new Error("marker table fixture is empty")

    const context = additionalContext(
      invoke("unknown-agent", {
        CLAUDE_PLUGIN_ROOT: missingRoot,
        AMATSUKA_AGENT_AUTO_INJECTION: "custom"
      })
    )
    expect(context).toBe(expected)
  })

  it("CLAUDE_PLUGIN_ROOT が未設定でも throw せず exit 0", () => {
    expect(() =>
      invoke("unknown-agent", {}, ["CLAUDE_PLUGIN_ROOT"])
    ).not.toThrow()
  })

  it("CLAUDE_PROJECT_DIR が未設定でも project 走査なしで注入を続ける", () => {
    const context = additionalContext(
      invoke("unknown-agent", {}, ["CLAUDE_PROJECT_DIR"])
    )

    expect(context).toContain("あなたはサブエージェントである")
    expect(context).toContain("対応表なし")
  })

  it("custom 系 policy env で SessionStart と同一の対応表を注入する", () => {
    place("implementer", [
      "tools: Read, Agent",
      "agent-policy-role: complex-impl"
    ])
    place("advisor", ["tools: Read, Agent", "agent-policy-role: advisor"])

    for (const policy of ["custom", "with-codex-grok"]) {
      const env = { AMATSUKA_AGENT_AUTO_INJECTION: policy }
      const sessionTable = tableBlock(sessionContext(policy))
      const subagentTable = tableBlock(
        additionalContext(invoke("unknown", env))
      )

      expect(sessionTable).not.toBe("")
      expect(subagentTable).toBe(sessionTable)
    }
  })
})

describe("対応表の injection 判定", () => {
  it.each([
    "custom",
    "with-codex",
    "with-grok",
    "with-codex-grok"
  ])("custom 系の %s では対応表を合成する", (policy) => {
    place("marked", ["tools: Read, Agent", "agent-policy-role: complex-impl"])

    expect(
      additionalContext(
        invoke("unknown-agent", { AMATSUKA_AGENT_AUTO_INJECTION: policy })
      )
    ).toContain(TABLE_INTRO)
  })

  it.each([
    ["none", { AMATSUKA_AGENT_AUTO_INJECTION: "none" }],
    ["claude", { AMATSUKA_AGENT_AUTO_INJECTION: "claude" }],
    ["未設定", {}],
    ["空文字", { AMATSUKA_AGENT_AUTO_INJECTION: "" }],
    ["未知の値", { AMATSUKA_AGENT_AUTO_INJECTION: "unexpected" }]
  ])("%s では対応表なしの固定文を合成する", (_label, env) => {
    place("marked", ["tools: Read, Agent", "agent-policy-role: complex-impl"])

    const context = additionalContext(invoke("unknown-agent", env))
    expect(context).toContain(
      "対応表なし(このプロジェクトに役割マーカー付き定義は無い)"
    )
    expect(context).not.toContain(TABLE_INTRO)
  })

  it.each([
    "Custom",
    " with-codex-grok "
  ])("%s を正規化して対応表を合成する", (policy) => {
    place("marked", ["tools: Read, Agent", "agent-policy-role: complex-impl"])

    expect(
      additionalContext(
        invoke("unknown-agent", { AMATSUKA_AGENT_AUTO_INJECTION: policy })
      )
    ).toContain(TABLE_INTRO)
  })

  it.each(["custom", "none"])("%s の分岐でも規律断片を配布する", (policy) => {
    place("marked", ["tools: Read, Agent", "agent-policy-role: complex-impl"])

    expect(
      additionalContext(
        invoke("unknown-agent", { AMATSUKA_AGENT_AUTO_INJECTION: policy })
      )
    ).toContain("あなたはサブエージェントである")
  })
})

describe("入力と出力", () => {
  it("stdin が不正な JSON なら exit 0 かつ stdout は空", () => {
    expect(invokeInput("not json")).toBe("")
  })

  it("stdin の JSON がオブジェクトでなければ exit 0 かつ stdout は空", () => {
    expect(invokeInput("[]")).toBe("")
  })

  it("EOF 済みの空入力は即座に parse 失敗として exit 0", () => {
    const result = spawnSync(process.execPath, [TSX_CLI, HOOK], {
      encoding: "utf8",
      env: environment(),
      input: ""
    })

    expect(result.status).toBe(0)
    expect(result.stdout).toBe("")
    expect(result.stderr).toContain("stdin parse failed")
    expect(result.stderr).not.toContain("stdin timeout")
  })

  it("EOF が来ないと 2 秒でタイムアウトして exit 0", async () => {
    const started = Date.now()
    const result = await new Promise<{
      code: number | null
      stdout: string
      stderr: string
    }>((resolve, reject) => {
      const child = spawn(process.execPath, [TSX_CLI, HOOK], {
        env: environment(),
        stdio: ["pipe", "pipe", "pipe"]
      })
      let stdout = ""
      let stderr = ""
      child.stdout.setEncoding("utf8")
      child.stdout.on("data", (chunk) => {
        stdout += chunk
      })
      child.stderr.setEncoding("utf8")
      child.stderr.on("data", (chunk) => {
        stderr += chunk
      })
      child.on("error", reject)
      child.on("close", (code) => resolve({ code, stdout, stderr }))
    })
    const elapsed = Date.now() - started

    expect(result.code).toBe(0)
    expect(result.stdout).toBe("")
    expect(result.stderr).toContain("stdin timeout")
    expect(elapsed).toBeGreaterThanOrEqual(1900)
    expect(elapsed).toBeLessThan(9000)
  })

  it("agent_type が欠落または空文字なら未知の type として注入する", () => {
    const missing = invokeInput(
      JSON.stringify({ hook_event_name: "SubagentStart", cwd: project })
    )
    const empty = invoke("")

    expect(additionalContext(missing)).toContain(
      "あなたはサブエージェントである"
    )
    expect(additionalContext(empty)).toContain("あなたはサブエージェントである")
  })

  it("stdout には改行終端された JSON を 1 つだけ出す", () => {
    const stdout = invoke("unknown-agent")
    const lines = stdout.split("\n")

    expect(lines).toHaveLength(2)
    expect(lines[1]).toBe("")
    expect(() => JSON.parse(lines[0] ?? "")).not.toThrow()
  })
})

describe("切り詰め", () => {
  it("複数役割の対応表を後方の役割行から削り先頭 2 行を完全に残す", () => {
    placeBulkyRoleTable()
    const env = environment({ AMATSUKA_AGENT_AUTO_INJECTION: "custom" })
    const fullTable = markerTable(env, scanAgents(agentsDir()))
    if (fullTable === undefined)
      throw new Error("marker table fixture is empty")
    expect(fullTable.length).toBeGreaterThan(9500)

    const missingRoot = path.join(project, "fragmentless-plugin")
    const context = additionalContext(
      invoke("unknown-agent", {
        CLAUDE_PLUGIN_ROOT: missingRoot,
        AMATSUKA_AGENT_AUTO_INJECTION: "custom"
      })
    )
    const fullLines = fullTable.split("\n")
    const fullRoleLines = fullLines.slice(1)
    const retainedRoleLines = context
      .split("\n")
      .filter((line) => line.startsWith("- "))
    const removedRoleLines = fullRoleLines.slice(retainedRoleLines.length)

    expect(context.length).toBeLessThanOrEqual(9500)
    expect(context.split("\n").slice(0, 2)).toEqual(fullLines.slice(0, 2))
    expect(retainedRoleLines.length).toBeGreaterThanOrEqual(2)
    expect(retainedRoleLines.length).toBeLessThan(fullRoleLines.length)
    expect(retainedRoleLines).toEqual(
      fullRoleLines.slice(0, retainedRoleLines.length)
    )
    expect(removedRoleLines.length).toBeGreaterThan(0)
    expect(fullRoleLines.indexOf(retainedRoleLines.at(-1) ?? "")).toBeLessThan(
      fullRoleLines.indexOf(removedRoleLines[0] ?? "")
    )
  })

  it("実断片では対応表を優先して after 側の規律行を削る", () => {
    placeBulkyRoleTable()
    const env = environment({ AMATSUKA_AGENT_AUTO_INJECTION: "custom" })
    const fullTable = markerTable(env, scanAgents(agentsDir()))
    if (fullTable === undefined)
      throw new Error("marker table fixture is empty")
    expect(fullTable.length).toBeGreaterThan(9500)

    const context = additionalContext(
      invoke("unknown-agent", { AMATSUKA_AGENT_AUTO_INJECTION: "custom" })
    )
    const firstRoleLine = fullTable.split("\n")[1]
    if (firstRoleLine === undefined)
      throw new Error("marker table fixture has no role rows")

    // 対応表を優先して残す設計判断の帰結であり、規律要約が落ちるのは意図された縮退である。
    expect(context.length).toBeLessThanOrEqual(9500)
    expect(context).toContain(`${TABLE_INTRO}\n${firstRoleLine}`)
    expect(context).not.toContain(
      "- 起動したアドバイザーに Agent tool を許可せず"
    )
  })
})
