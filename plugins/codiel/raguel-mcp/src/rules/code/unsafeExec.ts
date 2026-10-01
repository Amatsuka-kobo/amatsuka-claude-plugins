/**
 * code/unsafe-exec — コードの実行と権限の付与の検出(sealed, 既定 ask)。設計書 §6.4.2。
 * 旧 code/dangerous-patterns のうち、破壊操作ではないものを持つ。
 * `.md`・テストファイル・コメント行の一致は info に下げる(patternScan.ts)。
 */

import type { Finding, Rule } from "../../core/types.js"
import { getSeverity } from "../util.js"
import type { DetailedDiffFile } from "./diffParse.js"
import { type Hit, scanDiffAdditions, scanLines } from "./patternScan.js"

const RULE_ID = "code/unsafe-exec"

/** `.exec(` などを child_process の呼び出しとみなす識別子。ファイルの import 名を足して使う */
const CHILD_PROCESS_NAMES = ["cp", "childProcess", "child_process"]

const IMPORT_RE =
  /(?:import\s+(?:\*\s+as\s+)?([A-Za-z_$][\w$]*)\s+from|(?:const|let|var)\s+([A-Za-z_$][\w$]*)\s*=\s*require\s*\()\s*["'](?:node:)?child_process["']/

const CALL_RE =
  /(?<![\w$])(?:([A-Za-z_$][\w$]*)\s*\.\s*)?(?:exec|execSync|execFile|execFileSync|spawn|spawnSync)\s*\(([^)]*)/g

/** 外部入力を連結した可能性のある引数(テンプレートの埋め込みか、変数との + 連結) */
const EXTERNAL_INPUT_RE = /\$\{|\+\s*[A-Za-z_$]/

function childProcessCall(line: string, names: Set<string>): boolean {
  for (const m of line.matchAll(CALL_RE)) {
    const receiver = m[1]
    if (receiver === undefined) {
      // `foo().exec(` のように、受け手の分からないメソッド呼び出しは数えない
      if (line[(m.index ?? 0) - 1] === ".") continue
    } else if (!names.has(receiver)) {
      continue
    }
    if (EXTERNAL_INPUT_RE.test(m[2])) return true
  }
  return false
}

const LINE_CHECKS = [
  {
    // メソッド呼び出し(`model.eval()` など)は除く
    test: (l: string) => /(?<![.\w$])eval\s*\(/.test(l),
    message: "eval() の使用を検出しました(コードの注入の経路になります)"
  },
  {
    test: (l: string) => /\bnew\s+Function\s*\(/.test(l),
    message: "new Function() の使用を検出しました(コードの注入の経路になります)"
  },
  {
    test: (l: string) =>
      /\b(curl|wget)\b[^\n|]*\|\s*(sudo\s+)?(sh|bash|zsh)\b/.test(l),
    message: "ダウンロードした内容をシェルへ直接渡すパターンを検出しました"
  },
  {
    test: (l: string) => /\bchmod\s+(-R\s+)?777\b/.test(l),
    message: "chmod 777 を検出しました(過剰な権限の付与)"
  }
]

function scanFile(file: DetailedDiffFile): Hit[] {
  const names = new Set(CHILD_PROCESS_NAMES)
  for (const line of file.additions) {
    const m = line.match(IMPORT_RE)
    const name = m?.[1] ?? m?.[2]
    if (name) names.add(name)
  }
  const hits = scanLines(file, LINE_CHECKS)
  file.additions.forEach((line, index) => {
    if (childProcessCall(line, names)) {
      hits.push({
        index,
        message:
          "外部入力を連結した可能性のある child_process の呼び出しを検出しました"
      })
    }
  })
  return hits
}

export const unsafeExecRule: Rule = {
  id: RULE_ID,
  appliesTo: ["code"],
  sealed: true,
  defaultSeverity: "ask",
  check(artifact, ctx): Finding[] {
    const severity = getSeverity(ctx.config.rules[RULE_ID], "ask")
    return scanDiffAdditions(artifact, RULE_ID, severity, scanFile)
  }
}
