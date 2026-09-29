/**
 * codex CLI(`codex exec`)をサブプロセス起動して LLM 判定を得るプロバイダー。
 * 利用者の設定を読まず(--ignore-user-config)、セッションを残さず(--ephemeral)、
 * 読み取り専用のサンドボックスで、呼び出しごとの空の cwd から起動する。
 * シェルのツールを無効にする専用のフラグは codex exec に無いので、ツールは止めていない。
 */

import { readFile, rm, writeFile } from "node:fs/promises"
import * as path from "node:path"
import {
  type CallControl,
  invokeWithSchemaRetry,
  type JudgeCall,
  type JudgeProvider,
  parseJsonText,
  runChildWithRetry,
  Semaphore,
  validate,
  withTempDir
} from "./provider.js"

const SCHEMA_FILE = "schema.json"
const OUTPUT_FILE = "last-message.json"

type JsonSchema = Record<string, unknown>

export class CodexCliProvider implements JudgeProvider {
  readonly name = "codex"
  private readonly bin: string
  private readonly semaphore: Semaphore

  constructor(maxConcurrency = 4) {
    this.bin = process.env.RAGUEL_CODEX_BIN ?? "codex"
    this.semaphore = new Semaphore(maxConcurrency)
  }

  async invoke<T>(call: JudgeCall<T>, ctl?: CallControl): Promise<T> {
    const release = await this.semaphore.acquire()
    try {
      return await withTempDir(async (dir) => {
        const outputPath = path.join(dir, OUTPUT_FILE)
        await writeFile(
          path.join(dir, SCHEMA_FILE),
          JSON.stringify(toStrictSchema(call.jsonSchema as JsonSchema))
        )
        return invokeWithSchemaRetry(call, async (prompt) => {
          // 前の試行の出力を次の試行の応答と取り違えない
          await rm(outputPath, { force: true })
          await runChildWithRetry({
            bin: this.bin,
            args: buildCodexArgs(dir, call.model),
            cwd: dir,
            stdin: prompt,
            timeoutMs: ctl?.timeoutMs ?? call.timeoutMs,
            role: call.role,
            signal: ctl?.signal
          })
          let text: string
          try {
            text = await readFile(outputPath, "utf8")
          } catch {
            return { ok: false, detail: "-o の出力ファイルが書かれていません" }
          }
          const parsed = parseJsonText(text, "最後のメッセージ")
          if (!parsed.ok) return parsed
          return validate(
            stripOptionalNulls(parsed.value, call.jsonSchema as JsonSchema),
            call.schema
          )
        })
      })
    } finally {
      release()
    }
  }
}

/** model が空文字なら -m を付けず、CLI の既定に任せる */
export function buildCodexArgs(dir: string, model: string): string[] {
  return [
    "exec",
    "--ephemeral",
    "--ignore-user-config",
    "--skip-git-repo-check",
    "--sandbox",
    "read-only",
    "--output-schema",
    path.join(dir, SCHEMA_FILE),
    "-o",
    path.join(dir, OUTPUT_FILE),
    ...(model ? ["-m", model] : []),
    "-"
  ]
}

/**
 * 構造化出力の制約に合わせ、すべてのプロパティを required に並べ additionalProperties: false を付ける。
 * 元の任意のプロパティは null も許す型にし、読んだ後で stripOptionalNulls が取り除く。
 */
export function toStrictSchema(schema: JsonSchema): JsonSchema {
  const out: JsonSchema = { ...schema }
  const { items, properties } = schema
  if (isSchema(items)) out.items = toStrictSchema(items)
  for (const key of ["anyOf", "oneOf", "allOf"]) {
    const list = schema[key]
    if (Array.isArray(list)) out[key] = list.map((s) => toStrictSchema(s))
  }
  if (isSchema(properties)) {
    const required = new Set(requiredOf(schema))
    const props: JsonSchema = {}
    for (const [key, value] of Object.entries(properties)) {
      const strict = toStrictSchema(value as JsonSchema)
      props[key] = required.has(key)
        ? strict
        : { anyOf: [strict, { type: "null" }] }
    }
    out.properties = props
    out.required = Object.keys(props)
    out.additionalProperties = false
  }
  return out
}

/** 元のスキーマで任意だったプロパティの null を取り除く */
export function stripOptionalNulls(
  value: unknown,
  schema: JsonSchema
): unknown {
  const { items, properties: props } = schema
  if (Array.isArray(value)) {
    return isSchema(items)
      ? value.map((v) => stripOptionalNulls(v, items))
      : value
  }
  if (typeof value !== "object" || value === null || !isSchema(props)) {
    return value
  }
  const required = new Set(requiredOf(schema))
  const out: Record<string, unknown> = {}
  for (const [key, v] of Object.entries(value)) {
    if (v === null && !required.has(key)) continue
    const sub = props[key]
    out[key] = isSchema(sub) ? stripOptionalNulls(v, sub) : v
  }
  return out
}

function isSchema(value: unknown): value is JsonSchema {
  return typeof value === "object" && value !== null && !Array.isArray(value)
}

function requiredOf(schema: JsonSchema): string[] {
  return Array.isArray(schema.required) ? (schema.required as string[]) : []
}
