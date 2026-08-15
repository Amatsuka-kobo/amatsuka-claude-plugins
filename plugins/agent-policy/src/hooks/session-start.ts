#!/usr/bin/env node
// SessionStart フック: 方針スキルの使用指示を additionalContext として注入する。
// 失敗しても Claude Code の起動を妨げないよう、例外は握りつぶして終了コード 0 で終わる。

import fs from "node:fs"
import path from "node:path"
import { fileURLToPath } from "node:url"

const POLICIES: Record<string, string> = {
  claude: "claude-model-policy",
  "with-codex": "with-codex-policy",
  "with-grok": "with-grok-policy",
  "with-codex-grok": "codex-grok-policy"
}

function policyBlock(value: string | undefined): string | undefined {
  if (value === undefined || value === "" || value === "none") return undefined

  const policy = POLICIES[value]
  if (policy === undefined) {
    return `AMATSUKA_AGENT_AUTO_INJECTION の値 "${value}" は未知のため、agent-policy の方針注入をスキップした。`
  }
  return `最初に必ず agent-policy:${policy} スキルを使用し、この規律に従う`
}

interface AgentSpec {
  name: string
  variable: string
  fallback: string
}

const AGENTS: AgentSpec[] = [
  {
    name: "gpt-sol",
    variable: "AMATSUKA_AGENT_GPT_SOL_ALIAS",
    fallback: "claude-gpt-5-6-sol"
  },
  {
    name: "gpt-terra",
    variable: "AMATSUKA_AGENT_GPT_TERRA_ALIAS",
    fallback: "claude-gpt-5-6-terra"
  },
  {
    name: "gpt-researcher",
    variable: "AMATSUKA_AGENT_GPT_TERRA_ALIAS",
    fallback: "claude-gpt-5-6-terra"
  },
  {
    name: "gpt-luna",
    variable: "AMATSUKA_AGENT_GPT_LUNA_ALIAS",
    fallback: "claude-gpt-5-6-luna"
  },
  {
    name: "grok-researcher",
    variable: "AMATSUKA_AGENT_GROK_ALIAS",
    fallback: "claude-grok-4-5"
  },
  {
    name: "grok-implementer",
    variable: "AMATSUKA_AGENT_GROK_ALIAS",
    fallback: "claude-grok-4-5"
  }
]

interface SyncResult {
  overridden: string[]
  written: string[]
  stale: string[]
}

function pluginRoot(env: NodeJS.ProcessEnv): string {
  return (
    env.CLAUDE_PLUGIN_ROOT ??
    path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..")
  )
}

function replaceModel(content: string, alias: string): string {
  const lines = content.split("\n")
  const index = lines.findIndex((line) => line.startsWith("model: "))
  if (index === -1) {
    throw new Error("Bundled agent has no model line")
  }
  lines[index] = `model: ${alias}`
  return lines.join("\n")
}

function sync(env: NodeJS.ProcessEnv): SyncResult {
  const result: SyncResult = { overridden: [], written: [], stale: [] }
  const projectDir = env.CLAUDE_PROJECT_DIR
  if (projectDir === undefined || projectDir === "") return result

  const outDir = path.join(projectDir, ".claude", "agents")

  for (const spec of AGENTS) {
    const alias = env[spec.variable]
    const target = path.join(outDir, `${spec.name}.md`)

    if (alias === undefined || alias === "" || alias === spec.fallback) {
      if (fs.existsSync(target)) result.stale.push(spec.name)
      continue
    }

    const source = fs.readFileSync(
      path.join(pluginRoot(env), "agents", `${spec.name}.md`),
      "utf8"
    )
    const content = replaceModel(source, alias)
    result.overridden.push(spec.name)

    if (fs.existsSync(target) && fs.readFileSync(target, "utf8") === content) {
      continue
    }
    fs.mkdirSync(outDir, { recursive: true })
    fs.writeFileSync(target, content)
    result.written.push(spec.name)
  }

  return result
}

function build(env: NodeJS.ProcessEnv): string | undefined {
  const result = sync(env)
  const blocks = [
    policyBlock(env.AMATSUKA_AGENT_AUTO_INJECTION),
    overrideBlock(result.overridden),
    restartBlock(result.written),
    staleBlock(result.stale)
  ].filter((block): block is string => block !== undefined)

  return blocks.length === 0 ? undefined : blocks.join("\n\n")
}

function overrideBlock(names: string[]): string | undefined {
  if (names.length === 0) return undefined
  return `次の Agent はプロジェクト定義(.claude/agents/)を使う。agent-policy: プレフィックス付きの同梱定義は使わない: ${names.join(", ")}`
}

function restartBlock(names: string[]): string | undefined {
  if (names.length === 0) return undefined
  return `上記のうち ${names.join(", ")} の定義を今のセッションで生成した。生成した定義は現セッションには反映されないため、エイリアスに依存する委譲を行う前に Claude Code を再起動する。`
}

function staleBlock(names: string[]): string | undefined {
  if (names.length === 0) return undefined
  return `次の Agent 定義が .claude/agents/ に残っている。プロジェクト定義は同梱定義より優先されるため、旧セットアップの生成物であれば削除する: ${names.join(", ")}`
}

function respond(context: string): void {
  process.stdout.write(
    `${JSON.stringify({
      hookSpecificOutput: {
        hookEventName: "SessionStart",
        additionalContext: context
      }
    })}\n`
  )
}

try {
  const context = build(process.env)
  if (context !== undefined) respond(context)
} catch (error) {
  const message = error instanceof Error ? error.message : "Unexpected error"
  process.stderr.write(`agent-policy session-start: ${message}\n`)
}
