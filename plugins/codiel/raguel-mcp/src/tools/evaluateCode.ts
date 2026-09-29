import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js"
import { z } from "zod"
import type { Artifact } from "../core/types.js"
import { parseDiff } from "../rules/code/diffParse.js"
import {
  type DepsSource,
  failClosed,
  InputError,
  objectiveSchema,
  runIdSchema
} from "./shared.js"

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

/**
 * ハンクを持たない正当な変更の印の行(名前の変更・バイナリ・モードの変更・空のファイルの追加と削除)。
 * ハンクもこの印も無い diff は、ファイルの見出しだけの要約なので入力の誤りにする(決定 83 の (5))。
 */
const HUNKLESS_CHANGE_MARKERS = [
  "rename from ",
  "rename to ",
  "similarity index ",
  "Binary files ",
  "old mode ",
  "new mode ",
  "new file mode ",
  "deleted file mode "
]

function hasHunkOrMarker(diff: string): boolean {
  return diff
    .split("\n")
    .some(
      (line) =>
        line.startsWith("@@") ||
        HUNKLESS_CHANGE_MARKERS.some((marker) => line.startsWith(marker))
    )
}

export function toCodeArtifact(args: EvaluateCodeArgs): Artifact {
  if (args.diff !== undefined && args.files !== undefined) {
    throw new InputError(
      "diff と files は同時に渡せないので、git diff の出力を diff だけに渡してください"
    )
  }
  if (!args.diff && (!args.files || args.files.length === 0)) {
    throw new InputError("diff または files のいずれかが必須です")
  }
  if (args.diff && !hasHunkOrMarker(args.diff)) {
    throw new InputError(
      "diff にハンク(@@ で始まる行)も、名前の変更・バイナリ・モードの変更・空のファイルの追加と削除の印の行も無いので、要約ではなく git diff の出力をそのまま渡してください"
    )
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
  deps: DepsSource
): void {
  server.registerTool(
    "evaluate_code",
    {
      description:
        "AI が生成したコード(diff またはファイル群)を検査し、" +
        "PROCEED / ASK / STOP の判定を返す。証拠は casePath に永続化される。",
      inputSchema: evaluateCodeInput
    },
    (args) => failClosed(args.runId, deps, () => toCodeArtifact(args))
  )
}
