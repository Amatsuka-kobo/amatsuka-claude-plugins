/**
 * code/dangerous-patterns — 危険な操作パターンの検出(sealed, 既定 stop)。
 * diff の追加行のみを検査する(削除行での発火は誤爆になるため)。
 * diff でない生コードが渡された場合は全文を検査する。
 * `.md` のファイル・テストファイル・コメント行で一致したときは stop を ask に下げる。
 */

import type { Finding, Rule } from "../../core/types.js"
import { getSeverity, truncateExcerpt } from "../util.js"
import { parseDiff } from "./diffParse.js"

const RULE_ID = "code/dangerous-patterns"

interface PatternCheck {
  name: string
  test: (line: string) => boolean
  message: string
}

const CHECKS: PatternCheck[] = [
  {
    name: "eval",
    test: (l) => /\beval\s*\(/.test(l),
    message: "eval() の使用を検出しました(コードインジェクションのリスク)"
  },
  {
    name: "new-function",
    test: (l) => /\bnew\s+Function\s*\(/.test(l),
    message:
      "new Function() の使用を検出しました(コードインジェクションのリスク)"
  },
  {
    name: "child-process-external-input",
    test: (l) =>
      /\b(?:child_process\.)?(?:exec|execSync|spawn|spawnSync)\s*\([^)]*(\$\{|\+\s*[a-zA-Z_$])/.test(
        l
      ),
    message: "外部入力が連結された可能性のある child_process 実行を検出しました"
  },
  {
    name: "rm-rf-root-or-home",
    test: (l) =>
      /\brm\s+-[a-zA-Z]*[rf][a-zA-Z]*[rf][a-zA-Z]*\s+(\/|~)(\s|$)/.test(l),
    message: "危険な rm -rf(ルート/ホーム対象)を検出しました"
  },
  {
    name: "pipe-download-to-shell",
    test: (l) => /\b(curl|wget)\b[^\n|]*\|\s*(sudo\s+)?(sh|bash|zsh)\b/.test(l),
    message:
      "curl/wget の出力をシェルに直接パイプする危険なパターンを検出しました"
  },
  {
    name: "chmod-777",
    test: (l) => /\bchmod\s+(-R\s+)?777\b/.test(l),
    message: "chmod 777 の使用を検出しました(過剰な権限付与)"
  },
  {
    name: "force-push-main",
    test: (l) =>
      /\bgit\s+push\b[^\n]*\s(--force|-f)\b[^\n]*\b(origin\/)?(main|master)\b/.test(
        l
      ) ||
      /\bgit\s+push\b[^\n]*\b(origin\/)?(main|master)\b[^\n]*\s(--force|-f)\b/.test(
        l
      ),
    message: "main/master への force push を検出しました"
  },
  {
    name: "drop-table",
    test: (l) => /\bDROP\s+TABLE\b/i.test(l),
    message: "DROP TABLE を検出しました"
  },
  {
    name: "delete-without-where",
    test: (l) => /\bDELETE\s+FROM\s+\S+/i.test(l) && !/\bWHERE\b/i.test(l),
    message: "WHERE 句のない DELETE FROM を検出しました"
  }
]

function scanLines(
  lines: string[],
  ruleId: string,
  severity: Finding["severity"],
  location: string | undefined
): Finding[] {
  const fileReason = location === undefined ? undefined : lowerReason(location)
  const findings: Finding[] = []
  for (const line of lines) {
    for (const check of CHECKS) {
      if (check.test(line)) {
        const reason =
          fileReason ?? (isCommentLine(line) ? "コメント行" : undefined)
        const lowered = severity === "stop" && reason !== undefined
        findings.push({
          ruleId,
          severity: lowered ? "ask" : severity,
          message: lowered
            ? `${check.message}(${reason}のため ask に下げました)`
            : check.message,
          evidence: {
            location,
            excerpt: truncateExcerpt(line)
          }
        })
      }
    }
  }
  return findings
}

/** `.md` のファイルとテストファイルは、一致しても stop を ask に下げる(決定 83 の (4)) */
function lowerReason(path: string): string | undefined {
  if (/\.md$/i.test(path)) return ".md のファイル"
  const name = path.slice(path.lastIndexOf("/") + 1)
  if (
    /\.(test|spec)\./.test(name) ||
    /_test\./.test(name) ||
    name.startsWith("test_") ||
    /(^|\/)(test|tests|__test__|__tests__|e2e|spec)\//.test(path)
  ) {
    return "テストファイル"
  }
  return undefined
}

/** 先頭の空白を除いて `//`・`#`・`/*`・`*`・`--`・`<!--` で始まる行 */
function isCommentLine(line: string): boolean {
  return /^\s*(\/\/|#|\/\*|\*|--|<!--)/.test(line)
}

/** files[] の本文の見出し(`tools/evaluateCode.ts` の toCodeArtifact が付ける) */
const FILES_HEADING_RE = /^--- (.+) ---$/

/**
 * files[] の本文を見出しで区切る。見出しより前の本文はパス無し(location: undefined)。
 * parseDiff は `--- <path> ---` の見出しを diff と見なさないので、パスをここで得る。
 */
function splitByFilesHeading(
  content: string
): Array<{ path: string | undefined; lines: string[] }> {
  const sections: Array<{ path: string | undefined; lines: string[] }> = [
    { path: undefined, lines: [] }
  ]
  for (const line of content.split("\n")) {
    const heading = line.match(FILES_HEADING_RE)
    if (heading) {
      sections.push({ path: heading[1], lines: [] })
    } else {
      sections[sections.length - 1].lines.push(line)
    }
  }
  return sections
}

export const dangerousPatternsRule: Rule = {
  id: RULE_ID,
  appliesTo: ["code"],
  sealed: true,
  defaultSeverity: "stop",
  check(artifact, ctx): Finding[] {
    const settings = ctx.config.rules[RULE_ID]
    const severity = getSeverity(settings, "stop")

    const parsed = parseDiff(artifact.content)

    if (parsed.files.length === 0) {
      // diff でない本文は全文検査。files[] の見出しがあれば、その区間をそのパスの行として検査する
      return splitByFilesHeading(artifact.content).flatMap((section) =>
        scanLines(section.lines, RULE_ID, severity, section.path)
      )
    }

    const findings: Finding[] = []
    for (const file of parsed.files) {
      findings.push(...scanLines(file.additions, RULE_ID, severity, file.path))
    }
    return findings
  }
}
