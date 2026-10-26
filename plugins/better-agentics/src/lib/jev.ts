import {
  type EntryType,
  type Questions,
  type SystemOneResult,
  TypeSafeClient
} from "@typesafe-ai/sdk"

export interface JevRequest {
  state: EntryType
  questions: Questions
}

export type JevAsk = (
  request: JevRequest
) => Promise<SystemOneResult<Questions>>

// SDK の timeout は試行ごとの値で、リトライを含めた上限にならない。
// 全体の上限は AbortSignal で 30 秒に切る。
export function createJevAsk(apiKey: string): JevAsk {
  const client = new TypeSafeClient({ apiKey, logLevel: "off" })
  return (request) =>
    client.systemOne(request, {
      signal: AbortSignal.timeout(30_000),
      retry: { maxRetries: 1, maxRetryAfterMs: 5_000 }
    })
}
