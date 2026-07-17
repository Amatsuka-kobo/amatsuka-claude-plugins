#!/usr/bin/env node
// PostToolUse / PostToolUseFailure フック(設計書 §4): Write/Edit による成果物
// ファイル(docs/**/*.md)と Bash のテスト・ビルド結果を review/ に捕捉する。
// 全経路フェイルオープン。run.json の read-modify-write は run.lock で直列化する(設計書 §6)。
// 捕捉対象・glob・コマンド追加は config(設計書 §7)で変わる。
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
import { loadConfig, type PitcrewConfig } from "../lib/config.js"
import { headCommit } from "../lib/git.js"
import {
  type HookInput,
  logError,
  readStdinSync,
  resolveProjectDir
} from "../lib/hook-io.js"
import { withRunLock } from "../lib/lock.js"
import {
  type ReviewItem,
  renderReviewItem,
  writeReviewItem
} from "../lib/review.js"
import { loadRun, saveRun } from "../lib/run.js"

function captureArtifact(
  projectDir: string,
  input: HookInput,
  config: PitcrewConfig
): void {
  const filePath = input.tool_input?.file_path
  if (typeof filePath !== "string") return
  const rel = path.relative(projectDir, filePath).replaceAll("\\", "/")
  if (rel.startsWith("..") || path.isAbsolute(rel)) return // プロジェクト外
  if (!isArtifactPath(rel, config.artifactGlobs)) return

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
  withRunLock(projectDir, () => {
    const run = loadRun(projectDir)
    const res = writeReviewItem(projectDir, run, item)
    saveRun(projectDir, res.run)
  })
}

function captureTestResult(
  projectDir: string,
  input: HookInput,
  config: PitcrewConfig
): void {
  const command = input.tool_input?.command
  if (typeof command !== "string") return
  const matched = matchTestCommand(command, config.testCommands)
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
  withRunLock(projectDir, () => {
    const run = loadRun(projectDir)
    const res = writeReviewItem(projectDir, run, item)
    saveRun(projectDir, res.run)
  })
}

const input = readStdinSync()
if (!input) process.exit(0)
const projectDir = resolveProjectDir(input)

try {
  const config = loadConfig(projectDir)
  if (input.tool_name === "Write" || input.tool_name === "Edit") {
    if (config.captureTargets.artifact)
      captureArtifact(projectDir, input, config)
  } else if (input.tool_name === "Bash") {
    if (config.captureTargets.test) captureTestResult(projectDir, input, config)
  }
} catch (err) {
  logError(projectDir, "capture-post-tool-use", err)
}
process.exit(0)
