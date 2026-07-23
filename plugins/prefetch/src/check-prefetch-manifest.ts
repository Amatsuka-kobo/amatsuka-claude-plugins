#!/usr/bin/env node

import fs from "node:fs"
import path from "node:path"

let input: { cwd?: unknown } = {}
try {
  const rawInput = fs.readFileSync(0, "utf8")
  input = rawInput.trim() ? JSON.parse(rawInput) : {}
} catch {
  process.exit(0)
}

const projectDir =
  process.env.CLAUDE_PROJECT_DIR ||
  (typeof input.cwd === "string" ? input.cwd : process.cwd())
const manifestPath = path.join(projectDir, ".prefetch", "manifest.md")

let manifest: string
try {
  manifest = fs.readFileSync(manifestPath, "utf8")
} catch {
  process.exit(0)
}

const hasUnharvestedEntry = manifest.split(/\r?\n/).some((line: string) => {
  const cells = line.split("|").map((cell: string) => cell.trim())
  if (cells.length < 7) return false

  // 予測内容・有効条件の自由記述列に | が混入しても位置がずれないよう、
  // 固定フォーマットの task-id(先頭列)と状態(末尾から3番目 = 成果パス列の直前)で判定する
  const taskId = cells[1]
  const state = cells[cells.length - 3]
  return /^fr-\d+$/.test(taskId) && (state === "running" || state === "done")
})

if (!hasUnharvestedEntry) process.exit(0)

process.stdout.write(
  `${JSON.stringify({
    hookSpecificOutput: {
      hookEventName: "UserPromptSubmit",
      additionalContext:
        "未回収の prefetch 成果があります。ターン冒頭で .prefetch/manifest.md を確認し、今回のユーザー入力と有効条件を照合してください。合致する done の result.md だけを読み harvested に更新し、不合致は成果を読まず discarded、失敗は failed に更新してください。合致する running は、完了を待つか通常作業を進めて後から合流させてください。"
    }
  })}\n`
)
