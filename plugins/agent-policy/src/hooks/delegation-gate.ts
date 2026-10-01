#!/usr/bin/env node

import fs from "node:fs"
import path from "node:path"

const STDIN_TIMEOUT_MS = 2000
const CONFIG_RELATIVE_PATH = path.join(
  ".claude",
  "agent-policy",
  "delegation-gate.json"
)
const DENIAL_REASON =
  "delegation-gate: このパスはメインセッションでは編集しない運用である。担当表の役割に従い、Agent tool で委譲する。Bash での書き込みや他ツールへの切り替えで回避せず、委譲で進める。"

interface HookInput {
  tool_name?: unknown
  tool_input?: unknown
  agent_id?: unknown
  cwd?: unknown
}

interface ToolPathSpec {
  pathParam: string
  absolute: boolean
}

interface GateConfig {
  denyGlobs: string[]
  mcpTools: Record<string, ToolPathSpec>
}

type InputResult =
  | { ok: true; input: HookInput }
  | { ok: false; reason: string }

type ConfigResult =
  | { ok: true; config: GateConfig }
  | { ok: false; message: string }

const BUILTIN_TOOLS: Readonly<Record<string, ToolPathSpec>> = {
  Edit: { pathParam: "file_path", absolute: true },
  Write: { pathParam: "file_path", absolute: true },
  NotebookEdit: { pathParam: "notebook_path", absolute: true }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value)
}

function report(message: string): void {
  process.stderr.write(`${message}\n`)
}

function readHookInput(): Promise<InputResult> {
  return new Promise((resolve) => {
    let data = ""
    let settled = false
    let timer: NodeJS.Timeout
    const finish = (value: InputResult): void => {
      if (settled) return
      settled = true
      clearTimeout(timer)
      resolve(value)
    }

    timer = setTimeout(() => {
      process.stdin.destroy()
      finish({ ok: false, reason: "stdin timeout" })
    }, STDIN_TIMEOUT_MS)
    process.stdin.setEncoding("utf8")
    process.stdin.on("data", (chunk) => {
      data += chunk
    })
    process.stdin.on("end", () => {
      try {
        const parsed: unknown = JSON.parse(data)
        if (!isRecord(parsed)) {
          finish({ ok: false, reason: "stdin parse failed" })
          return
        }
        finish({ ok: true, input: parsed })
      } catch {
        finish({ ok: false, reason: "stdin parse failed" })
      }
    })
    process.stdin.on("error", () =>
      finish({ ok: false, reason: "stdin read failed" })
    )
  })
}

function gateEnabled(env: NodeJS.ProcessEnv): boolean {
  const value = env.AMATSUKA_AGENT_DELEGATION_GATE?.trim().toLowerCase()
  return value === "1" || value === "true" || value === "on"
}

function canonicalizePath(value: string): string {
  const absolute = path.resolve(value)
  let existing = absolute
  const missing: string[] = []

  while (!fs.existsSync(existing)) {
    const parent = path.dirname(existing)
    if (parent === existing) return absolute
    missing.unshift(path.basename(existing))
    existing = parent
  }

  return path.resolve(fs.realpathSync(existing), ...missing)
}

function resolveProjectRoot(input?: HookInput): string {
  const envRoot = process.env.CLAUDE_PROJECT_DIR
  const inputRoot = input?.cwd
  const selected =
    envRoot !== undefined && envRoot !== ""
      ? envRoot
      : typeof inputRoot === "string" && inputRoot !== ""
        ? inputRoot
        : process.cwd()
  return canonicalizePath(selected)
}

function configPath(projectRoot: string): string {
  return path.join(projectRoot, CONFIG_RELATIVE_PATH)
}

function invalidConfigMessage(file: string): string {
  return `delegation-gate: 有効化されているが設定ファイルが壊れている(${file})`
}

function readConfig(projectRoot: string): ConfigResult {
  const file = configPath(projectRoot)
  let raw: string
  try {
    raw = fs.readFileSync(file, "utf8")
  } catch (error) {
    const code = isRecord(error) ? error.code : undefined
    return {
      ok: false,
      message:
        code === "ENOENT"
          ? `delegation-gate: 有効化されているが設定ファイルが無い(${file})`
          : `delegation-gate: 有効化されているが設定ファイルを読めない(${file})`
    }
  }

  let parsed: unknown
  try {
    parsed = JSON.parse(raw)
  } catch {
    return { ok: false, message: invalidConfigMessage(file) }
  }
  if (!isRecord(parsed)) {
    return { ok: false, message: invalidConfigMessage(file) }
  }

  const denyGlobs = parsed.denyGlobs
  if (
    !Array.isArray(denyGlobs) ||
    !denyGlobs.every((item) => typeof item === "string")
  ) {
    return { ok: false, message: invalidConfigMessage(file) }
  }
  if (denyGlobs.length === 0) {
    return {
      ok: false,
      message: `delegation-gate: 有効化されているが denyGlobs が空である(${file})`
    }
  }

  const mcpTools: Record<string, ToolPathSpec> = {}
  if (parsed.mcpTools !== undefined) {
    if (!isRecord(parsed.mcpTools)) {
      return { ok: false, message: invalidConfigMessage(file) }
    }
    for (const [toolName, value] of Object.entries(parsed.mcpTools)) {
      if (
        !isRecord(value) ||
        typeof value.pathParam !== "string" ||
        value.pathParam === "" ||
        typeof value.absolute !== "boolean"
      ) {
        return { ok: false, message: invalidConfigMessage(file) }
      }
      mcpTools[toolName] = {
        pathParam: value.pathParam,
        absolute: value.absolute
      }
    }
  }

  return { ok: true, config: { denyGlobs, mcpTools } }
}

function toolPathSpec(
  toolName: string,
  config: GateConfig
): ToolPathSpec | undefined {
  return BUILTIN_TOOLS[toolName] ?? config.mcpTools[toolName]
}

function normalizedTargetPath(
  toolInput: unknown,
  spec: ToolPathSpec,
  projectRoot: string
): string | undefined {
  if (!isRecord(toolInput)) return undefined
  const rawPath = toolInput[spec.pathParam]
  if (typeof rawPath !== "string" || rawPath === "") return undefined
  if (spec.absolute && !path.isAbsolute(rawPath)) return undefined

  const target = canonicalizePath(
    spec.absolute ? rawPath : path.resolve(projectRoot, rawPath)
  )
  const relative = path.relative(projectRoot, target)
  if (
    relative === ".." ||
    relative.startsWith(`..${path.sep}`) ||
    path.isAbsolute(relative)
  ) {
    return undefined
  }
  return relative.split(path.sep).join("/")
}

function respondDeny(): void {
  process.stdout.write(
    `${JSON.stringify({
      hookSpecificOutput: {
        hookEventName: "PreToolUse",
        permissionDecision: "deny",
        permissionDecisionReason: DENIAL_REASON
      }
    })}\n`
  )
}

async function runHook(): Promise<void> {
  if (!gateEnabled(process.env)) return

  const result = await readHookInput()
  if (!result.ok) {
    report(`delegation-gate: ${result.reason}`)
    return
  }
  if ("agent_id" in result.input) return

  const projectRoot = resolveProjectRoot(result.input)
  const configResult = readConfig(projectRoot)
  if (!configResult.ok) {
    report(configResult.message)
    return
  }
  const { config } = configResult

  const toolName = result.input.tool_name
  if (typeof toolName !== "string") return
  const spec = toolPathSpec(toolName, config)
  if (spec === undefined) return

  const target = normalizedTargetPath(
    result.input.tool_input,
    spec,
    projectRoot
  )
  if (target === undefined) return
  if (!config.denyGlobs.some((glob) => path.matchesGlob(target, glob))) return

  respondDeny()
}

async function main(): Promise<void> {
  try {
    await runHook()
  } catch {
    // フックの予期しない例外は fail-open とし、何も出力しない。
  }
}

void main()
