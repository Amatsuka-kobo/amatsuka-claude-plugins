/**
 * テスト用インメモリ JudgeProvider。role ごとに canned 応答(または投げるエラー)を
 * 事前登録し、呼び出しを記録する。実プロセスは一切起動しない。
 */

import type { JudgeCall, JudgeProvider } from "../provider.js"
import { JudgeError } from "../provider.js"

export interface RecordedCall {
  role: string
  model: string
  prompt: string
}

export type CannedResponse = unknown | Error | (() => unknown)

export class FakeJudgeProvider implements JudgeProvider {
  readonly calls: RecordedCall[] = []
  private readonly responses = new Map<string, CannedResponse>()

  /** role に対する応答を登録する。Error を渡すとその role の呼び出しは失敗する */
  set(role: string, response: CannedResponse): void {
    this.responses.set(role, response)
  }

  async invoke<T>(call: JudgeCall<T>): Promise<T> {
    this.calls.push({ role: call.role, model: call.model, prompt: call.prompt })

    const entry = this.responses.get(call.role)
    if (entry === undefined) {
      throw new JudgeError(
        "provider-none",
        `FakeJudgeProvider: role "${call.role}" の canned 応答が未登録です`
      )
    }
    const resolved =
      typeof entry === "function" ? (entry as () => unknown)() : entry
    if (resolved instanceof Error) throw resolved

    return call.schema.parse(resolved)
  }
}
