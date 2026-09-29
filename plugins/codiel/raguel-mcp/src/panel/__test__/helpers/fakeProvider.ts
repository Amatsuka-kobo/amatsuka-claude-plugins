/**
 * テスト用のメモリ内の JudgeProvider。role ごとに決まった応答(または投げるエラー)を登録し、
 * 呼び出しと CallControl を記録する。子プロセスは起動しない。
 */

import type {
  CallControl,
  JudgeCall,
  JudgeProvider,
  ProviderName
} from "../../provider.js"
import { JudgeError } from "../../provider.js"

export interface RecordedCall {
  role: string
  model: string
  prompt: string
  ctl: CallControl
}

export type CannedResponse = unknown | Error | (() => unknown)

export class FakeJudgeProvider implements JudgeProvider {
  readonly calls: RecordedCall[] = []
  private readonly responses = new Map<string, CannedResponse>()

  constructor(readonly name: ProviderName = "claude") {}

  /** role に対する応答を登録する。Error を渡すとその role の呼び出しは失敗する */
  set(role: string, response: CannedResponse): void {
    this.responses.set(role, response)
  }

  async invoke<T>(call: JudgeCall<T>, ctl: CallControl): Promise<T> {
    this.calls.push({
      role: call.role,
      model: call.model,
      prompt: call.prompt,
      ctl
    })

    const entry = this.responses.get(call.role)
    if (entry === undefined) {
      throw new JudgeError(
        "unavailable",
        `FakeJudgeProvider: role "${call.role}" の応答が登録されていない`
      )
    }
    const resolved =
      typeof entry === "function" ? (entry as () => unknown)() : entry
    if (resolved instanceof Error) throw resolved

    return call.schema.parse(resolved)
  }
}

/** 締切まで十分な時間のある CallControl */
export function makeCtl(overrides: Partial<CallControl> = {}): CallControl {
  return {
    timeoutMs: 5000,
    deadline: Date.now() + 600000,
    signal: new AbortController().signal,
    ...overrides
  }
}
