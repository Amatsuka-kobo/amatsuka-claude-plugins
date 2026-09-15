#!/usr/bin/env node
// SessionStart フック: 2 プロファイルの方針と、その構成の候補集合による役割対応表を注入する。
// ファイルは書かない。定義の生成は setup-agents が担う。
// 失敗しても Claude Code の起動を妨げないよう、例外は握りつぶして終了コード 0 で終わる。

import { fetchLiveModels } from "../agents/live-models"
import {
  isCustomInjection,
  type PolicyName,
  runsOnClaude
} from "../agents/policies"
import {
  candidateAgents,
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

const DEPRECATED_ALIAS_VARIABLES = [
  "AMATSUKA_AGENT_GPT_SOL_ALIAS",
  "AMATSUKA_AGENT_GPT_TERRA_ALIAS",
  "AMATSUKA_AGENT_GPT_LUNA_ALIAS",
  "AMATSUKA_AGENT_GROK_ALIAS"
]

const REPAIR_BLOCK =
  "修復するには、agent-policy:setup-agents を再実行するか、定義の `model` を修正するか、プロキシを起動してからセッションを再起動する。"

function policyBlock(policy: PolicyName, legacyValue?: string): string {
  const instruction = `最初に必ず agent-policy:${policy} スキルを使用し、この規律に従う`
  if (legacyValue === undefined) return instruction
  return `${instruction}\n旧互換値 \`${legacyValue}\` を使用している。\`AMATSUKA_AGENT_AUTO_INJECTION\` を \`custom\` へ変更する。`
}

function unknownInjectionBlock(value: string): string {
  return `AMATSUKA_AGENT_AUTO_INJECTION の値 "${value}" は未知のため、agent-policy の方針注入をスキップした。`
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

function retiredBlock(marked: MarkedAgent[]): string | undefined {
  const found = marked
    .map((entry) => entry.name)
    .filter((name) => RETIRED.includes(name))
  if (found.length === 0) return undefined
  return `次の Agent 定義は廃止済みである。プロジェクト定義は同梱定義より優先されるため削除する: ${found.join(", ")}`
}

function deprecatedAliasesBlock(env: NodeJS.ProcessEnv): string | undefined {
  if (
    !DEPRECATED_ALIAS_VARIABLES.some((variable) => env[variable] !== undefined)
  ) {
    return undefined
  }
  return "AMATSUKA_AGENT_GPT_SOL_ALIAS / AMATSUKA_AGENT_GPT_TERRA_ALIAS / AMATSUKA_AGENT_GPT_LUNA_ALIAS / AMATSUKA_AGENT_GROK_ALIAS のエイリアス変数は参照されなくなった。モデルは agent-policy:setup-agents が /v1/models から選ぶ。定義の `model` 値を変えたいときは setup を再実行する。"
}

function markerlessFallbackBlock(): string {
  return "役割マーカー付き定義が見つからない(未作成、または読み取れない)ため、claude プロファイルで動作する。agent-policy:setup-agents で構成を作る。"
}

function missingModelsBlock(
  missing: Array<MarkedAgent & { model: string }>
): string {
  const limit = 10
  const lines = missing
    .slice(0, limit)
    .map(
      (entry) =>
        `- 定義 \`${entry.name}\` の model \`${entry.model}\` がプロキシの /v1/models に存在しない`
    )
  const remaining = missing.length - limit
  if (remaining > 0) lines.push(`- 他 ${remaining} 件`)
  return [
    "定義された model がプロキシの /v1/models に 1 件以上存在しないため、セッション全体を claude プロファイルへフォールバックした。",
    ...lines
  ].join("\n")
}

function queryFailureBlock(reason: string | undefined): string {
  const actualReason = reason ?? "fetch-failed"
  const detail =
    actualReason === "no-base-url"
      ? `ANTHROPIC_BASE_URL が未設定(${actualReason})`
      : actualReason === "timeout"
        ? `プロキシへ接続できない(${actualReason})`
        : `プロキシの /v1/models を照会できない(${actualReason})`
  return `${detail}のため custom 構成のモデル実在を確認できず、セッション全体を claude プロファイルへフォールバックした。`
}

function claudeBlocks(
  env: NodeJS.ProcessEnv,
  marked: MarkedAgent[],
  legacyValue?: string,
  ...extra: Array<string | undefined>
): Array<string | undefined> {
  const candidates = candidateAgents(marked, "claude-only")
  return [
    policyBlock("claude-model-policy", legacyValue),
    ...extra,
    markerTable(env, candidates, "claude-only"),
    unknownRoleBlock(env, candidates)
  ]
}

function successBlocks(
  env: NodeJS.ProcessEnv,
  marked: MarkedAgent[],
  legacyValue?: string
): Array<string | undefined> {
  return [
    policyBlock("custom-policy", legacyValue),
    markerTable(env, candidateAgents(marked, "with-external"), "with-external"),
    unknownRoleBlock(env, marked)
  ]
}

async function customBlocks(
  env: NodeJS.ProcessEnv,
  marked: MarkedAgent[],
  injection: string
): Promise<Array<string | undefined>> {
  const legacyValue = injection === "custom" ? undefined : injection
  const targets = marked.filter((entry) => entry.roles.length > 0)
  if (targets.length === 0) {
    return claudeBlocks(
      env,
      marked,
      legacyValue,
      markerlessFallbackBlock(),
      REPAIR_BLOCK
    )
  }

  const external = targets.filter(
    (entry): entry is MarkedAgent & { model: string } =>
      entry.model !== undefined && !runsOnClaude(entry.model)
  )
  const externalModels = new Set(external.map((entry) => entry.model))
  if (externalModels.size === 0) {
    return successBlocks(env, targets, legacyValue)
  }

  const live = await fetchLiveModels(env)
  if (!live.ok) {
    return claudeBlocks(
      env,
      marked,
      legacyValue,
      queryFailureBlock(live.reason),
      REPAIR_BLOCK
    )
  }

  const liveIds = new Set(live.ids)
  const missing = external.filter((entry) => !liveIds.has(entry.model))
  if (missing.length > 0) {
    return claudeBlocks(
      env,
      marked,
      legacyValue,
      missingModelsBlock(missing),
      REPAIR_BLOCK
    )
  }

  return successBlocks(env, targets, legacyValue)
}

function compact(blocks: Array<string | undefined>): string[] {
  return blocks.filter((block): block is string => block !== undefined)
}

async function build(env: NodeJS.ProcessEnv): Promise<string | undefined> {
  let marked: MarkedAgent[] = []
  try {
    marked = scanAgents(projectAgentsDir(env))
  } catch {
    // ディレクトリ走査自体が失敗しても、主機能の方針注入は続ける。
  }

  const injection =
    env.AMATSUKA_AGENT_AUTO_INJECTION?.trim().toLowerCase() ?? ""
  let profileBlocks: Array<string | undefined>

  if (injection === "" || injection === "none") {
    profileBlocks = []
  } else if (injection === "claude") {
    profileBlocks = claudeBlocks(env, marked)
  } else if (isCustomInjection(injection)) {
    profileBlocks = await customBlocks(env, marked, injection)
  } else {
    profileBlocks = [unknownInjectionBlock(injection)]
  }

  const blocks = compact([
    ...profileBlocks,
    retiredBlock(marked),
    deprecatedAliasesBlock(env)
  ])
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
  const context = await build(process.env)
  if (context !== undefined) respond(context)
} catch (error) {
  process.stderr.write(
    `agent-policy session-start: ${error instanceof Error ? error.message : "Unexpected error"}\n`
  )
}
