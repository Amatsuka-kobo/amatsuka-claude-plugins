#!/usr/bin/env node
import { execFileSync } from "node:child_process"
import fs from "node:fs"
import path from "node:path"
import { fileURLToPath } from "node:url"
import {
  atomicWriteJson,
  findTailTargetLine,
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
  version: 1 | 2
  attemptId: string
  targetLine: number
  effectiveTargetLine?: number
  userTurnLine?: number
  metadataHints: string[]
  recordTarget?: { relativePath: string | null; appendMode: boolean }
  allowedNewRecordDir?: string
  recordFilePrefix?: string
  recordDate?: string
  workerName?: string
  sessionId?: string
  sessionNumber?: number
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

// 日付ディレクトリとファイル名プレフィックスは同じ Date から導く。
// 別々に算出すると、日をまたぐセッションでディレクトリと時刻が食い違う。
export function localRecordParts(at: Date): {
  year: string
  monthDay: string
  hhmm: string
  date: string
} {
  const pad = (value: number): string => String(value).padStart(2, "0")
  const year = String(at.getFullYear())
  const month = pad(at.getMonth() + 1)
  const day = pad(at.getDate())
  return {
    year,
    monthDay: `${month}${day}`,
    hhmm: `${pad(at.getHours())}${pad(at.getMinutes())}`,
    date: `${year}-${month}-${day}`
  }
}

// 先頭の数行(last-prompt / mode / permission-mode / atis-latch など)は timestamp を
// 持たない。行の type では判定できないため「最初に有効な timestamp を持つ行」を採る。
export function firstTranscriptTimestamp(file: string): Date | null {
  let text: string
  try {
    text = fs.readFileSync(file, "utf8")
  } catch {
    return null
  }
  for (const line of text.split("\n")) {
    if (!line.trim()) continue
    let entry: { timestamp?: unknown } | null
    try {
      entry = JSON.parse(line) as { timestamp?: unknown } | null
    } catch {
      continue
    }
    if (!entry || typeof entry.timestamp !== "string") continue
    const at = new Date(entry.timestamp)
    if (!Number.isNaN(at.getTime())) return at
  }
  return null
}

// セッション開始時刻。transcript から採れないときはファイルの作成時刻へ落ちる。
// この値でファイル名が決まるだけなので、最後は現在時刻でも記録は成立する。
export function resolveSessionStartedAt(transcript: string): Date {
  const fromTranscript = firstTranscriptTimestamp(transcript)
  if (fromTranscript) return fromTranscript
  try {
    const stat = fs.statSync(transcript)
    if (stat.birthtimeMs > 0) return stat.birthtime
    if (stat.mtimeMs > 0) return stat.mtime
  } catch {
    // 取得できなければ現在時刻へ落とす
  }
  return new Date()
}

// セッション番号は記録ファイル全文から拾う。末尾数十行に窓を切ると、原文記録で
// 1 セッションが窓を超えたときに見出しを見失い、番号が 1 に戻って重複する。
// 旧テンプレートの `## セッションN`(スペース無し)にも一致させる。
function lastSessionNumber(text: string): number {
  let result = 0
  for (const match of text.matchAll(/^##\s*セッション\s*(\d+)/gm))
    result = Math.max(result, Number(match[1]))
  return result
}

// 失敗した attempt の一時ファイルは commit の削除処理を通らずに残る。
// 同じセッションの過去 attempt 分だけをここで掃除する(他セッションには触れない)。
function cleanStaleTemp(
  tempDir: string,
  sessionKey: string,
  attemptId: string
): void {
  let entries: string[]
  try {
    entries = fs.readdirSync(tempDir)
  } catch {
    return
  }
  for (const name of entries) {
    if (!name.startsWith(`${sessionKey}-`) || name.includes(attemptId)) continue
    try {
      fs.rmSync(path.join(tempDir, name), { force: true })
    } catch {
      // 掃除の失敗は記録本体の成否に影響させない
    }
  }
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
  const effectiveTargetLine = findTailTargetLine(
    args.transcript,
    args.targetLine
  )

  updateHeartbeat(paths.lockPath, args.attemptId)
  cleanStaleTemp(paths.tempDir, args.sessionKey, args.attemptId)
  const workerName = gitUser(args.project)
  // プレフィックスが使われるのは新規作成の 1 回だけで、2 回目以降は
  // state.recordPath が記録先を決める。毎回計算しても実害は無く、
  // state への書き込みを増やすとフックの書き込みと後勝ちで競合する。
  const parts = localRecordParts(resolveSessionStartedAt(args.transcript))
  const recordDir = path.join(
    args.project,
    "docs",
    "chat",
    parts.year,
    parts.monthDay,
    safeWorker(workerName)
  )
  const chatRoot = path.join(args.project, "docs", "chat")
  const previous = state.recordPath
    ? path.resolve(args.project, state.recordPath)
    : null
  const resumable =
    previous && isInside(chatRoot, previous) && fs.existsSync(previous)
      ? previous
      : null
  // 記録先は同一セッションが既に書いたファイルだけで決める。日付ディレクトリの
  // 候補数で決めると、別セッションの記録が同じファイルへ同居する。
  const selected = resumable
  const relativePath = selected
    ? path.relative(args.project, selected).replaceAll("\\", "/")
    : null
  const recordText = selected ? fs.readFileSync(selected, "utf8") : ""
  // chat-recorder へ渡す文脈は末尾 60 行のまま。番号の算出だけ全文を見る。
  const tailContext = selected
    ? recordText.split("\n").slice(-60).join("\n")
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
  const bodyFile = path.join(
    paths.tempDir,
    `${args.sessionKey}-${args.attemptId}.body.md`
  )
  const indexSummaryFile = path.join(
    paths.tempDir,
    `${args.sessionKey}-${args.attemptId}.index-summary.md`
  )
  const sessionTitleFile = path.join(
    paths.tempDir,
    `${args.sessionKey}-${args.attemptId}.session-title.md`
  )
  const headerFile = path.join(
    paths.tempDir,
    `${args.sessionKey}-${args.attemptId}.header.md`
  )
  const conversation = extractConversationFile(
    args.transcript,
    state.recordedLine,
    effectiveTargetLine,
    safeWorker(workerName)
  )
  const previousSessionNumber = lastSessionNumber(recordText)
  const sessionNumber = previousSessionNumber + 1
  // 本文は prepare が書き切る。chat-recorder は bodyFile を読み書きしない。
  fs.mkdirSync(paths.tempDir, { recursive: true, mode: 0o700 })
  fs.writeFileSync(
    bodyFile,
    conversation.endsWith("\n") ? conversation : `${conversation}\n`,
    { encoding: "utf8", mode: 0o600 }
  )
  atomicWriteJson(planPath, {
    ...plan,
    // フックが書く初期値は version 1。ここで明示的に上げないと commit が全件を拒否する
    version: 2,
    effectiveTargetLine,
    recordTarget,
    allowedNewRecordDir,
    recordFilePrefix: parts.hhmm,
    recordDate: parts.date,
    workerName,
    sessionId: state.sessionId,
    sessionNumber,
    preparedAt: new Date().toISOString()
  })
  return {
    version: 1,
    attemptId: args.attemptId,
    recordedLine: state.recordedLine,
    targetLine: args.targetLine,
    effectiveTargetLine,
    workerName,
    date: parts.date,
    conversation,
    skillContract: fs.readFileSync(pluginSkillPath, "utf8"),
    recordTarget,
    allowedNewRecordDir,
    recordFilePrefix: parts.hhmm,
    recordSlugExample: "conversation-topic",
    sessionId: state.sessionId,
    bodyFile,
    indexSummaryFile,
    sessionTitleFile,
    headerFile,
    sessionNumber,
    lastSessionNumber: previousSessionNumber,
    tailContext,
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
