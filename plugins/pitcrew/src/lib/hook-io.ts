import fs from "node:fs"
import path from "node:path"
import { pitcrewDir } from "./run.js"

// Claude Code hooks の stdin JSON(既存プラグインの hook 実装で確認済みのスキーマ)。
// SubagentStop: session_id / transcript_path / cwd / stop_hook_active / agent_id / agent_type
// PostToolUse: 上記 + tool_name / tool_input / tool_response
// PostToolUseFailure: 上記 + tool_name / tool_input / error / tool_response
export interface HookInput {
  session_id?: string
  transcript_path?: string
  cwd?: string
  hook_event_name?: string
  tool_name?: string
  tool_input?: { command?: string; file_path?: string; [k: string]: unknown }
  tool_response?: unknown
  error?: string
  agent_id?: string
  agent_type?: string
  stop_hook_active?: boolean
  [k: string]: unknown
}

export function readStdinSync(): HookInput | null {
  try {
    return JSON.parse(fs.readFileSync(0, "utf8")) as HookInput
  } catch {
    return null
  }
}

export function resolveProjectDir(input: HookInput): string {
  return process.env.CLAUDE_PROJECT_DIR || input.cwd || process.cwd()
}

// フェイルオープン(設計書 §9): 例外は .pitcrew/log/ に記録して黙って続行。
// ログ書き込み自体の失敗も握り潰す(セッションを絶対に阻害しない)。
export function logError(
  projectDir: string,
  context: string,
  err: unknown
): void {
  try {
    const logDir = path.join(pitcrewDir(projectDir), "log")
    fs.mkdirSync(logDir, { recursive: true })
    const message =
      err instanceof Error ? (err.stack ?? err.message) : String(err)
    fs.appendFileSync(
      path.join(logDir, "errors.log"),
      `${new Date().toISOString()} [${context}] ${message}\n`
    )
  } catch {
    // 何もしない
  }
}
