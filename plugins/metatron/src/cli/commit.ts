// `commit-architecture --staging-id <id>`(契約 §11、設計書 §7-3・§7-4)。
//
// stage-architecture と stage-adr の両方の staging を消費できる。書き込みは
// `<architecture パス>.lock` の下で行う(契約 §11 のロック表)。
// stagingId 無しでは失敗する ——「差分を見せずにいきなり書く」経路をコマンド体系から
// 無くすことが、この 2 段階の目的である。

import { loadConfig } from "../lib/config.js"
import { GotchaError, withFileLock } from "../lib/gotchas.js"
import {
  type CommitStagingResult,
  commitStaging,
  readStaging
} from "../lib/staging.js"
import { stringFlag } from "./args.js"
import {
  EXIT_USAGE,
  emitResult,
  emitWriteFailure,
  messageOf,
  noteWarnings
} from "./output.js"

export interface CommitContext {
  flags: Record<string, string | true>
  cwd: string
}

export function runCommitArchitecture(ctx: CommitContext): void {
  const command = "commit-architecture"

  const stagingId = stringFlag(ctx.flags, "staging-id")
  if (stagingId === undefined || stagingId.trim() === "") {
    emitWriteFailure(
      command,
      "missing_staging_id",
      "--staging-id <id> が必要です。stage-architecture または stage-adr が返した stagingId を渡してください。",
      { written: false },
      EXIT_USAGE
    )
    return
  }

  const config = loadConfig(ctx.cwd)
  const found = readStaging(config.docRoot, stagingId.trim())
  if (!found.ok) {
    emitWriteFailure(command, found.error, found.reason, {
      written: false,
      stagingId: stagingId.trim()
    })
    return
  }

  const targetPath = found.record.targetPath
  let result: CommitStagingResult
  try {
    result = withFileLock(targetPath, () =>
      commitStaging({
        projectRoot: config.docRoot,
        stagingId: stagingId.trim()
      })
    )
  } catch (error) {
    if (error instanceof GotchaError) {
      emitWriteFailure(command, error.code, error.message, {
        written: false,
        stagingId: stagingId.trim(),
        path: targetPath
      })
      return
    }
    emitWriteFailure(command, "internal_error", messageOf(error), {
      written: false,
      stagingId: stagingId.trim(),
      path: targetPath
    })
    return
  }

  if (!result.ok) {
    emitWriteFailure(command, result.error, result.reason, {
      written: false,
      stagingId: stagingId.trim(),
      path: targetPath
    })
    return
  }

  noteWarnings(result.warnings)
  emitResult(command, {
    ok: true,
    written: true,
    path: result.path,
    bytesWritten: result.bytesWritten,
    stagingId: result.stagingId,
    kind: result.kind,
    meta: result.meta,
    warnings: [...config.warnings, ...result.warnings]
  })
}
