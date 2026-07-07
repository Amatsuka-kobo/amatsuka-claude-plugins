import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js"
import { z } from "zod"
import { evaluateArtifact, type PipelineDeps } from "../core/pipeline.js"
import type { Artifact } from "../core/types.js"
import { failClosed, objectiveSchema, runIdSchema } from "./shared.js"

export const evaluatePlanInput = {
  runId: runIdSchema,
  objective: objectiveSchema,
  plan: z.string().optional().describe("計画の本文"),
  steps: z.array(z.string()).optional().describe("計画のステップ配列"),
  constraints: z.array(z.string()).optional()
}

type EvaluatePlanArgs = {
  runId: string
  objective: string
  plan?: string
  steps?: string[]
  constraints?: string[]
}

export function toPlanArtifact(args: EvaluatePlanArgs): Artifact {
  const steps = args.steps ?? []
  const content =
    args.plan ??
    (steps.length > 0
      ? steps.map((s, i) => `${i + 1}. ${s}`).join("\n")
      : undefined)
  if (content === undefined) {
    throw new Error("plan または steps のいずれかが必須です")
  }
  return {
    kind: "plan",
    runId: args.runId,
    objective: args.objective,
    content,
    changedPaths: [],
    steps,
    context: { constraints: args.constraints }
  }
}

export function registerEvaluatePlan(
  server: McpServer,
  deps: PipelineDeps
): void {
  server.registerTool(
    "evaluate_plan",
    {
      description:
        "AI が立てた仕様・作業計画を検査し、PROCEED / ASK / STOP の判定を返す。",
      inputSchema: evaluatePlanInput
    },
    (args) =>
      failClosed(args.runId, deps, () =>
        evaluateArtifact(toPlanArtifact(args), deps)
      )
  )
}
