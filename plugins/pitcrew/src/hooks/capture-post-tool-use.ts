#!/usr/bin/env node
// PostToolUse フック(設計書 §4): Write/Edit による成果物ファイル
// (docs/**/*.md)の作成・更新を review/ に捕捉する。Bash(テスト・ビルド結果)は
// Task 8 で追加。全経路フェイルオープン。
import fs from "node:fs"
import path from "node:path"
import { writeFileAtomic } from "../lib/atomic.js"
import { findReviewItemForPath, isArtifactPath } from "../lib/capture-rules.js"
import { headCommit } from "../lib/git.js"
import {
  type HookInput,
  logError,
  readStdinSync,
  resolveProjectDir
} from "../lib/hook-io.js"
import {
  type ReviewItem,
  renderReviewItem,
  writeReviewItem
} from "../lib/review.js"
import { loadRun, saveRun } from "../lib/run.js"

function captureArtifact(projectDir: string, input: HookInput): void {
  const filePath = input.tool_input?.file_path
  if (typeof filePath !== "string") return
  const rel = path.relative(projectDir, filePath).replaceAll("\\", "/")
  if (rel.startsWith("..") || path.isAbsolute(rel)) return // プロジェクト外
  if (!isArtifactPath(rel)) return

  let content: string
  try {
    content = fs.readFileSync(filePath, "utf8")
  } catch {
    return // 消えている等 — 何もしない
  }

  const sections = [`\`\`\`\`markdown\n${content.trimEnd()}\n\`\`\`\``]
  const oldStr = input.tool_input?.old_string
  const newStr = input.tool_input?.new_string
  if (typeof oldStr === "string" && typeof newStr === "string") {
    sections.push(
      [
        "## 変更概要",
        "",
        "変更前:",
        `\`\`\`\`\n${oldStr}\n\`\`\`\``,
        "変更後:",
        `\`\`\`\`\n${newStr}\n\`\`\`\``
      ].join("\n")
    )
  }

  const item: ReviewItem = {
    type: "artifact",
    title: `${rel} の${input.tool_name === "Write" ? "作成・更新" : "更新"}`,
    agent: input.agent_type ?? "session",
    paths: [rel],
    base: null,
    head: headCommit(projectDir),
    body: sections.join("\n\n")
  }

  // 同一ファイルの未レビュー項目があれば同じ ID のまま上書き(コアレス)
  const existing = findReviewItemForPath(projectDir, "artifact", rel)
  if (existing) {
    writeFileAtomic(
      existing.file,
      renderReviewItem(existing.id, item, new Date())
    )
    return
  }
  const run = loadRun(projectDir)
  const res = writeReviewItem(projectDir, run, item)
  saveRun(projectDir, res.run)
}

const input = readStdinSync()
if (!input) process.exit(0)
const projectDir = resolveProjectDir(input)

try {
  if (input.tool_name === "Write" || input.tool_name === "Edit") {
    captureArtifact(projectDir, input)
  }
  // Bash(テスト・ビルド結果)の捕捉は Task 8 で追加
} catch (err) {
  logError(projectDir, "capture-post-tool-use", err)
}
process.exit(0)
