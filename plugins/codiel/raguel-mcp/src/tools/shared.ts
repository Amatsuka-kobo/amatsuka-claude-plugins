/**
 * ツール層の共通部。入力の基本スキーマ、呼び出しのたびに設定を読み直す依存の解決、
 * 入力の誤り(MCP のツールエラー)、ハンドラ最外周のフェイルクローズドラッパー
 * (内部例外を MCP エラーではなく verdict: onError の正常応答として返す)を提供する。
 */

import { z } from "zod"
import { defaultConfig } from "../config/defaults.js"
import { configCandidate } from "../config/loader.js"
import { log } from "../core/log.js"
import { evaluateArtifact, type PipelineDeps } from "../core/pipeline.js"
import type { Artifact, EvaluationResult, Finding } from "../core/types.js"

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
  isError?: boolean
}

export function toResponse(result: unknown): ToolResponse {
  return { content: [{ type: "text", text: JSON.stringify(result, null, 2) }] }
}

/**
 * ツールが受け取る依存。関数なら呼び出しのたびに呼ぶ。server.ts は設定の読み直し
 * (config/loader.ts の createConfigReloader)を渡し、テストは固定の依存を渡す。
 */
export type DepsSource = PipelineDeps | (() => PipelineDeps)

/** 依存を解決する。関数の依存が設定を読めなければ例外を投げる */
export function resolveDeps(source: DepsSource): PipelineDeps {
  return typeof source === "function" ? source() : source
}

/** 判定ではなく入力の誤り。toCodeArtifact などが投げ、failClosed が inputError で返す */
export class InputError extends Error {}

/**
 * 入力の誤りの応答(決定 83 の (5))。判定を返さず、MCP のツールエラーと理由の 1 文で返す。
 * ケースファイルと評価の索引には書かない。
 */
export function inputError(reason: string): ToolResponse {
  return { content: [{ type: "text", text: reason }], isError: true }
}

function fallback(
  runId: string,
  verdict: EvaluationResult["verdict"],
  finding: Omit<Finding, "severity">,
  policy: EvaluationResult["policy"]
): ToolResponse {
  const result: EvaluationResult = {
    evaluationId: "internal-error",
    runId,
    verdict,
    weightTier: "standard",
    findings: [{ ...finding, severity: verdict === "STOP" ? "stop" : "ask" }],
    casePath: "",
    policy
  }
  return toResponse(result)
}

/**
 * evaluate 系ハンドラのフェイルクローズドラッパー。build で検査対象を作り、判定を返す。
 * - 設定を読めないときは、前の設定に戻さず、既定の onError(ASK)の判定で返す。所見に設定のパスと理由を載せる。
 * - build が InputError を投げたら、判定ではなく入力の誤り(isError)を返す。
 * - それ以外の内部例外は onError(既定 ASK、PROCEED は存在しない)の判定として返し、
 *   呼び出し側 AI が「エラーだから無視して続行」する余地を残さない。
 */
export async function failClosed(
  runId: string,
  source: DepsSource,
  build: () => Artifact
): Promise<ToolResponse> {
  let deps: PipelineDeps
  try {
    deps = resolveDeps(source)
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    const candidate = configCandidate()
    log.error("設定を読み込めません(フェイルクローズド)", {
      configSource: candidate.source,
      message
    })
    const verdict = defaultConfig.onError
    return fallback(
      runId,
      verdict,
      {
        ruleId: "kernel/config-error",
        message: `設定(${candidate.path})を読み込めないため ${verdict} に倒します: ${message}`,
        evidence: { location: candidate.path }
      },
      { configHash: "", version: 1, configSource: candidate.source }
    )
  }

  try {
    return toResponse(await evaluateArtifact(build(), deps))
  } catch (err) {
    if (err instanceof InputError) return inputError(err.message)
    const message = err instanceof Error ? err.message : String(err)
    log.error("evaluate 内部エラー(フェイルクローズド)", { message })
    const verdict = deps.config.onError
    return fallback(
      runId,
      verdict,
      {
        ruleId: "kernel/internal-error",
        message: `判定パイプラインの内部エラーにより ${verdict} に倒します: ${message}`
      },
      {
        configHash: deps.configHash,
        version: 1,
        configSource: deps.configSource
      }
    )
  }
}
