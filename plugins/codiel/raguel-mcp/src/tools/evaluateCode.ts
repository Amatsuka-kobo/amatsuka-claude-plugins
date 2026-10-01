import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js"
import { z } from "zod"
import type { PipelineDeps } from "../core/pipeline.js"
import { commonInput, runEvaluation } from "./shared.js"

/**
 * evaluate_code の入力(設計書 §6.2.2)。差分は Raguel が baseRef と HEAD から自分で作る。
 * 呼び出し側が本文を渡す旧入力は廃止し、未知のキーは入力の誤りにする(所見 F1)
 */
export const evaluateCodeInput = z.strictObject({
  ...commonInput,
  baseRef: z.string().min(1).describe("比べる起点のコミット。終点は常に HEAD"),
  paths: z
    .array(z.string().min(1))
    .min(1)
    .optional()
    .describe("repoPath 相対のパスの列。差分をこの範囲に絞る"),
  testResults: z
    .string()
    .optional()
    .describe(
      "テストの実行結果の要約。信頼しない入力で、秘密情報・注入の検査の対象にする"
    )
})

export function registerEvaluateCode(
  server: McpServer,
  deps: PipelineDeps
): void {
  server.registerTool(
    "evaluate_code",
    {
      description:
        "baseRef から HEAD までの git の差分を Raguel が自分で作って検査し、PROCEED / ASK / STOP の判定を返す。" +
        "作業ツリーに未コミットの変更があれば入力の誤りになる(設定の subject.ignoreUncommitted に当たるパスの変更は数えない)。" +
        "証拠は casePath に残る。",
      inputSchema: evaluateCodeInput
    },
    (args, extra) =>
      runEvaluation({ tool: "evaluate_code", ...args }, deps, extra)
  )
}
