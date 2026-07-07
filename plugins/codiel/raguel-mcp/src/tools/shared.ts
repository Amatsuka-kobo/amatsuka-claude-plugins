/**
 * ツール層の共通部。入力の基本スキーマと、ハンドラ最外周の
 * フェイルクローズドラッパー(例外を MCP エラーではなく
 * verdict: onError の正常応答として返す)を提供する。
 */

import { z } from "zod"
import { log } from "../core/log.js"
import type { PipelineDeps } from "../core/pipeline.js"
import type { EvaluationResult } from "../core/types.js"

/** path traversal 防止(§4 リスク)。runId はツール入力 = 信頼しない */
export const runIdSchema = z
  .string()
  .regex(/^[A-Za-z0-9._-]{1,64}$/, "runId は英数字と . _ - のみ 64 文字まで")

export const objectiveSchema = z
  .string()
  .min(1, "objective は必須です(この成果物が何のためのものか)")

export interface ToolResponse {
  [key: string]: unknown
  content: Array<{ type: "text"; text: string }>
}

export function toResponse(result: unknown): ToolResponse {
  return { content: [{ type: "text", text: JSON.stringify(result, null, 2) }] }
}

/**
 * evaluate 系ハンドラのフェイルクローズドラッパー。
 * 内部例外は onError(既定 ASK、PROCEED は存在しない)の判定として返し、
 * 呼び出し側 AI が「エラーだから無視して続行」する余地を残さない。
 */
export async function failClosed(
  runId: string,
  deps: PipelineDeps,
  run: () => Promise<EvaluationResult>
): Promise<ToolResponse> {
  try {
    return toResponse(await run())
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    log.error("evaluate 内部エラー(フェイルクローズド)", { message })
    const verdict = deps.config.onError
    const fallback: EvaluationResult = {
      evaluationId: "internal-error",
      runId,
      verdict,
      weightTier: "standard",
      findings: [
        {
          ruleId: "kernel/internal-error",
          severity: verdict === "STOP" ? "stop" : "ask",
          message: `判定パイプラインの内部エラーにより ${verdict} に倒します: ${message}`
        }
      ],
      casePath: "",
      policy: { configHash: deps.configHash, version: 1 }
    }
    return toResponse(fallback)
  }
}
