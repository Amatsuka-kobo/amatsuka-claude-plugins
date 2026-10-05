// `scan-gotcha-candidates` と `remove-gotcha-candidate`(記録のタイミングとサブエージェント
// への注入の設計書 2-1)。
//
// scan-gotcha-candidates は読み取り経路で、常に exit 0 で返す。
// remove-gotcha-candidate は書き込み経路で、拒否と失敗をすべて終了コード 3 と
// `removePending` で返す。main.ts の catch(終了コード 1)へ例外を渡さないよう、
// ここで捕まえる。呼び出し方の誤り(オプションの欠落)だけは 2 で返す。

import path from "node:path"
import { loadConfig } from "../lib/config.js"
import {
  GotchaCandidateError,
  removeGotchaCandidate,
  scanGotchaCandidates
} from "../lib/gotcha-candidates.js"
import { stringFlag } from "./args.js"
import {
  EXIT_SHRINK_PENDING,
  EXIT_USAGE,
  emitReadFailure,
  emitResult,
  emitWriteFailure,
  messageOf,
  noteWarnings
} from "./output.js"

export interface GotchaCandidateContext {
  flags: Record<string, string | true>
  cwd: string
}

export function runScanGotchaCandidates(ctx: GotchaCandidateContext): void {
  const command = "scan-gotcha-candidates"
  try {
    const config = loadConfig(ctx.cwd)
    const result = scanGotchaCandidates(config.docRoot, config.gotchasPath)
    const warnings = [...config.warnings, ...result.warnings]
    noteWarnings(warnings)
    emitResult(command, {
      ok: true,
      repoRoot: result.repoRoot,
      candidates: result.candidates,
      warnings
    })
  } catch (error) {
    emitReadFailure(command, "internal_error", messageOf(error), {
      candidates: []
    })
  }
}

export function runRemoveGotchaCandidate(ctx: GotchaCandidateContext): void {
  const command = "remove-gotcha-candidate"

  const file = stringFlag(ctx.flags, "file")
  const hash = stringFlag(ctx.flags, "hash")
  const fileHash = stringFlag(ctx.flags, "file-hash")

  const missing: string[] = []
  if (file === undefined) missing.push("--file <path>")
  if (hash === undefined) missing.push("--hash <走査の hash>")
  if (fileHash === undefined) missing.push("--file-hash <走査の fileHash>")
  if (file === undefined || hash === undefined || fileHash === undefined) {
    emitWriteFailure(
      command,
      "missing_option",
      `${missing.join(" / ")} が必要です。`,
      { written: false },
      EXIT_USAGE
    )
    return
  }

  try {
    const config = loadConfig(ctx.cwd)
    const result = removeGotchaCandidate({
      docRoot: config.docRoot,
      file: path.resolve(ctx.cwd, file),
      hash,
      fileHash
    })
    noteWarnings(config.warnings)
    emitResult(command, {
      ok: true,
      written: true,
      file: result.file,
      title: result.title,
      warnings: config.warnings
    })
  } catch (error) {
    emitWriteFailure(
      command,
      error instanceof GotchaCandidateError ? error.code : "internal_error",
      messageOf(error),
      { written: false, removePending: { file, hash } },
      EXIT_SHRINK_PENDING
    )
  }
}
