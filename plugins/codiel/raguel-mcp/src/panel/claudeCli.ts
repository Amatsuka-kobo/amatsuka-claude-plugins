/**
 * claude CLI(ヘッドレスモード `claude -p`)をサブプロセス起動して LLM 判定を得る本命プロバイダ。
 * docs/DESIGN.md §7 が原典。この環境の claude CLI で確認済みのフラグのみを使う。
 */

import { type ChildProcess, spawn } from "node:child_process"
import * as os from "node:os"
import type { z } from "zod"
import { log } from "../core/log.js"
import { type JudgeCall, JudgeError, type JudgeProvider } from "./provider.js"

/** モジュール内セマフォ。同時起動数を maxConcurrency に制限する */
class Semaphore {
  private active = 0
  private readonly queue: Array<() => void> = []

  constructor(private readonly max: number) {}

  async acquire(): Promise<() => void> {
    if (this.active < this.max) {
      this.active++
      return () => this.release()
    }
    return new Promise((resolve) => {
      this.queue.push(() => {
        this.active++
        resolve(() => this.release())
      })
    })
  }

  private release(): void {
    this.active--
    const next = this.queue.shift()
    if (next) next()
  }
}

type ExtractResult<T> = { ok: true; value: T } | { ok: false; detail: string }

export class ClaudeCliProvider implements JudgeProvider {
  private readonly bin: string
  private readonly semaphore: Semaphore

  constructor(maxConcurrency = 4) {
    this.bin = process.env.RAGUEL_CLAUDE_BIN ?? "claude"
    this.semaphore = new Semaphore(maxConcurrency)
  }

  async invoke<T>(call: JudgeCall<T>): Promise<T> {
    const release = await this.semaphore.acquire()
    try {
      const stdout1 = await this.runProcess(call, call.prompt)
      const parsed1 = extractStructured(stdout1, call.schema)
      if (parsed1.ok) return parsed1.value

      log.warn("panelist response failed schema validation, retrying", {
        role: call.role,
        detail: parsed1.detail
      })

      const retryPrompt = buildRetryPrompt(call.prompt, parsed1.detail)
      const stdout2 = await this.runProcess(call, retryPrompt)
      const parsed2 = extractStructured(stdout2, call.schema)
      if (parsed2.ok) return parsed2.value

      throw new JudgeError(
        "schema-mismatch",
        `2回の試行後もスキーマ検証に失敗しました: ${parsed2.detail}`
      )
    } finally {
      release()
    }
  }

  /** claude CLI を 1 回起動して stdout エンベロープ文字列を返す */
  private runProcess<T>(call: JudgeCall<T>, prompt: string): Promise<string> {
    return new Promise((resolve, reject) => {
      const args = buildArgs(call)
      let child: ChildProcess
      try {
        child = spawn(this.bin, args, {
          cwd: os.tmpdir(),
          env: { ...process.env, RAGUEL_PANELIST: "1" }
        })
      } catch (err) {
        reject(new JudgeError("spawn-failure", errorMessage(err)))
        return
      }

      let stdout = ""
      let stderr = ""
      let timedOut = false
      let settled = false

      const timer = setTimeout(() => {
        timedOut = true
        child.kill("SIGKILL")
      }, call.timeoutMs)

      child.stdout?.on("data", (chunk: Buffer) => {
        stdout += chunk.toString("utf8")
      })
      child.stderr?.on("data", (chunk: Buffer) => {
        stderr += chunk.toString("utf8")
      })
      // spawn 失敗直後の EPIPE で落ちないよう握りつぶす(error イベント側で処理する)
      child.stdin?.on("error", () => {})

      child.on("error", (err) => {
        if (settled) return
        settled = true
        clearTimeout(timer)
        reject(new JudgeError("spawn-failure", errorMessage(err)))
      })

      child.on("close", (code) => {
        if (settled) return
        settled = true
        clearTimeout(timer)
        if (timedOut) {
          reject(
            new JudgeError(
              "timeout",
              `${call.timeoutMs}ms でタイムアウトしました(role: ${call.role})`
            )
          )
          return
        }
        if (code !== 0) {
          reject(new JudgeError("nonzero-exit", stderr.slice(0, 500)))
          return
        }
        resolve(stdout)
      })

      child.stdin?.write(prompt)
      child.stdin?.end()
    })
  }
}

function buildArgs(call: { model: string; jsonSchema: object }): string[] {
  // NOTE: --bare と --setting-sources "" はユーザーのログイン情報(user 設定
  // ソース)まで外してしまい "Not logged in" になるため使わない(実機で確認済み)。
  // MCP の遮断は --strict-mcp-config + 空 --mcp-config、ツールの武装解除は
  // --tools ""、スキル無効化は --disable-slash-commands で行う。
  return [
    "-p",
    "--output-format",
    "json",
    "--model",
    call.model,
    "--tools",
    "",
    "--disable-slash-commands",
    "--strict-mcp-config",
    "--mcp-config",
    '{"mcpServers":{}}',
    "--json-schema",
    JSON.stringify(call.jsonSchema)
  ]
}

function buildRetryPrompt(originalPrompt: string, detail: string): string {
  return [
    originalPrompt,
    "",
    "---",
    "前回の応答は期待する JSON スキーマに適合しませんでした。以下のエラー概要を踏まえ、",
    "スキーマに厳密に従う JSON のみを再度出力してください(説明文・コードフェンスは不要)。",
    `エラー概要: ${detail}`
  ].join("\n")
}

/** --output-format json の stdout エンベロープを取り出し、zod で検証する */
function extractStructured<T>(
  stdout: string,
  schema: z.ZodType<T>
): ExtractResult<T> {
  let envelope: unknown
  try {
    envelope = JSON.parse(stdout)
  } catch (err) {
    return {
      ok: false,
      detail: `出力エンベロープの JSON パースに失敗: ${errorMessage(err)}`
    }
  }

  const candidate = extractCandidate(envelope)
  if (!candidate.ok) return candidate

  const parsed = schema.safeParse(candidate.value)
  if (!parsed.success) {
    const summary = parsed.error.issues
      .map((issue) => `${issue.path.join(".") || "(root)"}: ${issue.message}`)
      .join("; ")
    return { ok: false, detail: `zod 検証エラー: ${summary}` }
  }
  return { ok: true, value: parsed.data }
}

function extractCandidate(
  envelope: unknown
): { ok: true; value: unknown } | { ok: false; detail: string } {
  if (typeof envelope !== "object" || envelope === null) {
    return { ok: false, detail: "エンベロープがオブジェクトではありません" }
  }
  const record = envelope as Record<string, unknown>

  if (record.structured_output !== undefined) {
    return { ok: true, value: record.structured_output }
  }

  if (typeof record.result === "string") {
    const stripped = stripCodeFence(record.result)
    try {
      return { ok: true, value: JSON.parse(stripped) }
    } catch (err) {
      return {
        ok: false,
        detail: `result フィールドの JSON パースに失敗: ${errorMessage(err)}`
      }
    }
  }

  return {
    ok: false,
    detail: "structured_output も result も見つかりませんでした"
  }
}

function stripCodeFence(text: string): string {
  const trimmed = text.trim()
  const match = trimmed.match(/^```(?:json)?\s*([\s\S]*?)\s*```$/)
  return match ? match[1] : trimmed
}

function errorMessage(err: unknown): string {
  return err instanceof Error ? err.message : String(err)
}
