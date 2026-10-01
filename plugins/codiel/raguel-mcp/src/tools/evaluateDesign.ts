import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js"
import type { PipelineDeps } from "../core/pipeline.js"
import { documentInput } from "./evaluatePlan.js"
import { runEvaluation } from "./shared.js"

export function registerEvaluateDesign(
  server: McpServer,
  deps: PipelineDeps
): void {
  server.registerTool(
    "evaluate_design",
    {
      description:
        "設計の文書(design・intent-sync)を paths から読んで検査し、PROCEED / ASK / STOP の判定を返す。",
      inputSchema: documentInput
    },
    (args, extra) =>
      runEvaluation({ tool: "evaluate_design", ...args }, deps, extra)
  )
}
