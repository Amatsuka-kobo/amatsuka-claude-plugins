#!/usr/bin/env node
// SubagentStart フック: better-agentics の定義で起動したサブエージェントに、サブエージェントの規律を注入する。
// 失敗してもサブエージェントの起動を妨げないよう、例外は標準エラーに書いて終了コード 0 で終わる。

import fs from "node:fs"
import path from "node:path"
import { projectDirOf, scanDefinitions } from "../lib/agents"
import { pluginRoot } from "../lib/fragments"
import { orchestrationState, subagentPolicyApplies } from "../lib/state"
import { readStdin } from "./stdin"

try {
  const input = await readStdin()
  const agentType = input.agent_type
  if (
    agentType !== undefined &&
    subagentPolicyApplies(orchestrationState(process.env))
  ) {
    const projectDir = projectDirOf(process.env, input.cwd ?? process.cwd())
    // agent_type は定義の name と突き合わせる。ファイル名とは突き合わせない。
    const matched = scanDefinitions(projectDir).some(
      (entry) => entry.name === agentType
    )
    if (matched) {
      const policy = fs.readFileSync(
        path.join(pluginRoot(), "references", "subagent-policy.md"),
        "utf8"
      )
      process.stdout.write(
        `${JSON.stringify({
          hookSpecificOutput: {
            hookEventName: "SubagentStart",
            additionalContext: policy
          }
        })}\n`
      )
    }
  }
} catch (error) {
  process.stderr.write(
    `better-agentics subagent-start: ${error instanceof Error ? error.message : "Unexpected error"}\n`
  )
}
