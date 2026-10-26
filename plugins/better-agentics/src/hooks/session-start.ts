#!/usr/bin/env node
// SessionStart フック: 環境変数の状態に応じて、オーケストレーターの規律の使用指示か警告を注入する。
// 失敗しても Claude Code の起動を妨げないよう、例外は標準エラーに書いて終了コード 0 で終わる。

import { inspect, projectDirOf, scanDefinitions } from "../lib/agents"
import { roleById } from "../lib/roles"
import { type OrchestrationState, orchestrationState } from "../lib/state"
import { readStdin } from "./stdin"

const INSTRUCTION =
  "最初に better-agentics:orchestration スキルを使用する。スキルの規律に従う。"

function warning(state: OrchestrationState): string | undefined {
  switch (state.kind) {
    case "unknown-value":
      return `AMATSUKA_AGENT_ENABLE_ORCHESTRATION の値 "${state.value}" は未知のため、better-agentics の規律を注入しなかった。1 / true / on で有効、0 / false / off で無効になる。`
    case "conflict-injection":
      return "AMATSUKA_AGENT_ENABLE_ORCHESTRATION と AMATSUKA_AGENT_AUTO_INJECTION が同時に有効なため、better-agentics の規律を注入しなかった。どちらか一方だけを有効にする。"
    case "conflict-gate":
      return "AMATSUKA_AGENT_DELEGATION_GATE が有効で、オーケストレーターの直接編集が差し止められるため、better-agentics の規律を注入しなかった。better-agentics ではオーケストレーターが自分で編集するので、gate を無効にする。"
    case "no-api-key":
      return "TYPESAFE_API_KEY が設定されていないため、better-agentics の規律を注入しなかった。委譲先の決定に TypeSafe AI の Jev を使うため、キーが必要になる。"
    default:
      return undefined
  }
}

function definitionNotes(projectDir: string): string[] {
  let definitions: ReturnType<typeof scanDefinitions>
  try {
    definitions = scanDefinitions(projectDir)
  } catch {
    // 走査に失敗しても、使用指示の注入は続ける。
    return []
  }
  if (definitions.length === 0) {
    return [
      "better-agentics-role を持つ Agent 定義が無い。委譲を使うには better-agentics:setup で定義を作る。"
    ]
  }
  const { duplicates, unknownRoles } = inspect(definitions)
  const notes: string[] = []
  if (duplicates.length > 0) {
    notes.push(
      [
        "次の役割を 2 件以上の定義が持つ。委譲先を決められないため、better-agentics:setup で 1 件に絞る。",
        ...duplicates.map(
          (entry) =>
            `- ${roleById(entry.role)?.label ?? entry.role} [${entry.role}]: ${entry.names.join(", ")}`
        )
      ].join("\n")
    )
  }
  if (unknownRoles.length > 0) {
    notes.push(
      [
        "次の定義は役割表に無い role-id を持つため、委譲先の候補にならない。",
        ...unknownRoles.map((entry) => `- ${entry.name}: ${entry.role}`)
      ].join("\n")
    )
  }
  return notes
}

function build(env: NodeJS.ProcessEnv, cwd: string): string | undefined {
  const state = orchestrationState(env)
  if (state.kind === "off") return undefined
  if (state.kind !== "inject") return warning(state)
  return [INSTRUCTION, ...definitionNotes(projectDirOf(env, cwd))].join("\n\n")
}

try {
  const input = await readStdin()
  const context = build(process.env, input.cwd ?? process.cwd())
  if (context !== undefined) {
    process.stdout.write(
      `${JSON.stringify({
        hookSpecificOutput: {
          hookEventName: "SessionStart",
          additionalContext: context
        }
      })}\n`
    )
  }
} catch (error) {
  process.stderr.write(
    `better-agentics session-start: ${error instanceof Error ? error.message : "Unexpected error"}\n`
  )
}
