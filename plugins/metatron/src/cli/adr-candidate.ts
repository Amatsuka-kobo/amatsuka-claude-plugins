// `scan-adr-candidates` と `shrink-adr-candidate`(codiel intent 駆動化の設計書 §6.11)。
//
// scan-adr-candidates は読み取り経路で、常に exit 0 で返す。
// shrink-adr-candidate は書き込み経路で、拒否と失敗をすべて終了コード 3 と
// `shrinkPending` で返す。main.ts の catch(終了コード 1)へ例外を渡さないよう、
// ここで捕まえる。呼び出し方の誤り(オプションの欠落・ADR 番号の形)だけは 2 で返す。

import path from "node:path"
import { parseAdrId } from "../lib/adr.js"
import {
  AdrCandidateError,
  scanAdrCandidates,
  shrinkAdrCandidate
} from "../lib/adr-candidates.js"
import { loadConfig } from "../lib/config.js"
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

export interface AdrCandidateContext {
  flags: Record<string, string | true>
  cwd: string
}

export function runScanAdrCandidates(ctx: AdrCandidateContext): void {
  const command = "scan-adr-candidates"
  try {
    const config = loadConfig(ctx.cwd)
    const result = scanAdrCandidates(config.docRoot, config.architecturePath)
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

export function runShrinkAdrCandidate(ctx: AdrCandidateContext): void {
  const command = "shrink-adr-candidate"

  const file = stringFlag(ctx.flags, "file")
  const candidateId = stringFlag(ctx.flags, "candidate-id")
  const adr = stringFlag(ctx.flags, "adr")
  const hash = stringFlag(ctx.flags, "hash")

  const missing: string[] = []
  if (file === undefined) missing.push("--file <path>")
  if (candidateId === undefined) missing.push("--candidate-id <候補 ID>")
  if (adr === undefined) missing.push("--adr <ADR-NNN>")
  if (hash === undefined) missing.push("--hash <走査の hash>")
  if (
    file === undefined ||
    candidateId === undefined ||
    adr === undefined ||
    hash === undefined
  ) {
    emitWriteFailure(
      command,
      "missing_option",
      `${missing.join(" / ")} が必要です。`,
      { written: false },
      EXIT_USAGE
    )
    return
  }

  const adrNumber = parseAdrId(adr)
  if (adrNumber === null) {
    emitWriteFailure(
      command,
      "invalid_option",
      `--adr は ADR-NNN の形で指定してください(受領: ${JSON.stringify(adr)})。`,
      { written: false },
      EXIT_USAGE
    )
    return
  }

  try {
    const config = loadConfig(ctx.cwd)
    const result = shrinkAdrCandidate({
      docRoot: config.docRoot,
      architecturePath: config.architecturePath,
      file: path.resolve(ctx.cwd, file),
      candidateId,
      adrNumber,
      hash
    })
    noteWarnings(config.warnings)
    emitResult(command, {
      ok: true,
      written: result.written,
      alreadyShrunk: !result.written,
      file: result.file,
      candidateId: result.candidateId,
      adr: result.adr,
      warnings: config.warnings
    })
  } catch (error) {
    emitWriteFailure(
      command,
      error instanceof AdrCandidateError ? error.code : "internal_error",
      messageOf(error),
      { written: false, shrinkPending: { file, candidateId, adr } },
      EXIT_SHRINK_PENDING
    )
  }
}
