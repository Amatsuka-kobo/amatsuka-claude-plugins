/**
 * code/destructive-ops と code/unsafe-exec が共有する、diff の追加行の走査(設計書 §6.4.2)。
 * `.md`・テストファイル・コメント行で一致したときは severity を 1 段下げる
 * (destructive-ops は stop を ask に、unsafe-exec は ask を info に)。
 * ファイルの種別は Raguel が組んだ diff のパスから決める。
 */

import type { Artifact, Finding, Severity } from "../../core/types.js"
import { truncateExcerpt } from "../util.js"
import { type DetailedDiffFile, parseDiff } from "./diffParse.js"

/** 一致した追加行。index は file.additions の位置 */
export interface Hit {
  index: number
  message: string
}

/** テストファイルのパス。code/test-deletion も使う */
export function isTestPath(path: string): boolean {
  const name = path.slice(path.lastIndexOf("/") + 1)
  return (
    /\.(test|spec)\.[^./]+$/.test(name) ||
    /_test\.[^./]+$/.test(name) ||
    name.startsWith("test_") ||
    /[A-Za-z0-9]Tests?\.java$/.test(name) ||
    /(^|\/)(test|tests|__test__|__tests__|e2e|spec)\//.test(path)
  )
}

/** 先頭の空白を除いて `//`・`#`・`/*`・`*`・`--`・`<!--` で始まる行 */
function isCommentLine(line: string): boolean {
  return /^\s*(\/\/|#|\/\*|\*|--|<!--)/.test(line)
}

function fileReason(path: string): string | undefined {
  if (/\.md$/i.test(path)) return ".md のファイル"
  if (isTestPath(path)) return "テストファイル"
  return undefined
}

const LOWER: Record<Severity, Severity> = {
  stop: "ask",
  ask: "info",
  info: "info"
}

/** diff の各ファイルの追加行を scan で走査し、所見にする。バイナリのファイルは飛ばす */
export function scanDiffAdditions(
  artifact: Artifact,
  ruleId: string,
  severity: Severity,
  scan: (file: DetailedDiffFile) => Hit[]
): Finding[] {
  const findings: Finding[] = []
  for (const file of parseDiff(artifact.content).files) {
    if (file.isBinary) continue
    const byFile = fileReason(file.path)
    for (const hit of scan(file)) {
      const text = file.additions[hit.index]
      const reason = byFile ?? (isCommentLine(text) ? "コメント行" : undefined)
      const lowered = reason === undefined ? severity : LOWER[severity]
      findings.push({
        ruleId,
        severity: lowered,
        message:
          lowered === severity
            ? hit.message
            : `${hit.message}(${reason}のため ${lowered} に下げました)`,
        evidence: {
          location: file.path,
          path: file.path,
          line: file.additionLines[hit.index],
          excerpt: truncateExcerpt(text)
        }
      })
    }
  }
  return findings
}

/** 行ごとの判定を Hit の列にする */
export function scanLines(
  file: DetailedDiffFile,
  checks: { test: (line: string) => boolean; message: string }[]
): Hit[] {
  const hits: Hit[] = []
  file.additions.forEach((line, index) => {
    for (const check of checks) {
      if (check.test(line)) hits.push({ index, message: check.message })
    }
  })
  return hits
}

/** シェルの語の末尾に付いた引用符・括弧・区切りを落とす(`"rm -rf /")` の `/")` など) */
export function trimToken(token: string): string {
  return token.replace(/["'`),;]+$/, "")
}
