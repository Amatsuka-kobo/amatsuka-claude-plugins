// `append-gotcha` / `tag-gotcha`(契約 §6・§11、設計書 §7-4)。
//
// どちらも承認を要さない追記操作である(設計書 §7-6)。拒否は非 0 終了で返し、
// そのとき対象ファイルには 1 バイトも書き込まない。

import { loadConfig } from "../lib/config.js"
import {
  appendGotcha,
  GOTCHA_TAGS,
  GotchaError,
  type GotchaInput,
  tagGotcha
} from "../lib/gotchas.js"
import { stringFlag } from "./args.js"
import { isPlainObject, loadInputJson } from "./input.js"
import {
  EXIT_USAGE,
  emitResult,
  emitWriteFailure,
  messageOf,
  noteWarnings
} from "./output.js"

export interface GotchaContext {
  flags: Record<string, string | true>
  cwd: string
}

function failFromError(
  command: string,
  error: unknown,
  extra: Record<string, unknown>
): void {
  if (error instanceof GotchaError) {
    emitWriteFailure(command, error.code, error.message, {
      ...extra,
      details: error.details
    })
    return
  }
  emitWriteFailure(command, "internal_error", messageOf(error), extra)
}

// ---------------------------------------------------------------------------
// append-gotcha
// ---------------------------------------------------------------------------

export function runAppendGotcha(ctx: GotchaContext): void {
  const command = "append-gotcha"

  const input = loadInputJson(ctx.flags)
  if (!input.ok) {
    emitWriteFailure(
      command,
      input.error,
      input.message,
      { written: false },
      EXIT_USAGE
    )
    return
  }
  if (!isPlainObject(input.value)) {
    emitWriteFailure(
      command,
      "invalid_input",
      `${input.source} のトップレベルは { title, task, mistake, cause, countermeasure, promotionCandidate } のオブジェクトである必要があります。`,
      { written: false },
      EXIT_USAGE
    )
    return
  }

  const config = loadConfig(ctx.cwd)
  try {
    // 値の検証は gotchas.ts が行う(CLI は形の主張だけを渡し、判断を持たない)。
    const result = appendGotcha(
      config.gotchasPath,
      input.value as unknown as GotchaInput
    )
    const warnings = [...config.warnings, ...result.warnings]
    noteWarnings(warnings)
    emitResult(command, {
      ok: true,
      written: true,
      id: result.id,
      number: result.number,
      path: result.path,
      date: result.date,
      created: result.created,
      sectionCreated: result.sectionCreated,
      warnings
    })
  } catch (error) {
    failFromError(command, error, {
      written: false,
      path: config.gotchasPath
    })
  }
}

// ---------------------------------------------------------------------------
// tag-gotcha
// ---------------------------------------------------------------------------

export function runTagGotcha(ctx: GotchaContext): void {
  const command = "tag-gotcha"

  const id = stringFlag(ctx.flags, "id")
  const tag = stringFlag(ctx.flags, "tag")
  const reason = stringFlag(ctx.flags, "reason")
  const date = stringFlag(ctx.flags, "date")

  const missing: string[] = []
  if (id === undefined) missing.push("--id <GOTCHA-NNN>")
  if (tag === undefined) missing.push(`--tag <${GOTCHA_TAGS.join("|")}>`)
  if (reason === undefined) missing.push("--reason <理由>")
  if (missing.length > 0) {
    emitWriteFailure(
      command,
      "missing_option",
      `${missing.join(" / ")} が必要です。`,
      { written: false },
      EXIT_USAGE
    )
    return
  }

  const config = loadConfig(ctx.cwd)
  try {
    const result = tagGotcha(config.gotchasPath, {
      id: id as string,
      tag: tag as string,
      reason: reason as string,
      date
    })
    const warnings = [...config.warnings, ...result.warnings]
    noteWarnings(warnings)
    emitResult(command, {
      ok: true,
      written: true,
      id: result.id,
      path: result.path,
      tag: result.tag,
      previousTag: result.previousTag,
      date: result.date,
      warnings
    })
  } catch (error) {
    failFromError(command, error, {
      written: false,
      path: config.gotchasPath
    })
  }
}
