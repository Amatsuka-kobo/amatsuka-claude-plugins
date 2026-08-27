#!/usr/bin/env node
// SessionStart フック: 方針スキルの使用指示と、役割マーカーの対応表を注入する。
// ファイルは書かない。定義の生成は setup-agents が担う。
// 失敗しても Claude Code の起動を妨げないよう、例外は握りつぶして終了コード 0 で終わる。

import { policyForInjection } from "../agents/policies"
import { DEFAULT_ALIASES, PRESETS } from "../agents/presets"
import {
  type MarkedAgent,
  markerTable,
  projectAgentsDir,
  roleLabels,
  scanAgents
} from "./marker-scan"

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

function policyBlock(value: string | undefined): string | undefined {
  if (value === undefined || value === "" || value === "none") return undefined

  const policy = policyForInjection(value)
  if (policy === undefined) {
    return `AMATSUKA_AGENT_AUTO_INJECTION の値 "${value}" は未知のため、agent-policy の方針注入をスキップした。`
  }
  return `最初に必ず agent-policy:${policy} スキルを使用し、この規律に従う`
}

function unknownRoleBlock(
  env: NodeJS.ProcessEnv,
  marked: MarkedAgent[]
): string | undefined {
  const labelOf = roleLabels(env)
  const lines: string[] = []
  for (const entry of marked) {
    for (const role of entry.roles) {
      if (labelOf(role) === undefined) {
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
  marked: MarkedAgent[]
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
  marked: MarkedAgent[]
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
  let marked: MarkedAgent[] = []
  try {
    marked = scanAgents(projectAgentsDir(env))
  } catch {
    // ディレクトリ走査自体が失敗しても、主機能の方針注入は続ける。
  }

  const blocks = [
    policyBlock(env.AMATSUKA_AGENT_AUTO_INJECTION),
    markerTable(env, marked),
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
