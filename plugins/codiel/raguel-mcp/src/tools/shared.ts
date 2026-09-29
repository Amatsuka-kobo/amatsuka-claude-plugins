/**
 * ツール層の共通部。入力の基本スキーマ、設定の読み直しとプロバイダーの作り直し、
 * 評価の実行(進捗の通知・中止・入力の誤りの isError)を持つ(設計書 §6.2・§6.8・§6.12.4)。
 */

import type { RequestHandlerExtra } from "@modelcontextprotocol/sdk/shared/protocol.js"
import type {
  ServerNotification,
  ServerRequest
} from "@modelcontextprotocol/sdk/types.js"
import { z } from "zod"
import { GATED_PHASES, type GatedPhase } from "../codiel/phases.js"
import { configCandidate, createConfigReloader } from "../config/loader.js"
import { log } from "../core/log.js"
import {
  type EvaluationRequest,
  evaluate,
  type PipelineDeps,
  type Providers,
  type Runtime,
  type RuntimeResult
} from "../core/pipeline.js"
import type { RaguelConfig } from "../core/types.js"
import { SubjectInputError } from "../subject/types.js"

/** path traversal を防ぐ。runId はツールの入力なので信頼しない */
export const runIdSchema = z
  .string()
  .regex(/^[A-Za-z0-9._-]{1,64}$/, "runId は英数字と . _ - の 64 文字まで")

export const phaseSchema = z
  .enum(GATED_PHASES.map((e) => e.phase) as [GatedPhase, ...GatedPhase[]])
  .describe(
    "codiel のゲート付きフェーズ。ツールの kind と合わなければ入力の誤り"
  )

export const objectiveSchema = z
  .string()
  .min(1, "objective は必須(この成果物が何のためのものか)")

export const repoPathSchema = z
  .string()
  .min(1)
  .optional()
  .describe(
    "git を実行する作業ツリーの絶対パス。省略時はプロジェクトルート。同じリポジトリの worktree だけを受ける"
  )

/** evaluate_* に共通の入力(§6.2.1) */
export const commonInput = {
  runId: runIdSchema,
  phase: phaseSchema,
  objective: objectiveSchema,
  repoPath: repoPathSchema
}

export type ToolExtra = RequestHandlerExtra<ServerRequest, ServerNotification>

export interface ToolResponse {
  [key: string]: unknown
  content: Array<{ type: "text"; text: string }>
  isError?: boolean
}

export function toResponse(result: unknown): ToolResponse {
  return { content: [{ type: "text", text: JSON.stringify(result, null, 2) }] }
}

/** 入力の誤り(§6.2.6)。判定を返さず、MCP のツールエラーと理由の 1 文で返す。記録しない */
export function inputError(reason: string): ToolResponse {
  return { content: [{ type: "text", text: reason }], isError: true }
}

/**
 * 評価を実行して応答にする。progressToken があれば、ステップごとに notifications/progress を送る。
 * 入力の誤り・中止・記録の書き込みの失敗は isError で返す
 */
export async function runEvaluation(
  req: EvaluationRequest,
  deps: PipelineDeps,
  extra: ToolExtra
): Promise<ToolResponse> {
  const token = extra._meta?.progressToken
  let step = 0
  const progress =
    token === undefined
      ? undefined
      : (message: string) => {
          step++
          extra
            .sendNotification({
              method: "notifications/progress",
              params: { progressToken: token, progress: step, message }
            })
            .catch((err) =>
              log.warn("進捗の通知を送れなかった", {
                error: err instanceof Error ? err.message : String(err)
              })
            )
        }
  try {
    return toResponse(
      await evaluate(req, deps, { signal: extra.signal, progress })
    )
  } catch (err) {
    if (err instanceof SubjectInputError) return inputError(err.message)
    if (extra.signal.aborted) {
      log.info("評価を中止した(attempt と索引は残さない)", {
        runId: req.runId,
        phase: req.phase
      })
      return inputError("評価は中止された")
    }
    const message = err instanceof Error ? err.message : String(err)
    log.error("評価の記録を書けなかった", { message })
    return inputError(`評価の記録を書けなかった: ${message}`)
  }
}

/**
 * 呼ぶたびに設定を読み直す(ファイルの有無と mtime が変わったときだけ)。変わればプロバイダーも作り直す。
 * 読み込みに失敗しても例外にせず、理由と設定のパスを返す(§6.12.4)。次の呼び出しで読み直しを試す
 */
export function createRuntimeSource(
  makeProviders: (config: RaguelConfig) => Providers,
  cwd: string = process.cwd()
): () => RuntimeResult {
  const reload = createConfigReloader(
    (loaded): Runtime => ({ loaded, providers: makeProviders(loaded.config) }),
    cwd
  )
  return () => {
    try {
      return { ok: true, runtime: reload() }
    } catch (err) {
      const { path, source } = configCandidate(cwd)
      const error = err instanceof Error ? err.message : String(err)
      log.error("設定を読み込めない(評価は ASK・degraded で返す)", {
        path,
        error
      })
      return { ok: false, error, path, source }
    }
  }
}
