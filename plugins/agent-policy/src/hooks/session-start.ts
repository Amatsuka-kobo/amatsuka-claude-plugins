#!/usr/bin/env node
// SessionStart フック: 方針スキルの使用指示を additionalContext として注入する。
// 失敗しても Claude Code の起動を妨げないよう、例外は握りつぶして終了コード 0 で終わる。

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

function build(env: NodeJS.ProcessEnv): string | undefined {
  const blocks = [policyBlock(env.AMATSUKA_AGENT_AUTO_INJECTION)].filter(
    (block): block is string => block !== undefined
  )
  return blocks.length === 0 ? undefined : blocks.join("\n\n")
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
