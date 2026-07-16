#!/usr/bin/env node
// SubagentStop フック(設計書 §4): サブエージェント完了時に、直前の捕捉時点からの
// git diff を機械的に生成して .pitcrew/review/ に書き出す。全経路フェイルオープン。
import path from "node:path"
import { baselineTree, diffBetween, snapshotWorktree } from "../lib/git.js"
import { logError, readStdinSync, resolveProjectDir } from "../lib/hook-io.js"
import { type ReviewItem, writeReviewItem } from "../lib/review.js"
import { loadRun, saveRun } from "../lib/run.js"

const input = readStdinSync()
if (!input) process.exit(0)
const projectDir = resolveProjectDir(input)

try {
  const head = snapshotWorktree(projectDir)
  if (!head) process.exit(0) // git リポジトリでない等 — 何もしない

  const run = loadRun(projectDir)
  const base = run.lastCaptureCommit ?? baselineTree(projectDir)
  const now = new Date().toISOString()

  if (!base || base === head) {
    // 初回ベースライン確立 or 変更なし: 捕捉時点だけ進める
    saveRun(projectDir, { ...run, lastCaptureCommit: head, lastCaptureAt: now })
    process.exit(0)
  }

  const { diff, paths } = diffBetween(projectDir, base, head)
  if (paths.length === 0) {
    saveRun(projectDir, { ...run, lastCaptureCommit: head, lastCaptureAt: now })
    process.exit(0)
  }

  const first = path.basename(paths[0])
  const title =
    paths.length === 1
      ? `${first} の diff`
      : `${first} ほか ${paths.length - 1} ファイルの diff`
  const item: ReviewItem = {
    type: "diff",
    title,
    agent: input.agent_type ?? input.agent_id ?? "subagent",
    paths,
    base: base.slice(0, 7),
    head: head.slice(0, 7),
    body: `\`\`\`diff\n${diff.trimEnd()}\n\`\`\`\n`
  }
  const res = writeReviewItem(projectDir, run, item)
  saveRun(projectDir, {
    ...res.run,
    lastCaptureCommit: head,
    lastCaptureAt: now
  })
} catch (err) {
  logError(projectDir, "capture-subagent-stop", err)
}
process.exit(0)
