#!/usr/bin/env node

import fs from "node:fs"
import path from "node:path"
import { markerTable, scanAgents } from "./marker-scan"

const STDIN_TIMEOUT_MS = 2000
const DEFAULT_TTL_SECONDS = 7200
const CONFIG_RELATIVE_PATH = path.join(
  ".claude",
  "agent-policy",
  "delegation-gate.json"
)
const DIRECT_FLAG_RELATIVE_PATH = path.join(
  ".claude",
  "agent-policy",
  "delegation-gate.direct"
)

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
  ttlSeconds: number
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

function directFlagPath(projectRoot: string): string {
  return path.join(projectRoot, DIRECT_FLAG_RELATIVE_PATH)
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

  const ttlSeconds = parsed.ttlSeconds ?? DEFAULT_TTL_SECONDS
  if (
    typeof ttlSeconds !== "number" ||
    !Number.isFinite(ttlSeconds) ||
    ttlSeconds < 0
  ) {
    return { ok: false, message: invalidConfigMessage(file) }
  }

  return {
    ok: true,
    config: { denyGlobs, mcpTools, ttlSeconds }
  }
}

function readCliTtlSeconds(projectRoot: string): number {
  try {
    const parsed: unknown = JSON.parse(
      fs.readFileSync(configPath(projectRoot), "utf8")
    )
    if (!isRecord(parsed)) return DEFAULT_TTL_SECONDS
    const ttl = parsed.ttlSeconds
    return typeof ttl === "number" && Number.isFinite(ttl) && ttl >= 0
      ? ttl
      : DEFAULT_TTL_SECONDS
  } catch {
    return DEFAULT_TTL_SECONDS
  }
}

function remainingDirectSeconds(
  projectRoot: string,
  ttlSeconds: number,
  now = Date.now()
): number | undefined {
  const flag = directFlagPath(projectRoot)
  let modifiedAt: number
  try {
    const stats = fs.statSync(flag)
    if (!stats.isFile()) return undefined
    modifiedAt = stats.mtimeMs
  } catch {
    return undefined
  }

  const ageSeconds = (now - modifiedAt) / 1000
  if (ageSeconds < 0 || ageSeconds > ttlSeconds) return undefined
  return Math.max(0, Math.ceil(ttlSeconds - ageSeconds))
}

function runDirectCli(args: string[], directIndex: number): void {
  const mode = args[directIndex + 1]
  if (mode !== "on" && mode !== "off" && mode !== "status") {
    report("delegation-gate: --direct には on / off / status を指定する")
    return
  }

  const projectRoot = resolveProjectRoot()
  const flag = directFlagPath(projectRoot)
  const ttlSeconds = readCliTtlSeconds(projectRoot)

  if (mode === "on") {
    fs.mkdirSync(path.dirname(flag), { recursive: true })
    fs.closeSync(fs.openSync(flag, "a"))
    const now = new Date()
    fs.utimesSync(flag, now, now)
    const expiresAt = new Date(now.getTime() + ttlSeconds * 1000)
    process.stdout.write(
      `delegation-gate: 一時解除を開始した(期限: ${expiresAt.toISOString()})\n`
    )
    return
  }

  if (mode === "off") {
    fs.rmSync(flag, { force: true })
    process.stdout.write("delegation-gate: 一時解除を終了した\n")
    return
  }

  const remaining = remainingDirectSeconds(projectRoot, ttlSeconds)
  process.stdout.write(
    remaining === undefined
      ? "delegation-gate: 一時解除していない\n"
      : `delegation-gate: 一時解除中(残り ${remaining} 秒)\n`
  )
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

function denialReason(projectRoot: string): string {
  const table = markerTable(
    { ...process.env, CLAUDE_PROJECT_DIR: projectRoot },
    scanAgents(path.join(projectRoot, ".claude", "agents"))
  )
  const candidates = table === undefined ? "" : `(委譲先候補 — ${table})。`
  return (
    "delegation-gate: メインセッションでこの層のファイルは編集しない運用方針である。" +
    `担当表の帯に従い Agent tool で委譲する。${candidates}` +
    "Bash 経由の書き込みや他ツールへの切替で回避しない。" +
    "直接編集が必要なときは、ユーザー自身が `--direct on` を実行して一時解除する(TTL で自動失効)。"
  )
}

function respondDeny(projectRoot: string): void {
  process.stdout.write(
    `${JSON.stringify({
      hookSpecificOutput: {
        hookEventName: "PreToolUse",
        permissionDecision: "deny",
        permissionDecisionReason: denialReason(projectRoot)
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

  if (remainingDirectSeconds(projectRoot, config.ttlSeconds) !== undefined) {
    return
  }

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

  respondDeny(projectRoot)
}

async function main(): Promise<void> {
  try {
    const directIndex = process.argv.indexOf("--direct")
    if (directIndex !== -1) {
      runDirectCli(process.argv, directIndex)
      return
    }
    await runHook()
  } catch {
    // フック・CLI の予期しない例外は fail-open とし、何も出力しない。
  }
}

void main()
