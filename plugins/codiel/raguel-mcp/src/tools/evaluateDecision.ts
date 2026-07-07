import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js"
import { z } from "zod"
import { evaluateArtifact, type PipelineDeps } from "../core/pipeline.js"
import type { Artifact } from "../core/types.js"
import { failClosed, objectiveSchema, runIdSchema } from "./shared.js"

export const evaluateDecisionInput = {
  runId: runIdSchema,
  objective: objectiveSchema,
  decision: z.string().min(1).describe("AI が下した判断の内容"),
  optionsConsidered: z.array(z.string()).optional().describe("検討した代替案"),
  rollbackPlan: z.string().optional().describe("切り戻し計画")
}

type EvaluateDecisionArgs = {
  runId: string
  objective: string
  decision: string
  optionsConsidered?: string[]
  rollbackPlan?: string
}

export function toDecisionArtifact(args: EvaluateDecisionArgs): Artifact {
  return {
    kind: "decision",
    runId: args.runId,
    objective: args.objective,
    content: args.decision,
    changedPaths: [],
    steps: [],
    context: {
      optionsConsidered: args.optionsConsidered,
      rollbackPlan: args.rollbackPlan
    }
  }
}

export function registerEvaluateDecision(
  server: McpServer,
  deps: PipelineDeps
): void {
  server.registerTool(
    "evaluate_decision",
    {
      description:
        "AI が下した個別の判断を検査し、PROCEED / ASK / STOP の判定を返す。",
      inputSchema: evaluateDecisionInput
    },
    (args) =>
      failClosed(args.runId, deps, () =>
        evaluateArtifact(toDecisionArtifact(args), deps)
      )
  )
}
