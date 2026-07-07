import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js"
import { z } from "zod"
import { evaluateArtifact, type PipelineDeps } from "../core/pipeline.js"
import type { Artifact } from "../core/types.js"
import { parseDiff } from "../rules/code/diffParse.js"
import { failClosed, objectiveSchema, runIdSchema } from "./shared.js"

const fileSchema = z.object({
  path: z.string().min(1),
  content: z.string()
})

export const evaluateCodeInput = {
  runId: runIdSchema,
  objective: objectiveSchema,
  diff: z.string().optional().describe("unified diff 全文"),
  files: z
    .array(fileSchema)
    .optional()
    .describe("diff がない場合の変更ファイル一覧"),
  testResults: z.string().optional().describe("テスト実行結果の要約")
}

type EvaluateCodeArgs = {
  runId: string
  objective: string
  diff?: string
  files?: Array<{ path: string; content: string }>
  testResults?: string
}

export function toCodeArtifact(args: EvaluateCodeArgs): Artifact {
  if (!args.diff && (!args.files || args.files.length === 0)) {
    throw new Error("diff または files のいずれかが必須です")
  }
  const content =
    args.diff ??
    (args.files ?? [])
      .map((f) => `--- ${f.path} ---\n${f.content}`)
      .join("\n\n")
  const changedPaths = args.diff
    ? parseDiff(args.diff).files.map((f) => f.path)
    : (args.files ?? []).map((f) => f.path)
  return {
    kind: "code",
    runId: args.runId,
    objective: args.objective,
    content,
    changedPaths,
    steps: [],
    context: { testResults: args.testResults }
  }
}

export function registerEvaluateCode(
  server: McpServer,
  deps: PipelineDeps
): void {
  server.registerTool(
    "evaluate_code",
    {
      description:
        "AI が生成したコード(diff またはファイル群)を検査し、" +
        "PROCEED / ASK / STOP の判定を返す。証拠は casePath に永続化される。",
      inputSchema: evaluateCodeInput
    },
    (args) =>
      failClosed(args.runId, deps, () =>
        evaluateArtifact(toCodeArtifact(args), deps)
      )
  )
}
