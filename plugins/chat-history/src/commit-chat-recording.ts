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
  indexSummaryFile: string
  sessionTitleFile: string
  headerFile?: string
  recordSlug?: string
}

interface AttemptPlan {
  version: 2
  attemptId: string
  targetLine: number
  recordTarget: { relativePath: string | null; appendMode: boolean }
  allowedNewRecordDir: string
  recordFilePrefix: string
  recordDate: string
  workerName: string
  sessionId?: string
  sessionNumber: number
}

function fail(message: string): never {
  throw new Error(message)
}

const MAX_BODY_BYTES = 8 * 1024 * 1024
const MAX_SESSION_TITLE_BYTES = 512
const MAX_HEADER_BYTES = 64 * 1024
const MAX_INDEX_SUMMARY_BYTES = 8192
const MAX_SLUG_LENGTH = 80

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
    indexSummaryFile: path.resolve(value("--index-summary-file") as string),
    sessionTitleFile: path.resolve(value("--session-title-file") as string),
    headerFile: (() => {
      const raw = value("--header-file", true)
      return raw ? path.resolve(raw) : undefined
    })(),
    recordSlug: value("--record-slug", true)
  }
}

// 先頭 4 桁数字を弾くのは二重プレフィックス対策。SKILL.md の全文が skillContract
// として chat-recorder へ渡るため、パス例を見た LLM がスラッグ自体へ "0712-" を
// 入れると 0712-0712-topic.md が検証を素通りしてしまう。
// ハイフンを伴わない "0712" 単体も弾く(0712-0712.md になる)。
function validSlug(value: string): boolean {
  if (!value || value.length > MAX_SLUG_LENGTH) return false
  if (/^\d{4}($|-)/.test(value)) return false
  return /^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(value)
}

function docsRelativePath(relativePath: string): string {
  return relativePath.replaceAll("\\", "/").replace(/^docs\/chat\//, "")
}

function composeIndexLine(
  relativePath: string,
  date: string,
  worker: string,
  summary: string
): string {
  return `- \`${docsRelativePath(relativePath)}\` | ${date} | ${worker} | ${summary}`
}

function validateInputs(
  args: Args,
  paths: ReturnType<typeof getStatePaths>,
  plan: AttemptPlan
): {
  /** 追記時は確定パス 1 件、新規時は EEXIST のときに順に試す候補 */
  candidates: string[]
  body: string
  summary: string
} {
  const temporaryFiles = [
    args.bodyFile,
    args.indexSummaryFile,
    args.sessionTitleFile,
    ...(args.headerFile ? [args.headerFile] : [])
  ]
  for (const file of temporaryFiles)
    if (!isInside(paths.tempDir, file))
      fail("temporary files must be inside the recording state temp directory")

  const rawBody = fs.readFileSync(args.bodyFile, "utf8")
  const summary = fs.readFileSync(args.indexSummaryFile, "utf8").trim()
  const sessionTitle = fs.readFileSync(args.sessionTitleFile, "utf8").trim()
  if (!rawBody) fail("record body is empty")
  if (!rawBody.includes("> "))
    fail("record body must contain a USER quote block")
  if (
    !sessionTitle ||
    sessionTitle.includes("\n") ||
    Buffer.byteLength(sessionTitle) > MAX_SESSION_TITLE_BYTES
  )
    fail("session title must be exactly one bounded line")
  if (
    !summary ||
    summary.includes("\n") ||
    // find-chat-records は INDEX 行を " | " で分解して要旨を取り出す。
    // 要旨に区切り文字が混ざると検索結果の表示が壊れる。
    summary.includes("|") ||
    Buffer.byteLength(summary) > MAX_INDEX_SUMMARY_BYTES
  )
    fail("INDEX summary must be exactly one bounded line without '|'")

  let header = ""
  if (plan.recordTarget.appendMode) {
    if (args.headerFile)
      fail("--header-file is forbidden when appending to an existing record")
  } else {
    const headerFile = args.headerFile
    if (!headerFile) fail("--header-file is required for a new record")
    header = fs.readFileSync(headerFile, "utf8")
    if (
      !header.startsWith("# ") ||
      Buffer.byteLength(header) > MAX_HEADER_BYTES
    )
      fail("record header must start with a title line and stay bounded")
  }

  if (plan.version !== 2)
    fail(
      `plan schema version mismatch: expected 2, got ${String(plan.version)}`
    )
  for (const field of [
    "allowedNewRecordDir",
    "recordFilePrefix",
    "recordDate",
    "workerName"
  ] as const)
    if (typeof plan[field] !== "string" || !plan[field])
      fail(`plan.${field} is missing`)

  // 旧版 prepare が書いた plan と組み合わされると `## セッション undefined` が記録に残る。
  if (!Number.isSafeInteger(plan.sessionNumber) || plan.sessionNumber <= 0)
    fail("plan.sessionNumber must be a positive integer")
  const heading = `## セッション ${plan.sessionNumber}: ${sessionTitle}`
  const body = plan.recordTarget.appendMode
    ? `\n${heading}\n\n${rawBody}`
    : `${header.trimEnd()}\n\n---\n\n${heading}\n\n${rawBody}`
  if (Buffer.byteLength(body) > MAX_BODY_BYTES) fail("record body is too large")
  if (!body.includes("## セッション"))
    fail("composed record must contain a session heading")

  // 追記時はパスが plan で確定している。--record-slug が付いていても無視する。
  // 拒否にすると、chat-recorder が習慣的にスラッグを付けただけで追記が落ちる。
  let candidates: string[]
  if (plan.recordTarget.relativePath !== null) {
    candidates = [plan.recordTarget.relativePath]
  } else {
    const slug = args.recordSlug
    if (!slug) throw new Error("--record-slug is required for a new target")
    if (!validSlug(slug))
      fail(
        `record slug violates the naming contract: expected at most ${MAX_SLUG_LENGTH} chars of [a-z0-9-] not starting with 4 digits, got ${slug}`
      )
    const base = `${plan.allowedNewRecordDir}/${plan.recordFilePrefix}-${slug}`
    candidates = [`${base}.md`]
    for (let suffix = 2; suffix <= 9; suffix++)
      candidates.push(`${base}-${suffix}.md`)
  }
  for (const candidate of candidates)
    if (!isInside(args.project, path.resolve(args.project, candidate)))
      fail("record path escapes project")
  return { candidates, body, summary }
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
  let relativePath = ""
  let recordPath = ""
  let oldRecordExisted = false
  let oldSize = 0
  let bodyUpdated = false
  try {
    if (plan.recordTarget.appendMode) {
      relativePath = input.candidates[0] as string
      recordPath = path.resolve(args.project, relativePath)
      if (!fs.existsSync(recordPath)) fail("append target disappeared")
      oldRecordExisted = true
      oldSize = fs.statSync(recordPath).size
      fs.appendFileSync(recordPath, input.body)
    } else {
      // 同じ分に始まった別セッションが同じスラッグを選んだときだけ衝突する。
      // 連番は 2 から始める(サフィックス無しが実質の 1 番目)。
      // ここで作ったファイルは oldRecordExisted=false のままなので、
      // ロールバックでは truncate ではなく削除になる。
      let written = false
      for (const candidate of input.candidates) {
        const absolute = path.resolve(args.project, candidate)
        fs.mkdirSync(path.dirname(absolute), { recursive: true })
        try {
          fs.writeFileSync(absolute, input.body, {
            encoding: "utf8",
            flag: "wx"
          })
        } catch (error) {
          if ((error as NodeJS.ErrnoException).code === "EEXIST") continue
          // EEXIST 以外(ENOSPC 等)では部分作成が残りうるので消してから投げる
          fs.rmSync(absolute, { force: true })
          throw error
        }
        relativePath = candidate
        recordPath = absolute
        written = true
        break
      }
      if (!written) fail("every candidate record path is already taken")
    }
    bodyUpdated = true

    const indexLine = composeIndexLine(
      relativePath,
      plan.recordDate,
      plan.workerName,
      input.summary
    )
    const lines = indexExisted
      ? (oldIndex.endsWith("\n") ? oldIndex.slice(0, -1) : oldIndex).split("\n")
      : ["# Chat Records Index", ""]
    const matches = indexMatches(lines, relativePath)
    if (matches.length > 1) fail("INDEX contains duplicate target entries")
    if (matches.length === 1) lines[matches[0] as number] = indexLine
    else insertIndexLine(lines, indexLine, relativePath)
    fs.mkdirSync(path.dirname(indexPath), { recursive: true })
    fs.writeFileSync(indexPath, `${lines.join("\n")}\n`, "utf8")

    const updatedRecord = fs.readFileSync(recordPath, "utf8")
    const updatedIndex = fs.readFileSync(indexPath, "utf8").split("\n")
    if (!updatedRecord.endsWith(input.body)) fail("record verification failed")
    if (indexMatches(updatedIndex, relativePath).length !== 1)
      fail("INDEX uniqueness verification failed")

    const nextState: RecordingState = {
      ...state,
      recordedLine: args.targetLine,
      attemptedLine: Math.max(state.attemptedLine, args.targetLine),
      lastSuccessAt: new Date().toISOString(),
      recordPath: relativePath,
      lastError: null
    }
    atomicWriteJson(paths.statePath, nextState)
    appendLog(
      paths.logPath,
      `=== result=success recordedLine=${args.targetLine} ===`
    )
    for (const file of [
      args.bodyFile,
      args.indexSummaryFile,
      args.sessionTitleFile,
      ...(args.headerFile ? [args.headerFile] : []),
      planPath,
      paths.lockPath
    ])
      fs.rmSync(file, { force: true })
    return {
      ok: true,
      recordedLine: args.targetLine,
      recordPath: relativePath,
      indexUpdated: true
    }
  } catch (error) {
    let manualRepairRequired = false
    if (bodyUpdated && recordPath) {
      try {
        if (oldRecordExisted) fs.truncateSync(recordPath, oldSize)
        else fs.rmSync(recordPath, { force: true })
        if (indexExisted) fs.writeFileSync(indexPath, oldIndex, "utf8")
        else fs.rmSync(indexPath, { force: true })
      } catch {
        manualRepairRequired = true
      }
    }
    const message = error instanceof Error ? error.message : String(error)
    atomicWriteJson(paths.statePath, {
      ...state,
      lastError: {
        attemptId: args.attemptId,
        at: new Date().toISOString(),
        phase: "commit",
        message,
        logPath: paths.logPath,
        manualRepairRequired,
        recordPath: relativePath,
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
