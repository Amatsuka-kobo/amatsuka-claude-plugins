// `stage-architecture` / `stage-adr`(設計書 §7-3・§7-4)。
//
// どちらも**書き込みを行わない**。diff と stagingId を返すだけで、確定は
// `commit-architecture --staging-id <id>` が行う。契約 §4-3 の分類では
// 書き込み経路(第 1 層・フェイルクローズド)であり、拒否は非 0 終了で返す。

import { AdrError, type AdrInput, stageAdr } from "../lib/adr.js"
import {
  ADR_HEADING,
  findSection,
  parseArchitectureForRead,
  prepareArchitectureUpdate,
  type SectionChange
} from "../lib/architecture.js"
import { loadConfig } from "../lib/config.js"
import { createStaging, hashContent } from "../lib/staging.js"
import { unifiedDiff } from "./diff.js"
import { isPlainObject, loadInputJson, readDocument } from "./input.js"
import {
  EXIT_USAGE,
  emitResult,
  emitWriteFailure,
  messageOf,
  noteWarnings
} from "./output.js"
import { commandLine } from "./paths.js"

export interface StageContext {
  flags: Record<string, string | true>
  cwd: string
}

interface SectionDiff {
  heading: string
  mode: string
  before: string | null
  after: string | null
}

function sectionDiffs(
  beforeText: string,
  afterText: string,
  headings: readonly { heading: string; mode: string }[]
): SectionDiff[] {
  const before = parseArchitectureForRead(beforeText)
  const after = parseArchitectureForRead(afterText)
  return headings.map((entry) => ({
    heading: entry.heading,
    mode: entry.mode,
    before: findSection(before, entry.heading)?.body ?? null,
    after: findSection(after, entry.heading)?.body ?? null
  }))
}

// ---------------------------------------------------------------------------
// stage-architecture
// ---------------------------------------------------------------------------

export function runStageArchitecture(ctx: StageContext): void {
  const command = "stage-architecture"

  const input = loadInputJson(ctx.flags)
  if (!input.ok) {
    emitWriteFailure(
      command,
      input.error,
      input.message,
      { valid: false },
      EXIT_USAGE
    )
    return
  }
  if (!isPlainObject(input.value)) {
    emitWriteFailure(
      command,
      "invalid_input",
      `${input.source} のトップレベルは { sections: [{ heading, body }] } のオブジェクトである必要があります。`,
      { valid: false },
      EXIT_USAGE
    )
    return
  }

  const config = loadConfig(ctx.cwd)
  const file = readDocument(config.architecturePath)
  const rawSections = (input.value as { sections?: unknown }).sections
  const reason = (input.value as { reason?: unknown }).reason
  const changes = rawSections as SectionChange[]

  const update = prepareArchitectureUpdate(file.text, changes)
  const warnings = [...config.warnings, ...file.warnings, ...update.warnings]
  noteWarnings(warnings)

  if (!update.ok) {
    // 契約 §4-3・設計書 §7-4: 検証に失敗したら stagingId を発行しない。
    emitWriteFailure(command, update.error, update.message, {
      valid: false,
      stagingId: null,
      path: config.architecturePath,
      warnings
    })
    return
  }

  const staged = createStaging({
    projectRoot: config.docRoot,
    kind: "architecture",
    targetPath: config.architecturePath,
    nextContent: update.text,
    baseHash: file.hash,
    meta: {
      applied: update.applied,
      reason: typeof reason === "string" ? reason : null
    }
  })
  if (!staged.ok) {
    emitWriteFailure(command, staged.error, staged.reasons.join(" / "), {
      valid: false,
      stagingId: null,
      path: config.architecturePath,
      warnings
    })
    return
  }

  emitResult(command, {
    ok: true,
    valid: true,
    stagingId: staged.stagingId,
    path: config.architecturePath,
    baseExists: file.exists,
    created: update.created,
    applied: update.applied,
    diff: {
      unified: unifiedDiff(file.text, update.text, {
        fromLabel: `${config.architectureRelative} (現行)`,
        toLabel: `${config.architectureRelative} (stage)`
      }),
      sections: sectionDiffs(file.text, update.text, update.applied)
    },
    expiresAt: new Date(staged.expiresAt).toISOString(),
    warnings,
    next: commandLine(`commit-architecture --staging-id ${staged.stagingId}`),
    reminder:
      "diff を全文提示してユーザーの承認を得るまで commit-architecture を実行しないこと。CLI は承認の有無を判定できない。"
  })
}

// ---------------------------------------------------------------------------
// stage-adr
// ---------------------------------------------------------------------------

export function runStageAdr(ctx: StageContext): void {
  const command = "stage-adr"

  const input = loadInputJson(ctx.flags)
  if (!input.ok) {
    emitWriteFailure(
      command,
      input.error,
      input.message,
      { valid: false },
      EXIT_USAGE
    )
    return
  }
  if (!isPlainObject(input.value)) {
    emitWriteFailure(
      command,
      "invalid_input",
      `${input.source} のトップレベルは { mode: "add" | "status", ... } のオブジェクトである必要があります。`,
      { valid: false },
      EXIT_USAGE
    )
    return
  }

  const config = loadConfig(ctx.cwd)

  let result: ReturnType<typeof stageAdr>
  try {
    // 値の検証は adr.ts が行う(CLI は形の主張だけを渡し、判断を持たない)。
    result = stageAdr(
      config.architecturePath,
      input.value as unknown as AdrInput
    )
  } catch (error) {
    if (error instanceof AdrError) {
      emitWriteFailure(command, error.code, error.message, {
        valid: false,
        stagingId: null,
        path: config.architecturePath,
        details: error.details,
        warnings: config.warnings
      })
      return
    }
    emitWriteFailure(command, "internal_error", messageOf(error), {
      valid: false,
      stagingId: null,
      path: config.architecturePath
    })
    return
  }

  const warnings = [...config.warnings, ...result.warnings]
  noteWarnings(warnings)

  const staged = createStaging({
    projectRoot: config.docRoot,
    kind: "adr",
    targetPath: config.architecturePath,
    nextContent: result.nextText,
    // stageAdr が採番のために読んだ本文をそのまま照合対象にする。
    baseHash: result.baseExists ? hashContent(result.baseText) : null,
    meta: {
      mode: result.mode,
      id: result.id,
      assignedId: result.assignedId,
      status: result.status,
      date: result.date
    }
  })
  if (!staged.ok) {
    emitWriteFailure(command, staged.error, staged.reasons.join(" / "), {
      valid: false,
      stagingId: null,
      path: config.architecturePath,
      warnings
    })
    return
  }

  emitResult(command, {
    ok: true,
    valid: true,
    stagingId: staged.stagingId,
    mode: result.mode,
    path: config.architecturePath,
    baseExists: result.baseExists,
    id: result.id,
    number: result.number,
    assignedId: result.assignedId,
    previousStatus: result.previousStatus,
    status: result.status,
    date: result.date,
    created: result.created,
    sectionCreated: result.sectionCreated,
    diff: {
      unified: unifiedDiff(result.baseText, result.nextText, {
        fromLabel: `${config.architectureRelative} (現行)`,
        toLabel: `${config.architectureRelative} (stage)`
      }),
      sections: sectionDiffs(result.baseText, result.nextText, [
        {
          heading: ADR_HEADING,
          mode: result.sectionCreated ? "added" : "replaced"
        }
      ])
    },
    expiresAt: new Date(staged.expiresAt).toISOString(),
    warnings,
    next: commandLine(`commit-architecture --staging-id ${staged.stagingId}`),
    reminder:
      "ADR の追加・状態変更は設計判断の宣言である。diff を全文提示して承認を得るまで commit-architecture を実行しないこと。"
  })
}
