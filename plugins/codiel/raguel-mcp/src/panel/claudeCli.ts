/**
 * claude CLI(ヘッドレスモード `claude -p`)をサブプロセス起動して LLM 判定を得るプロバイダー。
 * 利用者の hooks・CLAUDE.md・プラグインを読ませないよう、`--setting-sources project` と
 * 呼び出しごとの空の cwd で起動する。
 */

import type { z } from "zod"
import {
  type CallControl,
  type ExtractResult,
  invokeWithSchemaRetry,
  type JudgeCall,
  type JudgeProvider,
  parseJsonText,
  runChildWithRetry,
  Semaphore,
  validate,
  withTempDir
} from "./provider.js"

export class ClaudeCliProvider implements JudgeProvider {
  readonly name = "claude"
  private readonly bin: string
  private readonly semaphore: Semaphore

  constructor(maxConcurrency = 4) {
    this.bin = process.env.RAGUEL_CLAUDE_BIN ?? "claude"
    this.semaphore = new Semaphore(maxConcurrency)
  }

  async invoke<T>(call: JudgeCall<T>, ctl: CallControl): Promise<T> {
    const release = await this.semaphore.acquire()
    try {
      return await withTempDir((cwd) =>
        invokeWithSchemaRetry(call, async (prompt) => {
          const stdout = await runChildWithRetry({
            bin: this.bin,
            args: buildArgs(call),
            cwd,
            stdin: prompt,
            role: call.role,
            ctl
          })
          return extractStructured(stdout, call.schema)
        })
      )
    } finally {
      release()
    }
  }
}

/**
 * `--bare` と `--setting-sources ""` はログインまで外すので使わない。
 * `--setting-sources project` はログインを保ち、利用者の hooks・CLAUDE.md・プラグインを読まない(実機で確認済み)。
 */
export function buildArgs(call: {
  model: string
  jsonSchema: object
}): string[] {
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
    "--setting-sources",
    "project",
    "--no-session-persistence",
    "--json-schema",
    JSON.stringify(call.jsonSchema)
  ]
}

/** --output-format json の stdout エンベロープを取り出し、zod で検証する */
function extractStructured<T>(
  stdout: string,
  schema: z.ZodType<T>
): ExtractResult<T> {
  const envelope = parseJsonText(stdout, "出力エンベロープ")
  if (!envelope.ok) return envelope
  const record = envelope.value
  if (typeof record !== "object" || record === null) {
    return { ok: false, detail: "エンベロープがオブジェクトではありません" }
  }
  const { structured_output, result } = record as Record<string, unknown>

  if (structured_output !== undefined)
    return validate(structured_output, schema)
  if (typeof result === "string") {
    const parsed = parseJsonText(result, "result フィールド")
    return parsed.ok ? validate(parsed.value, schema) : parsed
  }
  return {
    ok: false,
    detail: "structured_output も result も見つかりませんでした"
  }
}
