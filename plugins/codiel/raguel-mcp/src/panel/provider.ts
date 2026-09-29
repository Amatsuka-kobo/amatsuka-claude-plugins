/**
 * LLM 判定パネルの起動抽象。実装は claudeCli.ts・codexCli.ts と none(judge.provider)。
 * 子プロセスの起動・再試行・一時 cwd・スキーマ不一致の再試行は 2 つの CLI 実装で共有するので、ここに置く。
 */

import { type ChildProcess, spawn } from "node:child_process"
import { mkdtemp, rm } from "node:fs/promises"
import * as os from "node:os"
import * as path from "node:path"
import type { z } from "zod"
import { log } from "../core/log.js"

export interface JudgeCall<T> {
  /** パネリスト名(ログ・ラベル用) */
  role: string
  /** CLI の --model に渡す値。codex で空文字なら指定しない */
  model: string
  /** stdin に流す全文 */
  prompt: string
  /** 応答の zod スキーマ */
  schema: z.ZodType<T>
  /** CLI に渡す JSON Schema($schema を持たないもの) */
  jsonSchema: object
}

/** 呼び出しごとの時間・締切・中止(設計書 §6.8) */
export interface CallControl {
  /** 1 回の起動の時間の上限(judge.timeoutMs)。締切までの残りでさらに縮む */
  timeoutMs: number
  /** ゲート全体の締切の時刻(Date.now() と同じ単位のミリ秒) */
  deadline: number
  signal: AbortSignal
}

/** 1 回の起動に残す締切までの余白 */
export const DEADLINE_MARGIN_MS = 3000

/** 締切までの残りがこれ未満なら再試行しない */
export const RETRY_MIN_REMAINING_MS = 30000

export type ProviderName = "claude" | "codex" | "none"

export interface JudgeProvider {
  readonly name: ProviderName
  /** 失敗は JudgeError を throw する。signal の abort では signal.reason を throw する */
  invoke<T>(call: JudgeCall<T>, ctl: CallControl): Promise<T>
}

export type JudgeErrorReason =
  | "timeout"
  | "deadline"
  | "spawn-failure"
  | "bad-json"
  | "schema-mismatch"
  | "nonzero-exit"
  | "unavailable"

export class JudgeError extends Error {
  readonly reason: JudgeErrorReason

  constructor(reason: JudgeErrorReason, message?: string) {
    super(message ?? reason)
    this.name = "JudgeError"
    this.reason = reason
  }
}

/**
 * judge.provider: "none" 用の実装。常に unavailable を返す
 * (判定不能を PROCEED に化けさせない。設計書 §6.7.1)
 */
export class NoneProvider implements JudgeProvider {
  readonly name = "none"

  invoke<T>(_call: JudgeCall<T>, _ctl: CallControl): Promise<T> {
    return Promise.reject(
      new JudgeError(
        "unavailable",
        "judge.provider が none のため LLM 判定は実行できません"
      )
    )
  }
}

/**
 * 1 回の起動に使える時間。min(timeoutMs, 締切までの残り − 3000)(設計書 §6.8)。
 * byDeadline は締切で縮んだことを表し、その時間切れは timeout でなく deadline にする
 */
export function launchBudget(
  ctl: CallControl,
  now: number = Date.now()
): { ms: number; byDeadline: boolean } {
  const remaining = ctl.deadline - now - DEADLINE_MARGIN_MS
  return remaining < ctl.timeoutMs
    ? { ms: remaining, byDeadline: true }
    : { ms: ctl.timeoutMs, byDeadline: false }
}

/** 同時起動数を max に制限する */
export class Semaphore {
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

export interface ChildRun {
  bin: string
  args: string[]
  cwd: string
  stdin: string
  timeoutMs: number
  role: string
  signal?: AbortSignal
  /** 時間が締切で縮んでいれば、時間切れを deadline として返す */
  byDeadline?: boolean
}

/** runChildWithRetry の入力。時間は ctl から起動ごとに決める */
export type ChildLaunch = Omit<
  ChildRun,
  "timeoutMs" | "signal" | "byDeadline"
> & {
  ctl: CallControl
}

/** 再試行するのは基盤の一時的な失敗だけ。unavailable・deadline と中止は再試行しない */
const RETRYABLE: ReadonlySet<JudgeErrorReason> = new Set([
  "timeout",
  "nonzero-exit",
  "spawn-failure"
])

/**
 * 子プロセスを起動し、タイムアウト・nonzero-exit・spawn の失敗なら 1 回だけ起動し直す。
 * 締切までの残りが RETRY_MIN_REMAINING_MS 未満なら再試行しない(設計書 §6.8)。
 */
export async function runChildWithRetry(run: ChildLaunch): Promise<string> {
  try {
    return await launchChild(run)
  } catch (err) {
    if (
      !(err instanceof JudgeError) ||
      !RETRYABLE.has(err.reason) ||
      run.ctl.signal.aborted
    ) {
      throw err
    }
    const remaining = run.ctl.deadline - Date.now()
    if (remaining < RETRY_MIN_REMAINING_MS) {
      log.warn("panelist process failed, no time left to retry", {
        role: run.role,
        reason: err.reason,
        remainingMs: remaining
      })
      throw err
    }
    log.warn("panelist process failed, retrying once", {
      role: run.role,
      reason: err.reason
    })
    return launchChild(run)
  }
}

function launchChild(run: ChildLaunch): Promise<string> {
  const { ctl, ...rest } = run
  const budget = launchBudget(ctl)
  if (budget.ms <= 0) {
    return Promise.reject(
      new JudgeError(
        "deadline",
        `締切までの残りが無いので起動しません(role: ${run.role})`
      )
    )
  }
  return runChild({
    ...rest,
    timeoutMs: budget.ms,
    signal: ctl.signal,
    byDeadline: budget.byDeadline
  })
}

/** 子プロセスを 1 回起動して stdout を返す */
export function runChild(run: ChildRun): Promise<string> {
  return new Promise((resolve, reject) => {
    if (run.signal?.aborted) {
      reject(run.signal.reason)
      return
    }
    let child: ChildProcess
    try {
      child = spawn(run.bin, run.args, {
        cwd: run.cwd,
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
    }, run.timeoutMs)
    const onAbort = () => child.kill("SIGKILL")
    run.signal?.addEventListener("abort", onAbort, { once: true })

    const finish = (fn: () => void) => {
      if (settled) return
      settled = true
      clearTimeout(timer)
      run.signal?.removeEventListener("abort", onAbort)
      fn()
    }

    child.stdout?.on("data", (chunk: Buffer) => {
      stdout += chunk.toString("utf8")
    })
    child.stderr?.on("data", (chunk: Buffer) => {
      stderr += chunk.toString("utf8")
    })
    // spawn 失敗直後の EPIPE で落ちないよう握りつぶす(error イベントで処理する)
    child.stdin?.on("error", () => {})

    child.on("error", (err: NodeJS.ErrnoException) => {
      finish(() =>
        reject(
          err.code === "ENOENT"
            ? new JudgeError(
                "unavailable",
                `${run.bin} が見つかりません: ${err.message}`
              )
            : new JudgeError("spawn-failure", err.message)
        )
      )
    })

    child.on("close", (code) => {
      finish(() => {
        if (run.signal?.aborted) {
          reject(run.signal.reason)
        } else if (timedOut) {
          reject(
            run.byDeadline
              ? new JudgeError(
                  "deadline",
                  `締切で打ち切りました(${run.timeoutMs}ms、role: ${run.role})`
                )
              : new JudgeError(
                  "timeout",
                  `${run.timeoutMs}ms でタイムアウトしました(role: ${run.role})`
                )
          )
        } else if (code !== 0) {
          reject(new JudgeError("nonzero-exit", stderr.slice(0, 500)))
        } else {
          resolve(stdout)
        }
      })
    })

    child.stdin?.write(run.stdin)
    child.stdin?.end()
  })
}

/** 呼び出しごとに空の一時ディレクトリを作り、終わったら消す */
export async function withTempDir<R>(
  fn: (dir: string) => Promise<R>
): Promise<R> {
  const dir = await mkdtemp(path.join(os.tmpdir(), "raguel-panelist-"))
  try {
    return await fn(dir)
  } finally {
    await rm(dir, { recursive: true, force: true })
  }
}

export type ExtractResult<T> =
  | { ok: true; value: T }
  | { ok: false; detail: string }

/**
 * 1 回目の応答がスキーマに合わなければ、エラーの概要を足したプロンプトで 1 回だけ問い直す。
 * attempt は子プロセスの起動から応答の検証までを行う。
 */
export async function invokeWithSchemaRetry<T>(
  call: JudgeCall<T>,
  attempt: (prompt: string) => Promise<ExtractResult<T>>
): Promise<T> {
  const first = await attempt(call.prompt)
  if (first.ok) return first.value

  log.warn("panelist response failed schema validation, retrying", {
    role: call.role,
    detail: first.detail
  })

  const second = await attempt(buildRetryPrompt(call.prompt, first.detail))
  if (second.ok) return second.value

  throw new JudgeError(
    "schema-mismatch",
    `2回の試行後もスキーマ検証に失敗しました: ${second.detail}`
  )
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

/** 応答の文字列(コードフェンス付きも可)を JSON として読む */
export function parseJsonText(
  text: string,
  label: string
): ExtractResult<unknown> {
  const trimmed = text.trim()
  const match = trimmed.match(/^```(?:json)?\s*([\s\S]*?)\s*```$/)
  try {
    return { ok: true, value: JSON.parse(match ? match[1] : trimmed) }
  } catch (err) {
    return {
      ok: false,
      detail: `${label} の JSON パースに失敗: ${errorMessage(err)}`
    }
  }
}

/** zod で検証し、失敗なら問い直しに使う概要を返す */
export function validate<T>(
  value: unknown,
  schema: z.ZodType<T>
): ExtractResult<T> {
  const parsed = schema.safeParse(value)
  if (parsed.success) return { ok: true, value: parsed.data }
  const summary = parsed.error.issues
    .map((issue) => `${issue.path.join(".") || "(root)"}: ${issue.message}`)
    .join("; ")
  return { ok: false, detail: `zod 検証エラー: ${summary}` }
}

export function errorMessage(err: unknown): string {
  return err instanceof Error ? err.message : String(err)
}
