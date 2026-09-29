import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js"
import { z } from "zod"
import type { Artifact } from "../core/types.js"
import {
  type DepsSource,
  failClosed,
  InputError,
  objectiveSchema,
  runIdSchema
} from "./shared.js"

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

/**
 * 検査の本文は、plan・steps(番号付きの行)・constraints のうち渡されたものを、この順につないだもの
 * (決定 83 の (5))。steps の配列は従来どおり plan/max-steps と重さの判定に渡す。
 */
export function toPlanArtifact(args: EvaluatePlanArgs): Artifact {
  const steps = args.steps ?? []
  if (args.plan === undefined && steps.length === 0) {
    throw new InputError("plan または steps のいずれかが必須です")
  }
  const parts: string[] = []
  if (args.plan !== undefined) parts.push(args.plan)
  if (steps.length > 0) {
    parts.push(steps.map((s, i) => `${i + 1}. ${s}`).join("\n"))
  }
  if (args.constraints && args.constraints.length > 0) {
    parts.push(args.constraints.join("\n"))
  }
  return {
    kind: "plan",
    runId: args.runId,
    objective: args.objective,
    content: parts.join("\n\n"),
    changedPaths: [],
    steps,
    context: { constraints: args.constraints }
  }
}

export function registerEvaluatePlan(
  server: McpServer,
  deps: DepsSource
): void {
  server.registerTool(
    "evaluate_plan",
    {
      description:
        "AI が立てた仕様・作業計画を検査し、PROCEED / ASK / STOP の判定を返す。",
      inputSchema: evaluatePlanInput
    },
    (args) => failClosed(args.runId, deps, () => toPlanArtifact(args))
  )
}
