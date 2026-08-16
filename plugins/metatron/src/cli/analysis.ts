// `scan` と `diff-architecture`(設計書 §9-1・§9-3)。どちらも読み取り経路であり、
// 書き込みを行わず、常に exit 0 で返す。
//
// **ファイルの読み取りとセクション分解は CLI の責務**である。scan.ts は
// architecture.ts に依存せず、セクション本文の文字列と抽出済みの domains を受け取る。

import {
  extractDomains,
  parseArchitectureForRead
} from "../lib/architecture.js"
import { loadConfig } from "../lib/config.js"
import {
  diffArchitecture,
  type ArchitectureSection as ScanArchitectureSection,
  scan
} from "../lib/scan.js"
import { readDocument } from "./input.js"
import {
  emitReadFailure,
  emitResult,
  messageOf,
  noteWarnings
} from "./output.js"

export interface AnalysisContext {
  flags: Record<string, string | true>
  cwd: string
}

export function runScan(ctx: AnalysisContext): void {
  const command = "scan"
  try {
    const result = scan(ctx.cwd)
    noteWarnings(result.warnings)
    emitResult(command, { ok: true, ...result })
  } catch (error) {
    emitReadFailure(command, "internal_error", messageOf(error))
  }
}

export function runDiffArchitecture(ctx: AnalysisContext): void {
  const command = "diff-architecture"
  try {
    const config = loadConfig(ctx.cwd)
    const file = readDocument(config.architecturePath)
    const doc = parseArchitectureForRead(file.text)
    const domains = extractDomains(file.text)

    const sections: ScanArchitectureSection[] = doc.sections.map((section) => ({
      heading: section.heading,
      body: section.body
    }))

    const scanned = scan(ctx.cwd)
    const result = diffArchitecture({
      scan: scanned,
      sections,
      architectureExists: file.exists,
      domains: domains.ok ? domains.domains : null
    })

    const warnings = [
      ...config.warnings,
      ...file.warnings,
      ...doc.warnings,
      ...domains.warnings,
      ...scanned.warnings,
      ...result.warnings
    ]
    noteWarnings(warnings)

    emitResult(command, {
      ok: true,
      root: scanned.root,
      architecture: {
        path: config.architecturePath,
        exists: file.exists,
        headings: doc.sections.map((s) => s.heading)
      },
      domains: {
        ok: domains.ok,
        reason: domains.reason
      },
      findings: result.findings,
      skipped: result.skipped,
      truncation: scanned.truncation,
      warnings
    })
  } catch (error) {
    emitReadFailure(command, "internal_error", messageOf(error))
  }
}
