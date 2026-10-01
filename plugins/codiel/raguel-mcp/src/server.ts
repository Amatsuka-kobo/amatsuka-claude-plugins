/**
 * Raguel MCP サーバーのエントリポイント。stdio で 8 つのツールを公開する(設計書 §6.2)。
 * stdout は JSON-RPC 専用なので、ログはすべて stderr に書く(core/log.ts)。
 * 設定が壊れていても起動し、評価は ASK・degraded、list_rules は理由を返す(§6.12.4)。
 */

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js"
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js"
import { log } from "./core/log.js"
import type { PipelineDeps } from "./core/pipeline.js"
import { resolveProjectRoot } from "./project/root.js"
import { registerEvaluateCode } from "./tools/evaluateCode.js"
import { registerEvaluateDecision } from "./tools/evaluateDecision.js"
import { registerEvaluateDesign } from "./tools/evaluateDesign.js"
import { registerEvaluatePlan } from "./tools/evaluatePlan.js"
import { registerListPrecedents } from "./tools/listPrecedents.js"
import { registerListRules } from "./tools/listRules.js"
import { registerRecordOutcome } from "./tools/recordOutcome.js"
import { registerRetirePrecedent } from "./tools/retirePrecedent.js"
import { createRuntimeSource } from "./tools/shared.js"

/** build.ts が esbuild の define で package.json の version を埋め込む */
declare const __RAGUEL_VERSION__: string
const BUILD_VERSION =
  typeof __RAGUEL_VERSION__ === "string" ? __RAGUEL_VERSION__ : "unbundled"

async function main(): Promise<void> {
  const deps: PipelineDeps = {
    runtime: createRuntimeSource(),
    projectRoot: resolveProjectRoot(process.cwd()),
    buildVersion: BUILD_VERSION
  }

  const server = new McpServer({ name: "raguel-mcp", version: BUILD_VERSION })
  for (const register of [
    registerEvaluateDecision,
    registerEvaluatePlan,
    registerEvaluateDesign,
    registerEvaluateCode,
    registerListRules,
    registerRecordOutcome,
    registerListPrecedents,
    registerRetirePrecedent
  ]) {
    register(server, deps)
  }

  await server.connect(new StdioServerTransport())
  log.info("raguel-mcp が起動しました", { version: BUILD_VERSION })
}

main().catch((err) => {
  log.error("起動に失敗しました", {
    message: err instanceof Error ? err.message : String(err)
  })
  process.exit(1)
})
