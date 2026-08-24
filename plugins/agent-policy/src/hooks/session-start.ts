#!/usr/bin/env node
// SessionStart フック: 方針スキルの使用指示と、役割マーカーの対応表を注入する。
// ファイルは書かない。定義の生成は setup-gpt / setup-grok が担う。
// 失敗しても Claude Code の起動を妨げないよう、例外は握りつぶして終了コード 0 で終わる。

import fs from "node:fs"
import path from "node:path"
import { DEFAULT_ALIASES } from "../agents/presets"
import { roleById } from "../agents/roles"

const POLICIES: Record<string, string> = {
  claude: "claude-model-policy",
  "with-codex": "with-codex-policy",
  "with-grok": "with-grok-policy",
  "with-codex-grok": "codex-grok-policy"
}

// 廃止した定義。プロジェクト側に残っていると同梱プリセットより優先されるため通知する。
const RETIRED = [
  "claude-researcher",
  "gpt-researcher",
  "grok-researcher",
  "grok-implementer"
]

interface AliasSpec {
  preset: string
  variable: string
  skill: string
}

const ALIASES: AliasSpec[] = [
  {
    preset: "gpt-sol",
    variable: "AMATSUKA_AGENT_GPT_SOL_ALIAS",
    skill: "agent-policy:setup-gpt"
  },
  {
    preset: "gpt-terra",
    variable: "AMATSUKA_AGENT_GPT_TERRA_ALIAS",
    skill: "agent-policy:setup-gpt"
  },
  {
    preset: "gpt-luna",
    variable: "AMATSUKA_AGENT_GPT_LUNA_ALIAS",
    skill: "agent-policy:setup-gpt"
  },
  {
    preset: "grok",
    variable: "AMATSUKA_AGENT_GROK_ALIAS",
    skill: "agent-policy:setup-grok"
  }
]

interface Marked {
  name: string
  model: string | undefined
  roles: string[]
}

function policyBlock(value: string | undefined): string | undefined {
  if (value === undefined || value === "" || value === "none") return undefined

  const policy = POLICIES[value]
  if (policy === undefined) {
    return `AMATSUKA_AGENT_AUTO_INJECTION の値 "${value}" は未知のため、agent-policy の方針注入をスキップした。`
  }
  return `最初に必ず agent-policy:${policy} スキルを使用し、この規律に従う`
}

function agentsDir(env: NodeJS.ProcessEnv): string | undefined {
  const projectDir = env.CLAUDE_PROJECT_DIR
  if (projectDir === undefined || projectDir === "") return undefined
  const dir = path.join(projectDir, ".claude", "agents")
  return fs.existsSync(dir) ? dir : undefined
}

function frontmatter(file: string): Map<string, string> {
  const lines = fs.readFileSync(file, "utf8").split("\n")
  const meta = new Map<string, string>()
  if (lines[0]?.trim() !== "---") return meta
  const close = lines.indexOf("---", 1)
  if (close === -1) return meta

  for (const line of lines.slice(1, close)) {
    const at = line.indexOf(":")
    if (at <= 0) continue
    meta.set(line.slice(0, at).trim(), line.slice(at + 1).trim())
  }
  return meta
}

// 走査対象はプロジェクトの .claude/agents/ のみ。同梱プリセットは読まない。
function scan(dir: string | undefined): Marked[] {
  if (dir === undefined) return []
  const found: Marked[] = []

  for (const file of fs.readdirSync(dir).sort()) {
    if (!file.endsWith(".md")) continue
    // 1 ファイルが読めなくても、他の定義と方針注入は生かす。
    let meta: Map<string, string>
    try {
      meta = frontmatter(path.join(dir, file))
    } catch {
      continue
    }
    const marker = meta.get("agent-policy-role")
    found.push({
      name: meta.get("name") ?? file.replace(/\.md$/, ""),
      model: meta.get("model"),
      roles:
        marker === undefined
          ? []
          : marker
              .split(",")
              .map((role) => role.trim())
              .filter((role) => role !== "")
    })
  }

  return found
}

// 役割 ID の表示名を解決する。プラグイン既知の ROLES に無いときは、
// プロジェクト側の役割断片(.claude/agent-policy/roles/<id>.md)の label を読む。
// setup はプロジェクト側断片の役割 ID もマーカーへ書き込むため、ここで拾えないと
// 「未知の役割」として誤って報告してしまう。
function labelOf(env: NodeJS.ProcessEnv, id: string): string | undefined {
  const known = roleById(id)
  if (known !== undefined) return known.label

  const projectDir = env.CLAUDE_PROJECT_DIR
  if (projectDir === undefined || projectDir === "") return undefined

  const file = path.join(
    projectDir,
    ".claude",
    "agent-policy",
    "roles",
    `${id}.md`
  )
  if (!fs.existsSync(file)) return undefined
  const label = frontmatter(file).get("label")
  return label === "" ? undefined : label
}

function markerBlock(
  env: NodeJS.ProcessEnv,
  marked: Marked[]
): string | undefined {
  const byRole = new Map<string, string[]>()
  for (const entry of marked) {
    for (const role of entry.roles) {
      if (labelOf(env, role) === undefined) continue
      byRole.set(role, [...(byRole.get(role) ?? []), entry.name])
    }
  }
  if (byRole.size === 0) return undefined

  const lines = [
    "次の Agent は役割マーカーを宣言している。担当表の該当する帯は、これらを優先して使う。同じ帯に複数あるときは依頼内容に近いものを選ぶ。"
  ]
  for (const [role, names] of byRole) {
    lines.push(`- ${labelOf(env, role)}: ${names.join(" / ")}`)
  }
  return lines.join("\n")
}

function unknownRoleBlock(
  env: NodeJS.ProcessEnv,
  marked: Marked[]
): string | undefined {
  const lines: string[] = []
  for (const entry of marked) {
    for (const role of entry.roles) {
      if (labelOf(env, role) === undefined) {
        lines.push(`- ${entry.name}: ${role}`)
      }
    }
  }
  if (lines.length === 0) return undefined
  return [
    "次の Agent 定義は未知の役割 ID を宣言している。無視した。役割 ID の誤記であれば修正する:",
    ...lines
  ].join("\n")
}

function setupBlock(
  env: NodeJS.ProcessEnv,
  marked: Marked[]
): string | undefined {
  const byName = new Map(marked.map((entry) => [entry.name, entry]))
  const lines: string[] = []

  for (const spec of ALIASES) {
    const alias = env[spec.variable]?.trim()
    if (alias === undefined || alias === "") continue
    if (alias === DEFAULT_ALIASES[spec.preset]) continue

    const existing = byName.get(spec.preset)
    if (existing === undefined) {
      lines.push(`- ${spec.preset}: 定義が無い。${spec.skill} を実行する`)
      continue
    }
    if (existing.model !== alias) {
      lines.push(
        `- ${spec.preset}: 定義の model が "${existing.model}" で、${spec.variable} の "${alias}" と食い違う。${spec.skill} を実行する`
      )
    }
  }

  if (lines.length === 0) return undefined
  return [
    "次の Agent は既定と異なるエイリアスが指定されているが、プロジェクト定義が追随していない。エイリアスに依存する委譲を行う前に対処する:",
    ...lines
  ].join("\n")
}

function retiredBlock(marked: Marked[]): string | undefined {
  const found = marked
    .map((entry) => entry.name)
    .filter((name) => RETIRED.includes(name))
  if (found.length === 0) return undefined
  return `次の Agent 定義は廃止済みである。プロジェクト定義は同梱定義より優先されるため削除する: ${found.join(", ")}`
}

function build(env: NodeJS.ProcessEnv): string | undefined {
  let marked: Marked[] = []
  try {
    marked = scan(agentsDir(env))
  } catch {
    // ディレクトリ走査自体が失敗しても、主機能の方針注入は続ける。
  }

  const blocks = [
    policyBlock(env.AMATSUKA_AGENT_AUTO_INJECTION),
    markerBlock(env, marked),
    unknownRoleBlock(env, marked),
    setupBlock(env, marked),
    retiredBlock(marked)
  ].filter((block): block is string => block !== undefined)

  if (blocks.length === 0) return undefined
  return blocks.join("\n\n")
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
  process.stderr.write(
    `agent-policy session-start: ${error instanceof Error ? error.message : "Unexpected error"}\n`
  )
}
