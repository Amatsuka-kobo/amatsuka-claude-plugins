/**
 * Jev(TypeSafe AI)の呼び出しと入力の上限の推定。設計書 §6.4.4。
 * 呼び出しの形は jevriel の `src/jev/client.ts` を参考に独立に書いた(jevriel の src は import しない)。
 * 再試行はしない(§6.8)。SDK の既定の再試行も切る。
 */

import {
  type EntryType,
  type Fetch,
  type Questions,
  type SystemOneResult,
  TypeSafeClient
} from "@typesafe-ai/sdk"

/** 1 回の問い合わせの合計の上限(推定トークン数)。jevriel の `budget.ts` の値を写した */
export const TOTAL_BUDGET = 51_200
/** 1 つの値の上限(推定トークン数) */
export const VALUE_BUDGET = 25_600
/** 1 回の問い合わせに入れる質問の上限 */
export const MAX_QUESTIONS_PER_BATCH = 100

export type QuestionSpec =
  | { type: "noul"; instructions: string }
  | {
      type: "score"
      instructions: string
      criteria: [string, string, ...string[]]
    }

export type Answer =
  | { type: "noul"; noul: number }
  | { type: "score"; score: number }

export interface JevRequest {
  state: Record<string, unknown>
  questions: Record<string, QuestionSpec>
  model?: string
}

export type JevCall = (
  req: JevRequest,
  options: { timeout: number; signal: AbortSignal }
) => Promise<{ answers: Record<string, Answer> }>

/** UTF-8 のバイト数 ÷ 2.5 をトークン数とみなす(jevriel と同じ推定) */
export function estimateTokens(text: string): number {
  return Math.ceil(Buffer.byteLength(text, "utf8") / 2.5)
}

function estimateValue(value: unknown): number {
  return estimateTokens(
    typeof value === "string" ? value : (JSON.stringify(value) ?? "")
  )
}

/**
 * 上限を超えるなら理由を返し、収まるなら null を返す。
 * 「値」は state のトップレベルの値と、各質問の instructions である。
 */
export function checkBudget(req: JevRequest): string | null {
  const values = [
    ...Object.values(req.state),
    ...Object.values(req.questions).map((q) => JSON.stringify(q))
  ].map(estimateValue)
  const longest = Math.max(0, ...values)
  if (longest > VALUE_BUDGET)
    return `1 つの値が推定 ${longest} トークンで上限 ${VALUE_BUDGET} を超えた`
  const total = values.reduce((a, b) => a + b, 0)
  if (total > TOTAL_BUDGET)
    return `合計が推定 ${total} トークンで上限 ${TOTAL_BUDGET} を超えた`
  return null
}

/** `fetch` はテストで差し替えるためのもの */
export function createJevCall(apiKey: string, fetch?: Fetch): JevCall {
  let client: TypeSafeClient | undefined
  return async (req, options) => {
    client ??= new TypeSafeClient({
      apiKey,
      logLevel: "off",
      ...(fetch === undefined ? {} : { fetch })
    })
    const result: SystemOneResult<Questions> = await client.systemOne(
      {
        state: req.state as EntryType,
        questions: req.questions as Questions,
        ...(req.model === undefined ? {} : { model: req.model })
      },
      { ...options, retry: { maxRetries: 0 } }
    )
    return { answers: result.answers as Record<string, Answer> }
  }
}
