#!/usr/bin/env node
// PreToolUse フック: 独立タスクを同一メッセージ内で並列 dispatch する規律を注入する。
// ファイルは書かず、失敗しても Claude Code の処理を妨げない。

const PARALLEL_NUDGE =
  "並列 dispatch の確認: まだ着手していない独立タスクが残っているなら、後続のメッセージではなく、この dispatch と同じメッセージ内で並列に dispatch する。逐次にするのは前の出力に依存するときだけである。"

function respond(context: string): void {
  process.stdout.write(
    `${JSON.stringify({
      hookSpecificOutput: {
        hookEventName: "PreToolUse",
        additionalContext: context
      }
    })}\n`
  )
}

try {
  const value = process.env.AMATSUKA_AGENT_PARALLEL_NUDGE?.trim().toLowerCase()
  if (value !== "0" && value !== "false" && value !== "off") {
    respond(PARALLEL_NUDGE)
  }
} catch (error) {
  process.stderr.write(
    `agent-policy parallel-nudge: ${error instanceof Error ? error.message : "Unexpected error"}\n`
  )
}
