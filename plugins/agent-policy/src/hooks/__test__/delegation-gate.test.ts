import fs from "node:fs"
import os from "node:os"
import path from "node:path"
import { fileURLToPath } from "node:url"
import { afterEach, beforeEach, describe, expect, it } from "vitest"
import { runTs } from "../../testing/run-ts.js"
import { markerTable, scanAgents } from "../marker-scan"

const HOOK = fileURLToPath(new URL("../delegation-gate.ts", import.meta.url))

interface Invocation {
  stdout: string
  stderr: string
}

let sandbox: string
let project: string
let captureIndex: number

beforeEach(() => {
  sandbox = fs.mkdtempSync(path.join(os.tmpdir(), "agent-policy-gate-"))
  project = path.join(sandbox, "project")
  fs.mkdirSync(project)
  captureIndex = 0
})

afterEach(() => {
  fs.rmSync(sandbox, { recursive: true, force: true })
})

function environment(
  gateValue: string | undefined,
  overrides: NodeJS.ProcessEnv = {}
): NodeJS.ProcessEnv {
  const env: NodeJS.ProcessEnv = { ...process.env }
  delete env.AMATSUKA_AGENT_DELEGATION_GATE
  delete env.CLAUDE_PROJECT_DIR
  if (gateValue !== undefined) env.AMATSUKA_AGENT_DELEGATION_GATE = gateValue
  return {
    ...env,
    CLAUDE_PROJECT_DIR: project,
    ...overrides
  }
}

function invokeRaw(
  input: string | undefined,
  options: {
    args?: string[]
    gateValue?: string | undefined
    env?: NodeJS.ProcessEnv
    cwd?: string
  } = {}
): Invocation {
  const gateValue = Object.hasOwn(options, "gateValue")
    ? options.gateValue
    : "on"
  const stderrPath = path.join(sandbox, `stderr-${captureIndex}.txt`)
  captureIndex += 1
  const stderrFd = fs.openSync(stderrPath, "w+")
  let stdout: string
  try {
    stdout = runTs(HOOK, options.args ?? [], {
      cwd: options.cwd,
      env: environment(gateValue, options.env),
      input,
      stdio: ["pipe", "pipe", stderrFd]
    })
  } finally {
    fs.closeSync(stderrFd)
  }
  return { stdout, stderr: fs.readFileSync(stderrPath, "utf8") }
}

function invoke(
  input: Record<string, unknown>,
  options: Parameters<typeof invokeRaw>[1] = {}
): Invocation {
  return invokeRaw(JSON.stringify(input), options)
}

function hookInput(
  toolName = "Write",
  toolInput: Record<string, unknown> = {
    file_path: path.join(project, "plugins", "demo", "src", "target.ts")
  }
): Record<string, unknown> {
  return {
    hook_event_name: "PreToolUse",
    tool_name: toolName,
    tool_input: toolInput,
    cwd: project
  }
}

function writeConfig(
  value:
    | string
    | {
        denyGlobs: string[]
        mcpTools?: Record<string, { pathParam: string; absolute: boolean }>
        ttlSeconds?: number
      }
): string {
  const dir = path.join(project, ".claude", "agent-policy")
  fs.mkdirSync(dir, { recursive: true })
  const file = path.join(dir, "delegation-gate.json")
  fs.writeFileSync(
    file,
    typeof value === "string" ? value : JSON.stringify(value)
  )
  return file
}

function directFlag(): string {
  return path.join(project, ".claude", "agent-policy", "delegation-gate.direct")
}

function denialReason(stdout: string): string {
  const parsed = JSON.parse(stdout) as {
    hookSpecificOutput: { permissionDecisionReason: string }
  }
  return parsed.hookSpecificOutput.permissionDecisionReason
}

function projectEntries(): string[] {
  const entries: string[] = []
  const visit = (dir: string): void => {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const absolute = path.join(dir, entry.name)
      entries.push(path.relative(project, absolute))
      if (entry.isDirectory()) visit(absolute)
    }
  }
  visit(project)
  return entries.sort()
}

describe("opt-in と fail-open", () => {
  it.each([
    "1",
    "true",
    "on",
    "ON",
    " on "
  ])("opt-in 値 %j で gate を有効にする", (gateValue) => {
    writeConfig({ denyGlobs: ["plugins/*/src/**"] })

    const result = invoke(hookInput(), { gateValue })

    expect(
      JSON.parse(result.stdout).hookSpecificOutput.permissionDecision
    ).toBe("deny")
    expect(result.stderr).toBe("")
  })

  it.each([
    undefined,
    "",
    "yes",
    "2",
    "enabled",
    "false",
    "off"
  ])("opt-in 値 %j では無効のままにする", (gateValue) => {
    const result = invoke(hookInput(), { gateValue })

    expect(result).toEqual({ stdout: "", stderr: "" })
  })

  it("agent_id があれば保護パスでも通過させる", () => {
    writeConfig({ denyGlobs: ["plugins/*/src/**"] })

    const result = invoke({ ...hookInput(), agent_id: "subagent-1" })

    expect(result).toEqual({ stdout: "", stderr: "" })
  })

  it.each(["{broken", ""])("壊れた入力 %j を fail-open する", (input) => {
    writeConfig({ denyGlobs: ["plugins/*/src/**"] })

    const result = invokeRaw(input)

    expect(result.stdout).toBe("")
    expect(result.stderr).toContain("stdin")
  })
})

describe("設定と TTL", () => {
  it("設定ファイルが無いとき stderr へ 1 行だけ通知する", () => {
    const configPath = path.join(
      project,
      ".claude",
      "agent-policy",
      "delegation-gate.json"
    )

    const result = invoke(hookInput())

    expect(result.stdout).toBe("")
    expect(result.stderr.trim().split("\n")).toHaveLength(1)
    expect(result.stderr).toContain(
      `delegation-gate: 有効化されているが設定ファイルが無い(${configPath})`
    )
  })

  it("設定ファイルが壊れた JSON のとき stderr へ 1 行だけ通知する", () => {
    const configPath = writeConfig("{broken")

    const result = invoke(hookInput())

    expect(result.stdout).toBe("")
    expect(result.stderr.trim().split("\n")).toHaveLength(1)
    expect(result.stderr).toContain("設定ファイルが壊れている")
    expect(result.stderr).toContain(configPath)
  })

  it("設定ファイルが存在するが読めないとき stderr へ 1 行だけ通知する", () => {
    const configPath = writeConfig({ denyGlobs: ["plugins/*/src/**"] })
    fs.chmodSync(configPath, 0o000)

    try {
      const result = invoke(hookInput())

      expect(result.stdout).toBe("")
      expect(result.stderr.trim().split("\n")).toHaveLength(1)
      expect(result.stderr).toContain(
        `delegation-gate: 有効化されているが設定ファイルを読めない(${configPath})`
      )
    } finally {
      fs.chmodSync(configPath, 0o644)
    }
  })

  it("denyGlobs が空配列のとき stderr へ 1 行だけ通知する", () => {
    const configPath = writeConfig({ denyGlobs: [] })

    const result = invoke(hookInput())

    expect(result.stdout).toBe("")
    expect(result.stderr.trim().split("\n")).toHaveLength(1)
    expect(result.stderr).toContain("denyGlobs が空である")
    expect(result.stderr).toContain(configPath)
  })

  it("TTL フラグが有効な間は保護パスを通過させる", () => {
    writeConfig({ denyGlobs: ["plugins/*/src/**"], ttlSeconds: 60 })
    fs.writeFileSync(directFlag(), "")

    const result = invoke(hookInput())

    expect(result).toEqual({ stdout: "", stderr: "" })
  })

  it("期限切れの TTL フラグを無視して deny する", () => {
    writeConfig({ denyGlobs: ["plugins/*/src/**"], ttlSeconds: 60 })
    fs.writeFileSync(directFlag(), "")
    const expired = new Date(Date.now() - 61_000)
    fs.utimesSync(directFlag(), expired, expired)

    const result = invoke(hookInput())

    expect(
      JSON.parse(result.stdout).hookSpecificOutput.permissionDecision
    ).toBe("deny")
  })
})

describe("ツールとパスの判定", () => {
  beforeEach(() => {
    writeConfig({
      denyGlobs: ["plugins/*/src/**", "notebooks/**"],
      mcpTools: {
        mcp__example__absolute_edit: {
          pathParam: "target",
          absolute: true
        },
        mcp__example__relative_edit: {
          pathParam: "relative_path",
          absolute: false
        }
      }
    })
  })

  it("対象外のツール名は通過させる", () => {
    const result = invoke(hookInput("Read", { file_path: "ignored" }))

    expect(result).toEqual({ stdout: "", stderr: "" })
  })

  it.each([
    ["Edit", "file_path", "plugins/demo/src/edit.ts"],
    ["Write", "file_path", "plugins/demo/src/write.ts"],
    ["NotebookEdit", "notebook_path", "notebooks/demo.ipynb"]
  ])("%s の %s から絶対パスを取り出す", (toolName, pathParam, target) => {
    const result = invoke(
      hookInput(toolName, { [pathParam]: path.join(project, target) })
    )

    expect(
      JSON.parse(result.stdout).hookSpecificOutput.permissionDecision
    ).toBe("deny")
  })

  it("プロジェクトルート外の絶対パスは通過させる", () => {
    const result = invoke(
      hookInput("Write", {
        file_path: path.join(
          sandbox,
          "outside",
          "plugins",
          "demo",
          "src",
          "x.ts"
        )
      })
    )

    expect(result).toEqual({ stdout: "", stderr: "" })
  })

  it("glob に一致したとき deny JSON を返す", () => {
    const result = invoke(hookInput())
    const output = JSON.parse(result.stdout) as {
      hookSpecificOutput: Record<string, unknown>
    }

    expect(output.hookSpecificOutput).toMatchObject({
      hookEventName: "PreToolUse",
      permissionDecision: "deny"
    })
    expect(result.stdout.endsWith("\n")).toBe(true)
  })

  it("glob に一致しないパスは通過させる", () => {
    const result = invoke(
      hookInput("Write", { file_path: path.join(project, "README.md") })
    )

    expect(result).toEqual({ stdout: "", stderr: "" })
  })

  it("mcpTools の absolute: true で絶対パスを取り出す", () => {
    const result = invoke(
      hookInput("mcp__example__absolute_edit", {
        target: path.join(project, "plugins", "demo", "src", "mcp.ts")
      })
    )

    expect(
      JSON.parse(result.stdout).hookSpecificOutput.permissionDecision
    ).toBe("deny")
  })

  it("mcpTools の absolute: false で相対パスを取り出す", () => {
    const result = invoke(
      hookInput("mcp__example__relative_edit", {
        relative_path: "plugins/demo/src/mcp.ts"
      })
    )

    expect(
      JSON.parse(result.stdout).hookSpecificOutput.permissionDecision
    ).toBe("deny")
  })
})

describe("deny 理由の対応表", () => {
  beforeEach(() => {
    writeConfig({ denyGlobs: ["plugins/*/src/**"] })
  })

  it("対応表があるとき markerTable の戻り値を委譲先候補へ載せる", () => {
    const agentsDir = path.join(project, ".claude", "agents")
    fs.mkdirSync(agentsDir, { recursive: true })
    fs.writeFileSync(
      path.join(agentsDir, "lead.md"),
      [
        "---",
        "name: project-lead",
        "model: opus",
        "tools: Read, Edit, Agent",
        "agent-policy-role: complex-impl",
        "---",
        ""
      ].join("\n")
    )
    const env = environment("on")
    const expected = markerTable(env, scanAgents(agentsDir))
    expect(expected).toBeDefined()

    const result = invoke(hookInput())
    const reason = denialReason(result.stdout)

    expect(reason).toContain(`委譲先候補 — ${expected}`)
  })

  it("対応表が無いとき委譲先候補の丸括弧部分を省く", () => {
    const result = invoke(hookInput())
    const reason = denialReason(result.stdout)

    expect(reason).not.toContain("委譲先候補")
    expect(reason).toContain("担当表の役割に従い Agent tool で委譲する。Bash")
  })
})

describe("--direct CLI", () => {
  it("on、status、off の順に一時解除状態を変更して報告する", () => {
    writeConfig({ denyGlobs: ["plugins/*/src/**"], ttlSeconds: 60 })

    const on = invokeRaw(undefined, { args: ["--direct", "on"] })
    expect(on.stderr).toBe("")
    expect(on.stdout).toMatch(
      /^delegation-gate: 一時解除を開始した\(期限: .+\)\n$/
    )
    expect(fs.existsSync(directFlag())).toBe(true)

    const statusOn = invokeRaw(undefined, { args: ["--direct", "status"] })
    expect(statusOn).toEqual({
      stdout: expect.stringMatching(
        /^delegation-gate: 一時解除中\(残り \d+ 秒\)\n$/
      ),
      stderr: ""
    })

    const off = invokeRaw(undefined, { args: ["--direct", "off"] })
    expect(off).toEqual({
      stdout: "delegation-gate: 一時解除を終了した\n",
      stderr: ""
    })
    expect(fs.existsSync(directFlag())).toBe(false)

    const statusOff = invokeRaw(undefined, { args: ["--direct", "status"] })
    expect(statusOff).toEqual({
      stdout: "delegation-gate: 一時解除していない\n",
      stderr: ""
    })
  })

  it("未知の --direct 値を stderr へ 1 行だけ報告して exit 0 する", () => {
    const result = invokeRaw(undefined, { args: ["--direct", "later"] })

    expect(result.stdout).toBe("")
    expect(result.stderr).toBe(
      "delegation-gate: --direct には on / off / status を指定する\n"
    )
  })
})

describe("フック経路の不変条件", () => {
  it("フックとして起動された経路ではファイルを作成しない", () => {
    writeConfig({ denyGlobs: ["plugins/*/src/**"] })
    const before = projectEntries()

    const result = invoke(hookInput())

    expect(
      JSON.parse(result.stdout).hookSpecificOutput.permissionDecision
    ).toBe("deny")
    expect(projectEntries()).toEqual(before)
  })
})
