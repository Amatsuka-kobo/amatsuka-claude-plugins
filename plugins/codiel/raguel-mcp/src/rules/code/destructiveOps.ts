/**
 * code/destructive-ops — 破壊操作の検出(sealed, 既定 stop)。設計書 §6.4.2。
 * 旧 code/dangerous-patterns のうち、実行すると取り消せない操作だけを持つ。
 * `.md`・テストファイル・コメント行の一致は ask に下げる(patternScan.ts)。
 */

import type { Finding, Rule } from "../../core/types.js"
import { getSeverity } from "../util.js"
import type { DetailedDiffFile } from "./diffParse.js"
import {
  type Hit,
  scanDiffAdditions,
  scanLines,
  trimToken
} from "./patternScan.js"

const RULE_ID = "code/destructive-ops"

/** DELETE FROM の文末(`;`)を探す行数の上限 */
const DELETE_LOOKAHEAD_LINES = 10

/** rm -rf の対象として危険な語。`${X:?}` の形の変数展開は、空なら止まるので外す */
function isDangerousRmTarget(raw: string): boolean {
  const t = trimToken(raw)
  return (
    /^["']?\/\*?$/.test(t) ||
    /^["']?~(\/\*?)?$/.test(t) ||
    /^["']?\$(HOME|\{HOME\})["']?(\/\*?)?$/.test(t) ||
    (/^\$\{?[A-Za-z_]\w*/.test(t) && !/^\$\{[A-Za-z_]\w*:\?/.test(t)) ||
    /^"\$\{?[A-Za-z_]\w*\}?"\//.test(t)
  )
}

function isDangerousRm(line: string): boolean {
  for (const m of line.matchAll(/\brm\s+([^;&|\n]*)/g)) {
    let recursive = false
    let force = false
    const targets: string[] = []
    for (const token of m[1].trim().split(/\s+/)) {
      if (token === "--recursive") recursive = true
      else if (token === "--force") force = true
      else if (/^-[A-Za-z]+$/.test(token)) {
        if (/[rR]/.test(token)) recursive = true
        if (token.includes("f")) force = true
      } else if (token !== "" && !token.startsWith("--")) targets.push(token)
    }
    if (recursive && force && targets.some(isDangerousRmTarget)) return true
  }
  return false
}

/** git push の --force・-f・+<refspec>。対象のブランチを問わない */
function isForcePush(line: string): boolean {
  const m = line.match(/\bgit\s+push\b([^;&|\n]*)/)
  if (!m) return false
  return m[1]
    .trim()
    .split(/\s+/)
    .map(trimToken)
    .some(
      (a) =>
        a.startsWith("--force") ||
        /^-[A-Za-z]*f[A-Za-z]*$/.test(a) ||
        /^\+\S+/.test(a)
    )
}

const RESET_HARD_RE = /\bgit\s+reset\b[^;&|\n]*\s--hard(?=\s|$|[;&|"'`)])/
const CLEAN_FORCE_RE =
  /\bgit\s+clean\b[^;&|\n]*\s(-[A-Za-z]*f[A-Za-z]*|--force)(?=\s|$|[;&|"'`)])/

/** WHERE を持たない DELETE FROM。文末の `;` まで次の行も見る */
function deleteWithoutWhere(additions: string[], index: number): boolean {
  const line = additions[index]
  const m = line.match(/\bDELETE\s+FROM\b/i)
  if (!m) return false
  let statement = line.slice(m.index)
  for (
    let j = index + 1;
    !statement.includes(";") &&
    j < additions.length &&
    j <= index + DELETE_LOOKAHEAD_LINES;
    j++
  ) {
    statement += `\n${additions[j]}`
  }
  const end = statement.indexOf(";")
  return !/\bWHERE\b/i.test(end >= 0 ? statement.slice(0, end) : statement)
}

const LINE_CHECKS = [
  {
    test: isDangerousRm,
    message: "ルート・ホーム・変数展開のパスを対象にした rm -rf を検出しました"
  },
  {
    test: isForcePush,
    message: "git push の強制(--force・-f・+<refspec>)を検出しました"
  },
  {
    test: (l: string) => /\bDROP\s+(TABLE|DATABASE)\b/i.test(l),
    message: "DROP TABLE・DROP DATABASE を検出しました"
  },
  {
    test: (l: string) =>
      /\bTRUNCATE\s+TABLE\b/i.test(l) || /\bTRUNCATE\s+[A-Za-z_"`[]/.test(l),
    message: "TRUNCATE を検出しました"
  }
]

function scanFile(file: DetailedDiffFile): Hit[] {
  const hits = scanLines(file, LINE_CHECKS)
  file.additions.forEach((_, index) => {
    if (deleteWithoutWhere(file.additions, index)) {
      hits.push({ index, message: "WHERE 句のない DELETE FROM を検出しました" })
    }
  })
  const reset = file.additions.findIndex((l) => RESET_HARD_RE.test(l))
  const clean = file.additions.findIndex((l) => CLEAN_FORCE_RE.test(l))
  if (reset >= 0 && clean >= 0) {
    hits.push({
      index: Math.max(reset, clean),
      message:
        "git reset --hard と git clean -f の組を検出しました(追跡していないファイルも消えます)"
    })
  }
  return hits
}

export const destructiveOpsRule: Rule = {
  id: RULE_ID,
  appliesTo: ["code"],
  sealed: true,
  defaultSeverity: "stop",
  check(artifact, ctx): Finding[] {
    const severity = getSeverity(ctx.config.rules[RULE_ID], "stop")
    return scanDiffAdditions(artifact, RULE_ID, severity, scanFile)
  }
}
