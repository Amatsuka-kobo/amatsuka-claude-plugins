#!/usr/bin/env node
// SubagentStart フック: Agent tool を持つ可能性があるサブエージェントへ、
// 役割マーカー対応表とサブエージェント向け規律を注入する。

import fs from "node:fs"
import path from "node:path"
import {
  type MarkedAgent,
  markerTable,
  projectAgentsDir,
  scanAgents
} from "./marker-scan"

const STDIN_TIMEOUT_MS = 2000
const MAX_CONTEXT_CHARS = 9500
const MARKER_LINE = "<!-- marker-table -->"
const NO_MARKERS = "対応表なし(このプロジェクトに役割マーカー付き定義は無い)"

interface SubagentStartInput {
  agent_type?: unknown
}

type InputResult =
  | { ok: true; input: SubagentStartInput }
  | { ok: false; reason: string }

type AgentMatch =
  | {
      kind: "definition"
      source: "project" | "bundled"
      agent: MarkedAgent
    }
  | { kind: "builtin"; name: "Explore" | "Plan" }

interface Resolution {
  phase: "exact" | "suffix" | "unknown"
  matches: AgentMatch[]
  target: AgentMatch | undefined
}

interface ContextSections {
  before: string[]
  table: string[]
  after: string[]
}

function report(reason: string): void {
  process.stderr.write(`agent-policy subagent-start: ${reason}\n`)
}

function debug(env: NodeJS.ProcessEnv, message: string): void {
  if (env.AMATSUKA_AGENT_SUBSTART_DEBUG === "1") {
    process.stderr.write(`agent-policy subagent-start debug: ${message}\n`)
  }
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
        if (
          typeof parsed !== "object" ||
          parsed === null ||
          Array.isArray(parsed)
        ) {
          finish({ ok: false, reason: "stdin parse failed" })
          return
        }
        finish({ ok: true, input: parsed as SubagentStartInput })
      } catch {
        finish({ ok: false, reason: "stdin parse failed" })
      }
    })
    process.stdin.on("error", () =>
      finish({ ok: false, reason: "stdin read failed" })
    )
  })
}

function exactMatches(
  agentType: string,
  projectAgents: MarkedAgent[],
  bundledAgents: MarkedAgent[]
): AgentMatch[] {
  const matches: AgentMatch[] = []
  for (const agent of projectAgents) {
    if (agent.name === agentType) {
      matches.push({ kind: "definition", source: "project", agent })
    }
  }
  for (const agent of bundledAgents) {
    if (
      agent.name === agentType ||
      `agent-policy:${agent.name}` === agentType
    ) {
      matches.push({ kind: "definition", source: "bundled", agent })
    }
  }
  if (agentType === "Explore" || agentType === "Plan") {
    matches.push({ kind: "builtin", name: agentType })
  }
  return matches
}

function suffixMatches(
  agentType: string,
  projectAgents: MarkedAgent[],
  bundledAgents: MarkedAgent[]
): AgentMatch[] {
  const suffix = agentType.slice(agentType.lastIndexOf(":") + 1)
  const matches: AgentMatch[] = []
  for (const agent of projectAgents) {
    if (agent.name === suffix) {
      matches.push({ kind: "definition", source: "project", agent })
    }
  }
  for (const agent of bundledAgents) {
    if (agent.name === suffix) {
      matches.push({ kind: "definition", source: "bundled", agent })
    }
  }
  return matches
}

function resolveAgent(
  value: unknown,
  projectAgents: MarkedAgent[],
  bundledAgents: MarkedAgent[]
): Resolution {
  if (typeof value !== "string" || value === "") {
    return { phase: "unknown", matches: [], target: undefined }
  }

  const exact = exactMatches(value, projectAgents, bundledAgents)
  if (exact.length > 0) {
    return {
      phase: "exact",
      matches: exact,
      target: exact.length === 1 ? exact[0] : undefined
    }
  }

  const suffix = suffixMatches(value, projectAgents, bundledAgents)
  return {
    phase: suffix.length > 0 ? "suffix" : "unknown",
    matches: suffix,
    target: suffix.length === 1 ? suffix[0] : undefined
  }
}

function matchDescription(resolution: Resolution): string {
  const names = resolution.matches.map((match) =>
    match.kind === "builtin"
      ? `builtin:${match.name}`
      : `${match.source}:${match.agent.name}`
  )
  return `${resolution.phase}:${names.length === 0 ? "none" : names.join(",")}`
}

function deniedBy(target: AgentMatch | undefined): string | undefined {
  if (target === undefined) return undefined
  if (target.kind === "builtin") return `builtin:${target.name}`
  if (
    target.agent.tools === undefined ||
    target.agent.tools.includes("Agent")
  ) {
    return undefined
  }
  return `${target.source}:${target.agent.name}:without-Agent`
}

function fragmentLines(fragment: string): string[] {
  const normalized = fragment.replaceAll("\r\n", "\n")
  const withoutTerminalNewline = normalized.endsWith("\n")
    ? normalized.slice(0, -1)
    : normalized
  return withoutTerminalNewline === "" ? [] : withoutTerminalNewline.split("\n")
}

function composeSections(
  fragment: string | undefined,
  table: string
): ContextSections {
  const tableLines = table.split("\n")
  if (fragment === undefined) {
    return { before: [], table: tableLines, after: [] }
  }

  const lines = fragmentLines(fragment)
  const markerIndex = lines.findIndex((line) => line.trim() === MARKER_LINE)
  if (markerIndex >= 0) {
    return {
      before: lines.slice(0, markerIndex),
      table: tableLines,
      after: lines.slice(markerIndex + 1)
    }
  }

  const before = [...lines]
  while (before.at(-1) === "") before.pop()
  return { before: [...before, ""], table: tableLines, after: [] }
}

function render(sections: ContextSections): string {
  return [...sections.before, ...sections.table, ...sections.after].join("\n")
}

function truncateContext(sections: ContextSections): {
  context: string
  truncated: boolean
} {
  let context = render(sections)
  if (context.length <= MAX_CONTEXT_CHARS) {
    return { context, truncated: false }
  }

  while (sections.after.length > 0 && context.length > MAX_CONTEXT_CHARS) {
    sections.after.pop()
    context = render(sections)
  }
  while (sections.before.length > 0 && context.length > MAX_CONTEXT_CHARS) {
    sections.before.pop()
    context = render(sections)
  }
  while (sections.table.length > 2 && context.length > MAX_CONTEXT_CHARS) {
    sections.table.pop()
    context = render(sections)
  }
  if (context.length > MAX_CONTEXT_CHARS) {
    context = context.slice(0, MAX_CONTEXT_CHARS)
  }
  return { context, truncated: true }
}

function readFragment(env: NodeJS.ProcessEnv): string | undefined {
  const pluginRoot = env.CLAUDE_PLUGIN_ROOT
  if (pluginRoot === undefined || pluginRoot === "") {
    report("fragment missing")
    return undefined
  }
  try {
    return fs.readFileSync(
      path.join(pluginRoot, "references", "subagent-discipline.md"),
      "utf8"
    )
  } catch {
    report("fragment missing")
    return undefined
  }
}

function bundledAgentsDir(env: NodeJS.ProcessEnv): string | undefined {
  const pluginRoot = env.CLAUDE_PLUGIN_ROOT
  if (pluginRoot === undefined || pluginRoot === "") return undefined
  return path.join(pluginRoot, "agents")
}

function buildContext(
  env: NodeJS.ProcessEnv,
  input: SubagentStartInput
): string | undefined {
  const projectAgents = scanAgents(projectAgentsDir(env))
  const bundledAgents = scanAgents(bundledAgentsDir(env))
  const resolution = resolveAgent(
    input.agent_type,
    projectAgents,
    bundledAgents
  )
  const denyReason = deniedBy(resolution.target)

  debug(env, `match=${matchDescription(resolution)}`)
  debug(env, `deny=${denyReason ?? "no"}`)
  if (denyReason !== undefined) {
    debug(env, "fragment-size=skipped table-size=skipped context-size=0")
    return undefined
  }

  const table = markerTable(env, projectAgents) ?? NO_MARKERS
  const fragment = readFragment(env)
  const result = truncateContext(composeSections(fragment, table))
  if (result.truncated) report("truncated")
  debug(
    env,
    `fragment-size=${fragment?.length ?? 0} table-size=${table.length} context-size=${result.context.length}`
  )
  return result.context
}

function respond(context: string): void {
  process.stdout.write(
    `${JSON.stringify({
      hookSpecificOutput: {
        hookEventName: "SubagentStart",
        additionalContext: context
      }
    })}\n`
  )
}

async function main(): Promise<void> {
  try {
    const result = await readHookInput()
    if (!result.ok) {
      report(result.reason)
      return
    }

    const context = buildContext(process.env, result.input)
    if (context !== undefined) respond(context)
  } catch {
    report("unexpected failure")
  }
}

void main()
