#!/usr/bin/env node
import { execFileSync } from "node:child_process"
import fs from "node:fs"
import path from "node:path"
import { fileURLToPath } from "node:url"
import {
  atomicWriteJson,
  getStatePaths,
  isInside,
  type RecordingLock,
  type RecordingState,
  readJson,
  updateHeartbeat
} from "./chat-recording-state.js"
import { extractConversationFile } from "./extract-conversation.js"

interface Args {
  project: string
  transcript: string
  sessionKey: string
  attemptId: string
  targetLine: number
}

interface AttemptPlan {
  version: 1
  attemptId: string
  targetLine: number
  metadataHints: string[]
  recordTarget?: { relativePath: string | null; appendMode: boolean }
  recordCandidates?: string[]
  allowedNewRecordDir?: string
  preparedAt?: string
}

const fail = (message: string): never => {
  throw new Error(message)
}

function parseArgs(argv: string[]): Args {
  const value = (name: string): string => {
    const index = argv.indexOf(name)
    if (index === -1 || !argv[index + 1]) fail(`missing ${name}`)
    return argv[index + 1]
  }
  const targetLine = Number(value("--target-line"))
  if (!Number.isSafeInteger(targetLine) || targetLine <= 0)
    fail("invalid --target-line")
  return {
    project: path.resolve(value("--project")),
    transcript: path.resolve(value("--transcript")),
    sessionKey: value("--session-key"),
    attemptId: value("--attempt-id"),
    targetLine
  }
}

function gitUser(project: string): string {
  try {
    return (
      execFileSync("git", ["-C", project, "config", "user.name"], {
        encoding: "utf8",
        stdio: ["ignore", "pipe", "ignore"]
      }).trim() || "unknown"
    )
  } catch {
    return "unknown"
  }
}

export const safeWorker = (name: string): string => {
  const normalized = name.replaceAll(/[\\/]/g, "-").replaceAll("..", "-").trim()
  return normalized && normalized !== "." ? normalized : "unknown"
}

function markdownFiles(dir: string): string[] {
  if (!fs.existsSync(dir)) return []
  return fs
    .readdirSync(dir, { withFileTypes: true })
    .filter((entry) => entry.isFile() && entry.name.endsWith(".md"))
    .map((entry) => path.join(dir, entry.name))
    .sort()
}

function tailLines(file: string, count: number): string {
  return fs.readFileSync(file, "utf8").split("\n").slice(-count).join("\n")
}

function lastSessionNumber(text: string): number {
  let result = 0
  for (const match of text.matchAll(/^## セッション\s+(\d+)/gm))
    result = Math.max(result, Number(match[1]))
  return result
}

export function prepareChatRecording(args: Args): Record<string, unknown> {
  if (!fs.existsSync(args.project) || !fs.statSync(args.project).isDirectory())
    fail("project directory does not exist")
  const paths = getStatePaths(args.project, args.sessionKey)
  const state = readJson<RecordingState>(paths.statePath)
  const lock = readJson<RecordingLock>(paths.lockPath)
  const planPath = path.join(paths.planDir, `${args.sessionKey}.json`)
  const plan = readJson<AttemptPlan>(planPath)
  if (!state || !lock || !plan) throw new Error("attempt/lock/plan missing")
  if (
    state.attemptId !== args.attemptId ||
    lock.attemptId !== args.attemptId ||
    plan.attemptId !== args.attemptId ||
    lock.targetLine !== args.targetLine ||
    plan.targetLine !== args.targetLine
  )
    fail("attempt/lock/plan mismatch")
  if (
    !fs.existsSync(args.transcript) ||
    path.resolve(state.transcriptPath) !== args.transcript
  )
    fail("transcript does not match the hook-approved path")
  if (args.targetLine <= state.recordedLine)
    fail("target line is already recorded")

  updateHeartbeat(paths.lockPath, args.attemptId)
  const workerName = gitUser(args.project)
  const now = new Date()
  const year = String(now.getFullYear())
  const monthDay = `${String(now.getMonth() + 1).padStart(2, "0")}${String(now.getDate()).padStart(2, "0")}`
  const recordDir = path.join(
    args.project,
    "docs",
    "chat",
    year,
    monthDay,
    safeWorker(workerName)
  )
  const candidates = markdownFiles(recordDir)
  // 同一セッションが既に記録したファイルを最優先で選ぶ。日付ディレクトリの
  // 候補数だけで判定すると、1日に複数セッションある日は候補が2件以上になり、
  // 毎回新規ファイルが作られてセッションの記録が断片化する。
  const chatRoot = path.join(args.project, "docs", "chat")
  const previous = state.recordPath
    ? path.resolve(args.project, state.recordPath)
    : null
  const resumable =
    previous && isInside(chatRoot, previous) && fs.existsSync(previous)
      ? previous
      : null
  const selected =
    resumable ?? (candidates.length === 1 ? (candidates[0] as string) : null)
  const relativeCandidates = candidates.map((file) =>
    path.relative(args.project, file).replaceAll("\\", "/")
  )
  const relativePath = selected
    ? path.relative(args.project, selected).replaceAll("\\", "/")
    : null
  const docsRelativePath = relativePath?.replace(/^docs\/chat\//, "") ?? null
  const tailContext = selected ? tailLines(selected, 60) : ""
  const indexPath = path.join(args.project, "docs", "chat", "INDEX.md")
  const indexLines = fs.existsSync(indexPath)
    ? fs.readFileSync(indexPath, "utf8").split("\n")
    : []
  const indexLine = relativePath
    ? (indexLines.find((line) => line.includes(docsRelativePath as string)) ??
      "")
    : ""
  const skillPath = path.join(
    path.dirname(fileURLToPath(import.meta.url)),
    "..",
    "skills",
    "chat",
    "SKILL.md"
  )
  const pluginSkillPath = process.env.CLAUDE_PLUGIN_ROOT
    ? path.join(process.env.CLAUDE_PLUGIN_ROOT, "skills", "chat", "SKILL.md")
    : path.resolve(skillPath)
  if (!fs.existsSync(pluginSkillPath)) fail("chat SKILL.md not found")

  const recordTarget = {
    relativePath,
    appendMode: relativePath !== null
  }
  const allowedNewRecordDir = path
    .relative(args.project, recordDir)
    .replaceAll("\\", "/")
  const newRecordPathExample = `${allowedNewRecordDir}/conversation-topic.md`
  atomicWriteJson(planPath, {
    ...plan,
    recordTarget,
    recordCandidates: relativeCandidates,
    allowedNewRecordDir,
    preparedAt: new Date().toISOString()
  })
  return {
    version: 1,
    attemptId: args.attemptId,
    recordedLine: state.recordedLine,
    targetLine: args.targetLine,
    workerName,
    date: `${year}-${monthDay.slice(0, 2)}-${monthDay.slice(2)}`,
    conversation: extractConversationFile(
      args.transcript,
      state.recordedLine,
      args.targetLine
    ),
    skillContract: fs.readFileSync(pluginSkillPath, "utf8"),
    recordTarget,
    recordCandidates: relativeCandidates,
    allowedNewRecordDir,
    newRecordPathExample,
    indexEntryPath: docsRelativePath,
    indexLineExample: docsRelativePath
      ? `- \`${docsRelativePath}\` | ${year}-${monthDay.slice(0, 2)}-${monthDay.slice(2)} | ${workerName} | <要旨>`
      : `- \`YYYY/MMDD/<worker>/<kebab-case>.md\` | YYYY-MM-DD | <worker> | <要旨>`,
    lastSessionNumber: lastSessionNumber(tailContext),
    tailContext,
    indexLine,
    metadataHints: plan.metadataHints
  }
}

function main(): void {
  try {
    console.log(
      JSON.stringify(prepareChatRecording(parseArgs(process.argv.slice(2))))
    )
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error))
    process.exitCode = 1
  }
}

if (
  process.argv[1] &&
  fs.realpathSync(process.argv[1]) === fileURLToPath(import.meta.url)
)
  main()
