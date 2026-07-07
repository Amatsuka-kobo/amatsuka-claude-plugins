import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js"
import { z } from "zod"
import { evaluateArtifact, type PipelineDeps } from "../core/pipeline.js"
import type { Artifact } from "../core/types.js"
import { failClosed, objectiveSchema, runIdSchema } from "./shared.js"

export const evaluateDesignInput = {
  runId: runIdSchema,
  objective: objectiveSchema,
  design: z.string().min(1).describe("設計文書の本文"),
  requirements: z.array(z.string()).optional()
}

type EvaluateDesignArgs = {
  runId: string
  objective: string
  design: string
  requirements?: string[]
}

export function toDesignArtifact(args: EvaluateDesignArgs): Artifact {
  return {
    kind: "design",
    runId: args.runId,
    objective: args.objective,
    content: args.design,
    changedPaths: [],
    steps: [],
    context: { requirements: args.requirements }
  }
}

export function registerEvaluateDesign(
  server: McpServer,
  deps: PipelineDeps
): void {
  server.registerTool(
    "evaluate_design",
    {
      description:
        "AI が書いた設計文書を検査し、PROCEED / ASK / STOP の判定を返す。",
      inputSchema: evaluateDesignInput
    },
    (args) =>
      failClosed(args.runId, deps, () =>
        evaluateArtifact(toDesignArtifact(args), deps)
      )
  )
}
