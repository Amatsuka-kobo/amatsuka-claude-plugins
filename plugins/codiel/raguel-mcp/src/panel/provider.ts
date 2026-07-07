/**
 * LLM 判定パネルの起動抽象。実装は claudeCli.ts(本命)と none(§11 judge.provider)。
 * docs/DESIGN.md §7 が原典。
 */

import type { z } from "zod"

export interface JudgeCall<T> {
  /** パネリスト名(ログ・ラベル用) */
  role: string
  /** claude CLI --model 値 */
  model: string
  /** stdin に流す全文 */
  prompt: string
  /** 応答の zod スキーマ */
  schema: z.ZodType<T>
  /** claude CLI --json-schema に渡す JSON Schema */
  jsonSchema: object
  timeoutMs: number
}

export interface JudgeProvider {
  /** 失敗は JudgeError を throw する */
  invoke<T>(call: JudgeCall<T>): Promise<T>
}

export type JudgeErrorReason =
  | "timeout"
  | "spawn-failure"
  | "bad-json"
  | "schema-mismatch"
  | "nonzero-exit"
  | "provider-none"

export class JudgeError extends Error {
  readonly reason: JudgeErrorReason

  constructor(reason: JudgeErrorReason, message?: string) {
    super(message ?? reason)
    this.name = "JudgeError"
    this.reason = reason
  }
}

/**
 * judge.provider: "none" 用の実装。常にフェイルクローズドでエラーを返す
 * (§11 onError: PROCEED は指定不可、と同じ思想。判定不能を PROCEED に化けさせない)
 */
export class NoneProvider implements JudgeProvider {
  invoke<T>(_call: JudgeCall<T>): Promise<T> {
    return Promise.reject(
      new JudgeError(
        "provider-none",
        "judge.provider が none のため LLM 判定は実行できません"
      )
    )
  }
}
