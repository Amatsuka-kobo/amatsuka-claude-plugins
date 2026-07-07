/**
 * Raguel MCP サーバーのエントリポイント。
 * stdio transport で 6 ツールを公開する(DESIGN.md §4)。
 * stdout は JSON-RPC 専用線 — ログはすべて stderr(core/log.ts)。
 */

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js"
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js"
import { CaseStore } from "./casefile/store.js"
import { loadConfig } from "./config/loader.js"
import { log } from "./core/log.js"
import type { PipelineDeps } from "./core/pipeline.js"
import { ClaudeCliProvider } from "./panel/claudeCli.js"
import { NoneProvider } from "./panel/provider.js"
import { registerEvaluateCode } from "./tools/evaluateCode.js"
import { registerEvaluateDecision } from "./tools/evaluateDecision.js"
import { registerEvaluateDesign } from "./tools/evaluateDesign.js"
import { registerEvaluatePlan } from "./tools/evaluatePlan.js"
import { registerListRules } from "./tools/listRules.js"
import { registerRecordOutcome } from "./tools/recordOutcome.js"

// 再帰ガード: パネリストとして起動された claude が(プロジェクト設定経由で)
// raguel を再起動する無限ループを断つ(§7 リスク対策の二次防壁)
if (process.env.RAGUEL_PANELIST === "1") {
  process.stderr.write(
    "[raguel] RAGUEL_PANELIST=1 を検出したため起動しません(再帰防止)\n"
  )
  process.exit(0)
}

async function main(): Promise<void> {
  // 設定不備はフェイルクローズド = 起動失敗(§11)
  const { config, configHash, source } = loadConfig()

  const deps: PipelineDeps = {
    config,
    configHash,
    caseStore: new CaseStore(config),
    provider:
      config.judge.provider === "claude-cli"
        ? new ClaudeCliProvider(config.judge.maxConcurrency)
        : new NoneProvider()
  }

  const server = new McpServer({ name: "raguel-mcp", version: "0.1.0" })
  registerEvaluateDecision(server, deps)
  registerEvaluatePlan(server, deps)
  registerEvaluateDesign(server, deps)
  registerEvaluateCode(server, deps)
  registerListRules(server, deps)
  registerRecordOutcome(server, deps)

  await server.connect(new StdioServerTransport())
  log.info("raguel-mcp が起動しました", {
    configSource: source,
    configHash,
    provider: config.judge.provider
  })
}

main().catch((err) => {
  log.error("起動に失敗しました(フェイルクローズド)", {
    message: err instanceof Error ? err.message : String(err)
  })
  process.exit(1)
})
