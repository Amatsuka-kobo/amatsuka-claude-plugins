import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js"
import { z } from "zod"
import type { PipelineDeps } from "../core/pipeline.js"
import { MAX_PATHS } from "../subject/files.js"
import { commonInput, runEvaluation } from "./shared.js"

/**
 * evaluate_plan と evaluate_design の入力(設計書 §6.2.3)。本文は Raguel が paths のファイルから読む。
 * 呼び出し側が本文を渡す旧入力は廃止し、未知のキーは入力の誤りにする(所見 F1)
 */
export const documentInput = z.strictObject({
  ...commonInput,
  paths: z
    .array(z.string().min(1))
    .min(1)
    .max(MAX_PATHS)
    .describe(
      `repoPath 相対のファイルのパス(1〜${MAX_PATHS} 件)。追跡されていないファイルも読む`
    )
})

export function registerEvaluatePlan(
  server: McpServer,
  deps: PipelineDeps
): void {
  server.registerTool(
    "evaluate_plan",
    {
      description:
        "計画の文書(test-spec・dev-plan)を paths から読んで検査し、PROCEED / ASK / STOP の判定を返す。",
      inputSchema: documentInput
    },
    (args, extra) =>
      runEvaluation({ tool: "evaluate_plan", ...args }, deps, extra)
  )
}
