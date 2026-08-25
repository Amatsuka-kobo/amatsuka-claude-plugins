#!/usr/bin/env node
// SessionStart フック: 方針スキルの使用指示と、役割マーカーの対応表を注入する。
// ファイルは書かない。定義の生成は setup-agents が担う。
// 失敗しても Claude Code の起動を妨げないよう、例外は握りつぶして終了コード 0 で終わる。

import fs from "node:fs"
import path from "node:path"
import { policyForInjection } from "../agents/policies"
import { DEFAULT_ALIASES, PRESETS } from "../agents/presets"
import { roleById, sortRoleIds } from "../agents/roles"

// 廃止した定義。プロジェクト側に残っていると同梱プリセットより優先されるため通知する。
const RETIRED = [
  "claude-researcher",
  "gpt-researcher",
  "grok-researcher",
  "grok-implementer"
]

const LABELS = new Map<string, string | undefined>()

interface AliasSpec {
  preset: string
  variable: string
  skill: string
}

const ALIASES: AliasSpec[] = [
  {
    preset: "gpt-sol",
    variable: "AMATSUKA_AGENT_GPT_SOL_ALIAS",
    skill: "agent-policy:setup-agents"
  },
  {
    preset: "gpt-terra",
    variable: "AMATSUKA_AGENT_GPT_TERRA_ALIAS",
    skill: "agent-policy:setup-agents"
  },
  {
    preset: "gpt-luna",
    variable: "AMATSUKA_AGENT_GPT_LUNA_ALIAS",
    skill: "agent-policy:setup-agents"
  },
  {
    preset: "grok",
    variable: "AMATSUKA_AGENT_GROK_ALIAS",
    skill: "agent-policy:setup-agents"
  }
]

interface Marked {
  name: string
  model: string | undefined
  roles: string[]
}

function policyBlock(value: string | undefined): string | undefined {
  if (value === undefined || value === "" || value === "none") return undefined

  const policy = policyForInjection(value)
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
// プロジェクト側の役割断片(.claude/agent-policy/roles/<id>.md または
// .claude/agent-policy/roles/<lang>/<id>.md)の label を読む。
// setup はプロジェクト側断片の役割 ID もマーカーへ書き込むため、ここで拾えないと
// 「未知の役割」として誤って報告してしまう。
function labelOf(env: NodeJS.ProcessEnv, id: string): string | undefined {
  const cached = LABELS.get(id)
  if (cached !== undefined || LABELS.has(id)) return cached

  const known = roleById(id)
  if (known !== undefined) {
    LABELS.set(id, known.label)
    return known.label
  }

  const projectDir = env.CLAUDE_PROJECT_DIR
  if (projectDir === undefined || projectDir === "") {
    LABELS.set(id, undefined)
    return undefined
  }

  const base = path.join(projectDir, ".claude", "agent-policy", "roles")
  const candidates = [path.join(base, `${id}.md`)]
  try {
    if (fs.existsSync(base)) {
      for (const entry of fs.readdirSync(base, { withFileTypes: true })) {
        if (entry.isDirectory()) {
          candidates.push(path.join(base, entry.name, `${id}.md`))
        }
      }
    }
  } catch {
    // 走査に失敗しても、直下の候補だけで解決を試みる。
  }

  for (const file of candidates) {
    try {
      if (!fs.existsSync(file)) continue
      const label = frontmatter(file).get("label")
      const resolved = label === "" ? undefined : label
      LABELS.set(id, resolved)
      return resolved
    } catch {
      // 1 ファイルが読めなくても、他の候補と方針注入は生かす。
    }
  }

  LABELS.set(id, undefined)
  return undefined
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
  for (const role of sortRoleIds([...byRole.keys()])) {
    const names = byRole.get(role)
    if (names !== undefined) {
      lines.push(`- ${labelOf(env, role)}: ${names.join(" / ")}`)
    }
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

    const preset = PRESETS.find((entry) => entry.name === spec.preset)
    const named = byName.get(spec.preset)

    // 名前一致の定義が正しい model を持てば従来どおり充足。
    if (named?.model === alias) continue

    // PRESETS と ALIASES がずれた場合は、名前一致だけの旧判定へ落とす。
    if (preset === undefined) {
      if (named === undefined) {
        lines.push(`- ${spec.preset}: 定義が無い。${spec.skill} を実行する`)
      } else {
        lines.push(
          `- ${spec.preset}: 定義の model が "${named.model ?? "未設定"}" で、${spec.variable} の "${alias}" と食い違う。${spec.skill} を実行する`
        )
      }
      continue
    }

    const withAlias = marked.filter((entry) => entry.model === alias)
    const covered = new Set(withAlias.flatMap((entry) => entry.roles))
    const missing = preset.roleIds.filter((role) => !covered.has(role))
    if (missing.length === 0) continue

    if (withAlias.length === 0) {
      if (named === undefined) {
        lines.push(
          `- ${spec.preset}: ${spec.variable} の "${alias}" を model に持つ定義が無い。${spec.skill} を実行する`
        )
      } else {
        lines.push(
          `- ${spec.preset}: 定義の model が "${named.model ?? "未設定"}" で、${spec.variable} の "${alias}" と食い違う。${spec.skill} を実行する`
        )
      }
    } else {
      lines.push(
        `- ${spec.preset}: ${withAlias.map((entry) => entry.name).join(" / ")} が "${alias}" を使っているが、${missing.join(", ")} を宣言する定義が無い。${spec.skill} を実行する`
      )
    }
  }

  if (lines.length === 0) return undefined
  return [
    "次の Agent は既定と異なるエイリアスが指定されているが、プロジェクト定義が追随していない。エイリアスに依存する委譲を行う前に対処する:",
    ...lines
  ].join("\n")
}

function retiredBlock(
  env: NodeJS.ProcessEnv,
  marked: Marked[]
): string | undefined {
  const found = marked
    .map((entry) => entry.name)
    .filter((name) => RETIRED.includes(name))
  if (found.length === 0) return undefined

  const lines = [
    `次の Agent 定義は廃止済みである。プロジェクト定義は同梱定義より優先されるため削除する: ${found.join(", ")}`
  ]
  const grokAlias = env.AMATSUKA_AGENT_GROK_ALIAS?.trim()
  if (
    found.some((name) => name.startsWith("grok-")) &&
    (grokAlias === undefined || grokAlias === "")
  ) {
    lines.push(
      "Grok の既定エイリアスは `claude-grok-4-6` へ変わった。プロキシ設定にこの別名が無い場合、委譲時に `unknown provider for model` で失敗する。4.5 を使い続けるなら `AMATSUKA_AGENT_GROK_ALIAS=claude-grok-4-5` を設定する。"
    )
  }
  return lines.join("\n")
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
    retiredBlock(env, marked)
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
