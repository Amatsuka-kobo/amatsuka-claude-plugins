import fs from "node:fs"
import path from "node:path"

export interface HookInput {
  session_id?: string
  tool_name?: string
  tool_input?: { command?: string; file_path?: string; [k: string]: unknown }
  transcript_path?: string
  cwd?: string
  agent_id?: string
  agent_type?: string
  stop_hook_active?: boolean
  [k: string]: unknown
}

interface TranscriptEntry {
  type?: string
  message?: {
    model?: unknown
    content?: TranscriptContent[]
  }
}

interface TranscriptContent {
  type?: string
  name?: string
  input?: {
    skill?: unknown
    file_path?: unknown
  }
}

export async function readStdin(): Promise<HookInput> {
  let data = ""
  for await (const chunk of process.stdin) data += chunk
  return JSON.parse(data) as HookInput
}

export function emit(decision: "deny" | "ask", reason: string): never {
  process.stdout.write(
    JSON.stringify({
      hookSpecificOutput: {
        hookEventName: "PreToolUse",
        permissionDecision: decision,
        permissionDecisionReason: reason
      }
    }) + "\n"
  )
  process.exit(0)
}

// 「意見なし」の素通し。permissionDecision: "allow" は許可システムをバイパスして
// 自動実行になってしまうため、素通しでは何も出力せずに終了する。
export function pass(): never {
  process.exit(0)
}

// transcript(JSONL)に、指定スキルの Skill ツール呼び出しが記録されているか。
// 注入されたトリガー表など「テキスト中のスキル名」に誤反応しないよう、
// tool_use エントリ(name === "Skill")の input.skill だけを見る。
// ファイルが読めない場合は throw する(フェイルオープンの判断は呼び出し側)。
export function hasSkillInvocation(
  transcriptPath: string,
  skillName: string
): boolean {
  const raw = fs.readFileSync(transcriptPath, "utf8")
  for (const line of raw.split("\n")) {
    if (!line.includes('"Skill"')) continue
    let e: TranscriptEntry
    try {
      e = JSON.parse(line) as TranscriptEntry
    } catch {
      continue
    }
    const content = e?.message?.content
    if (!Array.isArray(content)) continue
    for (const item of content) {
      if (
        item?.type === "tool_use" &&
        item.name === "Skill" &&
        item.input?.skill === skillName
      )
        return true
    }
  }
  return false
}

// transcript(JSONL)に、指定スキルの SKILL.md への Read ツール呼び出しが記録されているか。
// Skill ツールを持たないエージェントは SKILL.md を Read することで規律を取り込むため、
// invoke と等価の既読とみなす。パスはインストール場所に依存しないよう末尾一致で判定する。
// ファイルが読めない場合は throw する(フェイルオープンの判断は呼び出し側)。
export function hasSkillFileRead(
  transcriptPath: string,
  skillName: string
): boolean {
  const suffix = `skills/${skillName.split(":")[1]}/SKILL.md`
  const raw = fs.readFileSync(transcriptPath, "utf8")
  for (const line of raw.split("\n")) {
    if (!line.includes('"Read"')) continue
    let e: TranscriptEntry
    try {
      e = JSON.parse(line) as TranscriptEntry
    } catch {
      continue
    }
    const content = e?.message?.content
    if (!Array.isArray(content)) continue
    for (const item of content) {
      if (
        item?.type === "tool_use" &&
        item.name === "Read" &&
        typeof item.input?.file_path === "string" &&
        item.input.file_path.endsWith(suffix)
      )
        return true
    }
  }
  return false
}

// サブエージェント自身の transcript のパス。メインセッションの transcript と同じ階層に
// <session_id>/subagents/agent-<agent_id>.jsonl として置かれる(Claude Code の内部レイアウト。
// 変わった場合は存在チェックで検出してフェイルオープンする想定)。
export function subagentTranscriptPath(
  mainTranscriptPath: string,
  sessionId: string,
  agentId: string
): string {
  return path.join(
    path.dirname(mainTranscriptPath),
    sessionId,
    "subagents",
    `agent-${agentId}.jsonl`
  )
}

// transcript(JSONL)の assistant イベントから、最後に現れた message.model(モデル ID)を返す。
// assistant イベントが無ければ null。ファイルが読めなければ throw(フェイルオープンの判断は呼び出し側)。
export function lastAssistantModel(transcriptPath: string): string | null {
  const raw = fs.readFileSync(transcriptPath, "utf8")
  let model: string | null = null
  for (const line of raw.split("\n")) {
    if (!line.includes('"model"')) continue
    let e: TranscriptEntry
    try {
      e = JSON.parse(line) as TranscriptEntry
    } catch {
      continue
    }
    if (e?.type === "assistant" && typeof e?.message?.model === "string")
      model = e.message.model
  }
  return model
}
