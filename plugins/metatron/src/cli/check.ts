// 検査の層(契約 §12)。ARCHITECTURE の `metatron:checks` の定義を実行する。
//
// 読み取りの層(常に exit 0)にも書き込みの層にも当たらない。lint と CI に組み込むため、
// 違反は 1、定義や走査の問題は 2、想定外の内部エラーは 3 で終える。

import { extractChecks, runChecks } from "../lib/checks.js"
import { loadConfig } from "../lib/config.js"
import { readDocument } from "./input.js"
import { emitResult, note, noteWarnings } from "./output.js"

export const EXIT_VIOLATIONS = 1
export const EXIT_CHECK_UNUSABLE = 2
export const EXIT_INTERNAL = 3

export interface CheckContext {
  flags: Record<string, string | true>
  cwd: string
}

function fail(error: string, message: string, warnings: string[]): void {
  emitResult("check", { ok: false, error, message, warnings })
  noteWarnings(warnings)
  note(message)
  process.exitCode = EXIT_CHECK_UNUSABLE
}

export function runCheck(ctx: CheckContext): void {
  const config = loadConfig(ctx.cwd)
  const file = readDocument(config.architecturePath)
  const warnings = [...config.warnings, ...file.warnings]
  if (!file.exists) {
    fail(
      "architecture_missing",
      `${config.architecturePath} がありません。`,
      warnings
    )
    return
  }
  const parsed = extractChecks(file.text)
  warnings.push(...parsed.warnings)
  if (!parsed.ok) {
    fail(parsed.reason, parsed.message, warnings)
    return
  }
  const result = runChecks(config.docRoot, parsed.checks)
  if (!result.ok) {
    fail(result.reason, result.message, warnings)
    return
  }
  emitResult("check", {
    ok: result.violations.length === 0,
    violations: result.violations,
    checked: result.checked,
    skipped: result.skipped,
    warnings
  })
  noteWarnings(warnings)
  for (const v of result.violations) {
    note(`${v.file}:${String(v.line)}: ${v.message}(${v.specifier})`)
  }
  if (result.violations.length > 0) process.exitCode = EXIT_VIOLATIONS
}
