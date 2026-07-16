#!/usr/bin/env node
// PostToolUse フック(設計書 §4): Write/Edit による成果物ファイル
// (docs/**/*.md)の作成・更新を review/ に捕捉する。Bash(テスト・ビルド結果)は
// Task 8 で追加。全経路フェイルオープン。
import fs from "node:fs"
import path from "node:path"
import { writeFileAtomic } from "../lib/atomic.js"
import {
  extractBashResult,
  findReviewItemForPath,
  isArtifactPath,
  matchTestCommand,
  summarizeOutput
} from "../lib/capture-rules.js"
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

function captureTestResult(projectDir: string, input: HookInput): void {
  const command = input.tool_input?.command
  if (typeof command !== "string") return
  const matched = matchTestCommand(command)
  if (!matched) return

  const result = extractBashResult(input.tool_response)
  const failureEvent = input.hook_event_name === "PostToolUseFailure"
  const output = [
    result.output,
    typeof input.error === "string" ? input.error : ""
  ]
    .filter((part) => part !== "")
    .join("\n")
  const status = failureEvent ? "失敗" : result.failed ? "失敗の疑い" : "成功"
  const reason = failureEvent
    ? "PostToolUseFailure イベント"
    : "出力からの機械的推定"
  const body = [
    `- コマンド: \`${command}\``,
    `- 結果: ${status}(${reason})`,
    "",
    "## 出力(末尾)",
    "",
    `\`\`\`\n${summarizeOutput(output).trimEnd()}\n\`\`\``
  ].join("\n")

  const item: ReviewItem = {
    type: "test",
    title: `${matched} の実行結果: ${status}`,
    agent: input.agent_type ?? "session",
    paths: [],
    base: null,
    head: headCommit(projectDir),
    body
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
  } else if (input.tool_name === "Bash") {
    captureTestResult(projectDir, input)
  }
} catch (err) {
  logError(projectDir, "capture-post-tool-use", err)
}
process.exit(0)
