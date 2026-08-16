// hook 出力の組み立て。形式はファイル契約 §12 に従う。
// リポジトリ内の既存実装(codiel / revelation / agent-policy)と同一の形に揃える。

export interface HookInput {
  tool_input?: {
    file_path?: string
    notebook_path?: string
    [k: string]: unknown
  }
  cwd?: string
  [k: string]: unknown
}

export async function readStdin(): Promise<HookInput> {
  let data = ""
  for await (const chunk of process.stdin) data += chunk
  return JSON.parse(data) as HookInput
}

export function emit(decision: "deny" | "ask", reason: string): never {
  process.stdout.write(
    `${JSON.stringify({
      hookSpecificOutput: {
        hookEventName: "PreToolUse",
        permissionDecision: decision,
        permissionDecisionReason: reason
      }
    })}\n`
  )
  process.exit(0)
}

// 「意見なし」の素通し。permissionDecision: "allow" は許可システムをバイパスして
// 自動実行になってしまうため、素通しでは何も出力せずに終了する。
export function pass(): never {
  process.exit(0)
}

// SessionStart 用の注入出力。
export function injectContext(content: string): void {
  process.stdout.write(
    `${JSON.stringify({
      hookSpecificOutput: {
        hookEventName: "SessionStart",
        additionalContext: content
      }
    })}\n`
  )
}
