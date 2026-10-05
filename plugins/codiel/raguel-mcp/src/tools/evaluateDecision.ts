import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js"
import { z } from "zod"
import type { PipelineDeps } from "../core/pipeline.js"
import { commonInput, runEvaluation } from "./shared.js"

/**
 * evaluate_decision の入力(設計書 §6.2.4)。decision・optionsConsidered・rollbackPlan は
 * すべて検査の本文に入る(所見 F6)
 */
export const evaluateDecisionInput = z.strictObject({
  ...commonInput,
  decision: z.string().min(1).describe("AI が下した判断の内容"),
  optionsConsidered: z
    .array(z.string())
    .optional()
    .describe("検討した代替案。番号付きの行として検査の本文に入る"),
  rollbackPlan: z
    .string()
    .optional()
    .describe("切り戻しの計画。検査の本文に入る")
})

export function registerEvaluateDecision(
  server: McpServer,
  deps: PipelineDeps
): void {
  server.registerTool(
    "evaluate_decision",
    {
      description:
        "AI が下した判断を、代替案と切り戻しの計画を含めて検査し、PROCEED / ASK / STOP の判定を返す。",
      inputSchema: evaluateDecisionInput
    },
    (args, extra) =>
      runEvaluation({ tool: "evaluate_decision", ...args }, deps, extra)
  )
}
