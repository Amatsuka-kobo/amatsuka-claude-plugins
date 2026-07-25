#!/usr/bin/env node
import fs from "node:fs"
import path from "node:path"
import { fileURLToPath } from "node:url"
import {
  appendLog,
  atomicWriteJson,
  getStatePaths,
  isInside,
  type RecordingLock,
  type RecordingState,
  readJson,
  updateHeartbeat
} from "./chat-recording-state.js"

interface Args {
  project: string
  sessionKey: string
  attemptId: string
  targetLine: number
  bodyFile: string
  indexLineFile: string
  recordPath?: string
}

interface AttemptPlan {
  version: 1
  attemptId: string
  targetLine: number
  recordTarget: { relativePath: string | null; appendMode: boolean }
  allowedNewRecordDir: string
}

const fail = (message: string): never => {
  throw new Error(message)
}

function parseArgs(argv: string[]): Args {
  const value = (name: string, optional = false): string | undefined => {
    const index = argv.indexOf(name)
    if (index === -1 || !argv[index + 1]) {
      if (optional) return undefined
      fail(`missing ${name}`)
    }
    return argv[index + 1]
  }
  const targetLine = Number(value("--target-line"))
  if (!Number.isSafeInteger(targetLine) || targetLine <= 0)
    fail("invalid --target-line")
  return {
    project: path.resolve(value("--project") as string),
    sessionKey: value("--session-key") as string,
    attemptId: value("--attempt-id") as string,
    targetLine,
    bodyFile: path.resolve(value("--body-file") as string),
    indexLineFile: path.resolve(value("--index-line-file") as string),
    recordPath: value("--record-path", true)
  }
}

function validKebabMarkdown(name: string): boolean {
  return /^[a-z0-9]+(?:-[a-z0-9]+)*\.md$/.test(name)
}

function docsRelativePath(relativePath: string): string {
  return relativePath.replaceAll("\\", "/").replace(/^docs\/chat\//, "")
}

function validateInputs(
  args: Args,
  paths: ReturnType<typeof getStatePaths>,
  plan: AttemptPlan
): {
  recordPath: string
  relativePath: string
  body: string
  indexLine: string
} {
  if (
    !isInside(paths.tempDir, args.bodyFile) ||
    !isInside(paths.tempDir, args.indexLineFile)
  )
    fail("temporary files must be inside the recording state temp directory")
  const body = fs.readFileSync(args.bodyFile, "utf8")
  const indexLine = fs.readFileSync(args.indexLineFile, "utf8").trim()
  if (!body || Buffer.byteLength(body) > 1024 * 1024)
    fail("record body is empty or too large")
  if (
    !indexLine ||
    indexLine.includes("\n") ||
    Buffer.byteLength(indexLine) > 8192
  )
    fail("INDEX entry must be exactly one bounded line")
  if (!body.includes("## セッション") && plan.recordTarget.appendMode)
    fail("append body must contain a session heading")
  if (!body.includes("> ")) fail("record body must contain a USER quote block")

  let relativePath: string
  if (plan.recordTarget.relativePath !== null) {
    if (args.recordPath)
      fail("--record-path is forbidden for an existing target")
    relativePath = plan.recordTarget.relativePath
  } else {
    const requestedPath = args.recordPath
    if (!requestedPath)
      throw new Error("--record-path is required for a new target")
    relativePath = requestedPath.replaceAll("\\", "/")
    if (
      path.posix.dirname(relativePath) !== plan.allowedNewRecordDir ||
      !validKebabMarkdown(path.posix.basename(relativePath))
    )
      fail(
        `new record path violates the naming or directory contract: expected ${plan.allowedNewRecordDir}/<kebab-case>.md, got ${relativePath}`
      )
  }
  const recordPath = path.resolve(args.project, relativePath)
  if (!isInside(args.project, recordPath)) fail("record path escapes project")
  const docsRelative = docsRelativePath(relativePath)
  if (!indexLine.includes(docsRelative))
    fail(
      `INDEX entry does not reference the target record: expected docs/chat-relative path ${docsRelative}`
    )
  return { recordPath, relativePath, body, indexLine }
}

function indexMatches(lines: string[], relativePath: string): number[] {
  const docsRelative = docsRelativePath(relativePath)
  const matches: number[] = []
  for (const [index, line] of lines.entries())
    if (line.replaceAll("\\", "/").includes(docsRelative)) matches.push(index)
  return matches
}

function indexEntryPath(line: string): string | null {
  const entryPath = line.match(/^- `([^`]+)`/)?.[1]
  return entryPath ? docsRelativePath(entryPath) : null
}

function insertIndexLine(
  lines: string[],
  indexLine: string,
  relativePath: string
): void {
  const docsRelative = docsRelativePath(relativePath)
  let lastEntry = -1
  for (const [index, line] of lines.entries()) {
    const entryPath = indexEntryPath(line)
    if (entryPath === null) continue
    if (entryPath.localeCompare(docsRelative) > 0) {
      lines.splice(index, 0, indexLine)
      return
    }
    lastEntry = index
  }
  lines.splice(lastEntry === -1 ? lines.length : lastEntry + 1, 0, indexLine)
}

export function commitChatRecording(args: Args): Record<string, unknown> {
  const paths = getStatePaths(args.project, args.sessionKey)
  const state = readJson<RecordingState>(paths.statePath)
  if (
    state &&
    state.recordedLine >= args.targetLine &&
    state.attemptId === args.attemptId &&
    state.recordPath
  )
    return {
      ok: true,
      recordedLine: state.recordedLine,
      recordPath: state.recordPath,
      indexUpdated: true
    }
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
  updateHeartbeat(paths.lockPath, args.attemptId)
  let input: ReturnType<typeof validateInputs>
  try {
    input = validateInputs(args, paths, plan)
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    atomicWriteJson(paths.statePath, {
      ...state,
      consecutiveFailures: (state.consecutiveFailures ?? 0) + 1,
      lastError: {
        attemptId: args.attemptId,
        at: new Date().toISOString(),
        phase: "commit-validation",
        message,
        logPath: paths.logPath
      }
    } satisfies RecordingState)
    appendLog(paths.logPath, `[commit-validation] ${message}`)
    throw error
  }
  const indexPath = path.join(args.project, "docs", "chat", "INDEX.md")
  const indexExisted = fs.existsSync(indexPath)
  const oldIndex = indexExisted ? fs.readFileSync(indexPath, "utf8") : ""
  const oldRecordExisted = fs.existsSync(input.recordPath)
  const oldSize = oldRecordExisted ? fs.statSync(input.recordPath).size : 0
  let bodyUpdated = false
  try {
    fs.mkdirSync(path.dirname(input.recordPath), { recursive: true })
    if (plan.recordTarget.appendMode) {
      if (!oldRecordExisted) fail("append target disappeared")
      fs.appendFileSync(input.recordPath, input.body)
    } else {
      fs.writeFileSync(input.recordPath, input.body, {
        encoding: "utf8",
        flag: "wx"
      })
    }
    bodyUpdated = true

    const lines = indexExisted
      ? (oldIndex.endsWith("\n") ? oldIndex.slice(0, -1) : oldIndex).split("\n")
      : ["# Chat Records Index", ""]
    const matches = indexMatches(lines, input.relativePath)
    if (matches.length > 1) fail("INDEX contains duplicate target entries")
    if (matches.length === 1) lines[matches[0]] = input.indexLine
    else insertIndexLine(lines, input.indexLine, input.relativePath)
    fs.mkdirSync(path.dirname(indexPath), { recursive: true })
    fs.writeFileSync(indexPath, `${lines.join("\n")}\n`, "utf8")

    const updatedRecord = fs.readFileSync(input.recordPath, "utf8")
    const updatedIndex = fs.readFileSync(indexPath, "utf8").split("\n")
    if (!updatedRecord.endsWith(input.body)) fail("record verification failed")
    if (indexMatches(updatedIndex, input.relativePath).length !== 1)
      fail("INDEX uniqueness verification failed")

    const nextState: RecordingState = {
      ...state,
      recordedLine: args.targetLine,
      attemptedLine: Math.max(state.attemptedLine, args.targetLine),
      lastSuccessAt: new Date().toISOString(),
      recordPath: input.relativePath,
      lastError: null,
      consecutiveFailures: 0
    }
    atomicWriteJson(paths.statePath, nextState)
    appendLog(
      paths.logPath,
      `=== result=success recordedLine=${args.targetLine} ===`
    )
    for (const file of [
      args.bodyFile,
      args.indexLineFile,
      planPath,
      paths.lockPath
    ])
      fs.rmSync(file, { force: true })
    return {
      ok: true,
      recordedLine: args.targetLine,
      recordPath: input.relativePath,
      indexUpdated: true
    }
  } catch (error) {
    let manualRepairRequired = false
    if (bodyUpdated) {
      try {
        if (oldRecordExisted) fs.truncateSync(input.recordPath, oldSize)
        else fs.rmSync(input.recordPath)
        if (indexExisted) fs.writeFileSync(indexPath, oldIndex, "utf8")
        else fs.rmSync(indexPath, { force: true })
      } catch {
        manualRepairRequired = true
      }
    }
    const message = error instanceof Error ? error.message : String(error)
    atomicWriteJson(paths.statePath, {
      ...state,
      consecutiveFailures: (state.consecutiveFailures ?? 0) + 1,
      lastError: {
        attemptId: args.attemptId,
        at: new Date().toISOString(),
        phase: "commit",
        message,
        logPath: paths.logPath,
        manualRepairRequired,
        recordPath: input.relativePath,
        originalSize: oldSize
      }
    } satisfies RecordingState)
    appendLog(
      paths.logPath,
      `[commit] ${message}${manualRepairRequired ? " manual repair required" : ""}`
    )
    throw error
  }
}

function main(): void {
  try {
    console.log(
      JSON.stringify(commitChatRecording(parseArgs(process.argv.slice(2))))
    )
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    console.log(
      JSON.stringify({ ok: false, error: { code: "COMMIT_FAILED", message } })
    )
    process.exitCode = 1
  }
}

if (
  process.argv[1] &&
  fs.realpathSync(process.argv[1]) === fileURLToPath(import.meta.url)
)
  main()
