// `commit-architecture --staging-id <id>` と `commit-rules --staging-id <id>`
// (契約 §11、設計書 §7-3・§7-4・§6-3)。
//
// staging を消費して書き込む処理は 1 つで、受け入れる `kind` だけが違う。
// `commit-architecture` は stage-architecture と stage-adr の staging を、
// `commit-rules` は stage-rules の staging を受ける。取り違えは
// `staging_kind_mismatch` で拒否し、**staging を消費しない**。
//
// 書き込みは対象ファイルの `.lock` の下で行う(契約 §11 のロック表)。
// stagingId 無しでは失敗する ——「差分を見せずにいきなり書く」経路をコマンド体系から
// 無くすことが、この 2 段階の目的である。

import { loadConfig } from "../lib/config.js"
import { GotchaError, withFileLock } from "../lib/gotchas.js"
import {
  type CommitStagingResult,
  commitStaging,
  readStaging,
  type StagingKind
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

interface CommitSpec {
  command: "commit-architecture" | "commit-rules"
  acceptedKinds: readonly StagingKind[]
  /** missing_staging_id と staging_kind_mismatch のメッセージに載せる案内。 */
  stageHint: string
}

function runCommit(ctx: CommitContext, spec: CommitSpec): void {
  const { command } = spec

  const stagingId = stringFlag(ctx.flags, "staging-id")
  if (stagingId === undefined || stagingId.trim() === "") {
    emitWriteFailure(
      command,
      "missing_staging_id",
      `--staging-id <id> が必要です。${spec.stageHint}`,
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

  // kind の照合は staging を消費する前に行う。取り違えた staging は
  // 消費されないまま残り、正しいコマンドで改めて commit できる。
  if (!spec.acceptedKinds.includes(found.record.kind)) {
    emitWriteFailure(
      command,
      "staging_kind_mismatch",
      `この stagingId は kind: "${found.record.kind}" です。${command} が受けるのは ${spec.acceptedKinds.map((kind) => `"${kind}"`).join(" / ")} です。${spec.stageHint}`,
      {
        written: false,
        stagingId: stagingId.trim(),
        kind: found.record.kind,
        acceptedKinds: [...spec.acceptedKinds]
      }
    )
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

export function runCommitArchitecture(ctx: CommitContext): void {
  runCommit(ctx, {
    command: "commit-architecture",
    acceptedKinds: ["architecture", "adr"],
    stageHint:
      "stage-architecture または stage-adr が返した stagingId を渡してください。"
  })
}

export function runCommitRules(ctx: CommitContext): void {
  runCommit(ctx, {
    command: "commit-rules",
    acceptedKinds: ["rules"],
    stageHint: "stage-rules が返した stagingId を渡してください。"
  })
}
