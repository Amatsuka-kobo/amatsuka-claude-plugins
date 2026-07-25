import { createHash, randomUUID } from "node:crypto"
import fs from "node:fs"
import os from "node:os"
import path from "node:path"

export const NAG_MARKER = "<!--chat-recorder-nag-->"
export const STATE_VERSION = 1
export const MAX_TOOL_HINTS = 20
export const MAX_TOOL_HINT_LENGTH = 120

export interface RecordingError {
  attemptId: string
  at: string
  phase: string
  message: string
  logPath: string
  manualRepairRequired?: boolean
  recordPath?: string
  originalSize?: number
}

export interface TranscriptIdentity {
  dev?: number
  ino?: number
}

export interface RecordingState {
  version: 1
  projectDir: string
  sessionId?: string
  transcriptPath: string
  transcriptIdentity: TranscriptIdentity
  recordedLine: number
  attemptedLine: number
  attemptId?: string
  attemptStartedAt?: string
  lastSuccessAt?: string
  recordPath?: string
  lastError: RecordingError | null
  lastNotifiedAttemptId: string | null
  previousGeneration?: {
    recordedLine: number
    attemptedLine: number
    transcriptIdentity: TranscriptIdentity
  }
}

export interface RecordingLock {
  version: 1
  attemptId: string
  targetLine: number
  pid: number | null
  createdAt: string
  heartbeatAt: string
}

export interface ScanResult {
  lineCount: number
  lastUserTurn: number
  lastNag: number
  toolHints: string[]
  identity: TranscriptIdentity
}

export interface StatePaths {
  baseDir: string
  projectDir: string
  stateDir: string
  lockDir: string
  logDir: string
  tempDir: string
  planDir: string
  statePath: string
  lockPath: string
  logPath: string
}

export type RecordingDecision =
  | { action: "noop"; reason: string }
  | { action: "notify"; reason: string }
  | { action: "spawn"; targetLine: number; notify: boolean }

interface TranscriptContent {
  type?: string
  name?: string
  input?: {
    description?: unknown
    file_path?: unknown
    subagent_type?: unknown
  }
}

interface TranscriptEntry {
  type?: string
  isSidechain?: boolean
  isMeta?: boolean
  message?: {
    content?: string | TranscriptContent[]
  }
}

export const normalizePath = (value: string): string => {
  const resolved = path.resolve(value)
  return process.platform === "win32"
    ? resolved
        .replaceAll("\\", "/")
        .replace(/^[A-Z]:/, (drive) => drive.toLowerCase())
    : resolved
}

export const hashKey = (value: string): string =>
  createHash("sha256").update(value).digest("hex").slice(0, 24)

export function getSessionKey(
  sessionId: string | undefined,
  transcriptPath: string
): string {
  return sessionId
    ? hashKey(`session:${sessionId}`)
    : hashKey(`transcript:${normalizePath(transcriptPath)}`)
}

export function claudeConfigRoot(env: NodeJS.ProcessEnv = process.env): string {
  const configured = env.CLAUDE_CONFIG_DIR
  return configured && path.isAbsolute(configured)
    ? path.resolve(configured)
    : path.join(os.homedir(), ".claude")
}

const currentUid = (): number | null =>
  typeof process.getuid === "function" ? process.getuid() : null

// ヘッドレス recorder の Write は Claude 設定ディレクトリ配下を sensitive file として
// 拒否されるため(--add-dir でも --permission-mode acceptEdits でも解除されない)、
// 一時ファイルだけは必ずその外側へ退避させる。
function resolveTempDir(
  projectStateDir: string,
  projectKey: string,
  env: NodeJS.ProcessEnv
): string {
  const candidate = path.join(projectStateDir, "temp")
  const configRoot = claudeConfigRoot(env)
  if (
    normalizePath(candidate) !== normalizePath(configRoot) &&
    !isInside(configRoot, candidate)
  )
    return candidate
  const uid = currentUid()
  const scope =
    uid === null
      ? "task-utility-chat-recorder"
      : `task-utility-chat-recorder-${uid}`
  return path.join(os.tmpdir(), scope, projectKey, "temp")
}

export function getStatePaths(
  projectDir: string,
  sessionKey: string,
  env: NodeJS.ProcessEnv = process.env
): StatePaths {
  const configured = env.TASK_UTILITY_CHAT_STATE_DIR
  const claudeConfig = env.CLAUDE_CONFIG_DIR
  const root =
    configured && path.isAbsolute(configured)
      ? configured
      : claudeConfig && path.isAbsolute(claudeConfig)
        ? path.join(claudeConfig, "task-utility", "chat-recorder")
        : path.join(os.homedir(), ".claude", "task-utility", "chat-recorder")
  const projectKey = hashKey(normalizePath(projectDir))
  const projectStateDir = path.join(root, projectKey)
  return {
    baseDir: projectStateDir,
    projectDir,
    stateDir: path.join(projectStateDir, "state"),
    lockDir: path.join(projectStateDir, "locks"),
    logDir: path.join(projectStateDir, "logs"),
    tempDir: resolveTempDir(projectStateDir, projectKey, env),
    planDir: path.join(projectStateDir, "plans"),
    statePath: path.join(projectStateDir, "state", `${sessionKey}.json`),
    lockPath: path.join(projectStateDir, "locks", `${sessionKey}.lock`),
    logPath: path.join(projectStateDir, "logs", `${sessionKey}.log`)
  }
}

// 一時ディレクトリは os.tmpdir() 配下に出る場合があるため、
// 他者による事前作成やシンボリックリンク差し替えを検出してから使う。
function assertPrivateTempDir(dir: string): void {
  const stat = fs.lstatSync(dir)
  if (stat.isSymbolicLink() || !stat.isDirectory())
    throw new Error(`chat-recorder temp dir is not a real directory: ${dir}`)
  const uid = currentUid()
  if (uid !== null && stat.uid !== uid)
    throw new Error(`chat-recorder temp dir is not owned by this user: ${dir}`)
  if (process.platform !== "win32") fs.chmodSync(dir, 0o700)
}

export function ensureStateDirs(paths: StatePaths): void {
  for (const dir of [
    paths.stateDir,
    paths.lockDir,
    paths.logDir,
    paths.tempDir,
    paths.planDir
  ])
    fs.mkdirSync(dir, { recursive: true, mode: 0o700 })
  assertPrivateTempDir(paths.tempDir)
}

export function atomicWriteJson(file: string, value: unknown): void {
  fs.mkdirSync(path.dirname(file), { recursive: true, mode: 0o700 })
  const temp = `${file}.${process.pid}.${randomUUID()}.tmp`
  fs.writeFileSync(temp, `${JSON.stringify(value, null, 2)}\n`, {
    encoding: "utf8",
    mode: 0o600
  })
  fs.renameSync(temp, file)
}

export function readJson<T>(file: string): T | null {
  try {
    return JSON.parse(fs.readFileSync(file, "utf8")) as T
  } catch {
    return null
  }
}

export function transcriptIdentity(file: string): TranscriptIdentity {
  const stat = fs.statSync(file)
  return {
    dev: Number.isSafeInteger(stat.dev) ? stat.dev : undefined,
    ino: Number.isSafeInteger(stat.ino) ? stat.ino : undefined
  }
}

export function sanitizeHint(value: unknown): string {
  const withoutControls = [...String(value)]
    .map((character) => {
      const code = character.codePointAt(0) ?? 0
      return code <= 31 || (code >= 127 && code <= 159) ? " " : character
    })
    .join("")
  return withoutControls
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, MAX_TOOL_HINT_LENGTH)
}

function toolHint(content: TranscriptContent): string {
  const input = content.input
  const detail =
    content.name === "Bash"
      ? input?.description
      : content.name === "Agent"
        ? [input?.subagent_type, input?.description].filter(Boolean).join(" — ")
        : (input?.file_path ?? input?.description)
  return sanitizeHint(
    `${content.name ?? "unknown"}${detail ? ` — ${detail}` : ""}`
  )
}

export function scanTranscript(file: string, sinceLine = 0): ScanResult {
  let lineCount = 0
  let lastUserTurn = -1
  let lastNag = -1
  const hints: string[] = []
  const seenHints = new Set<string>()
  for (const line of fs.readFileSync(file, "utf8").split("\n")) {
    lineCount++
    if (!line.trim()) continue
    let entry: TranscriptEntry
    try {
      entry = JSON.parse(line) as TranscriptEntry
    } catch {
      continue
    }
    if (!entry.message || entry.isSidechain) continue
    if (entry.type === "user" && typeof entry.message.content === "string") {
      const text = entry.message.content.trim()
      if (text.includes(NAG_MARKER)) lastNag = lineCount
      else if (text && !text.startsWith("<") && !entry.isMeta)
        lastUserTurn = lineCount
      continue
    }
    if (
      entry.type !== "assistant" ||
      !Array.isArray(entry.message.content) ||
      lineCount <= sinceLine
    )
      continue
    for (const content of entry.message.content) {
      if (content.type !== "tool_use") continue
      const hint = toolHint(content)
      if (hint && !seenHints.has(hint) && hints.length < MAX_TOOL_HINTS) {
        hints.push(hint)
        seenHints.add(hint)
      }
    }
  }
  return {
    lineCount,
    lastUserTurn,
    lastNag,
    toolHints: hints,
    identity: transcriptIdentity(file)
  }
}

export function createInitialState(
  projectDir: string,
  transcriptPath: string,
  identity: TranscriptIdentity,
  sessionId?: string
): RecordingState {
  return {
    version: STATE_VERSION,
    projectDir,
    sessionId,
    transcriptPath,
    transcriptIdentity: identity,
    recordedLine: 0,
    attemptedLine: 0,
    lastError: null,
    lastNotifiedAttemptId: null
  }
}

const identityChanged = (
  previous: TranscriptIdentity,
  current: TranscriptIdentity
): boolean =>
  previous.dev !== undefined &&
  previous.ino !== undefined &&
  current.dev !== undefined &&
  current.ino !== undefined &&
  (previous.dev !== current.dev || previous.ino !== current.ino)

export function reconcileGeneration(
  state: RecordingState,
  scan: ScanResult
): { state: RecordingState; changed: boolean } {
  const changed =
    identityChanged(state.transcriptIdentity, scan.identity) ||
    scan.lineCount < state.recordedLine ||
    (scan.lastUserTurn !== -1 && scan.lastUserTurn < state.recordedLine)
  if (!changed)
    return {
      state: { ...state, transcriptIdentity: scan.identity },
      changed: false
    }
  return {
    changed: true,
    state: {
      ...state,
      previousGeneration: {
        recordedLine: state.recordedLine,
        attemptedLine: state.attemptedLine,
        transcriptIdentity: state.transcriptIdentity
      },
      transcriptIdentity: scan.identity,
      recordedLine: 0,
      attemptedLine: 0,
      attemptId: undefined,
      attemptStartedAt: undefined
    }
  }
}

export function isProcessAlive(pid: number): boolean {
  try {
    process.kill(pid, 0)
    return true
  } catch (error) {
    return (error as NodeJS.ErrnoException).code === "EPERM"
  }
}

export function isStaleLock(
  lock: RecordingLock | null,
  state: RecordingState,
  now = Date.now(),
  processAlive: (pid: number) => boolean = isProcessAlive
): boolean {
  if (
    !lock ||
    lock.version !== STATE_VERSION ||
    !lock.attemptId ||
    lock.attemptId !== state.attemptId
  )
    return true
  const created = Date.parse(lock.createdAt)
  const heartbeat = Date.parse(lock.heartbeatAt)
  if (!Number.isFinite(created) || !Number.isFinite(heartbeat)) return true
  if (lock.pid === null) return now - heartbeat > 30_000
  if (!processAlive(lock.pid)) return true
  return now - heartbeat > 30 * 60_000
}

export function decideRecordingAction(
  scan: ScanResult,
  state: RecordingState,
  hasActiveLock: boolean
): RecordingDecision {
  if (scan.lastUserTurn === -1)
    return { action: "noop", reason: "no-user-turn" }
  if (scan.lastUserTurn <= state.recordedLine)
    return { action: "noop", reason: "already-recorded" }
  if (hasActiveLock) return { action: "noop", reason: "active-lock" }
  if (state.attemptedLine >= scan.lastUserTurn)
    return state.lastError &&
      state.lastNotifiedAttemptId !== state.lastError.attemptId
      ? { action: "notify", reason: "failed-attempt" }
      : { action: "noop", reason: "already-attempted" }
  return {
    action: "spawn",
    targetLine: scan.lastUserTurn,
    notify:
      state.lastError !== null &&
      state.lastNotifiedAttemptId !== state.lastError.attemptId
  }
}

export function appendLog(file: string, line: string): void {
  fs.mkdirSync(path.dirname(file), { recursive: true, mode: 0o700 })
  if (fs.existsSync(file) && fs.statSync(file).size > 1024 * 1024) {
    const fd = fs.openSync(file, "r")
    try {
      const size = fs.statSync(file).size
      const keep = Math.min(512 * 1024, size)
      const buffer = Buffer.alloc(keep)
      fs.readSync(fd, buffer, 0, keep, size - keep)
      fs.writeFileSync(file, buffer, { mode: 0o600 })
    } finally {
      fs.closeSync(fd)
    }
  }
  fs.appendFileSync(file, `${line}\n`, { encoding: "utf8", mode: 0o600 })
}

export function acquireLock(
  lockPath: string,
  targetLine: number
): RecordingLock {
  const now = new Date().toISOString()
  const lock: RecordingLock = {
    version: STATE_VERSION,
    attemptId: randomUUID(),
    targetLine,
    pid: null,
    createdAt: now,
    heartbeatAt: now
  }
  fs.mkdirSync(path.dirname(lockPath), { recursive: true, mode: 0o700 })
  fs.writeFileSync(lockPath, `${JSON.stringify(lock, null, 2)}\n`, {
    encoding: "utf8",
    mode: 0o600,
    flag: "wx"
  })
  return lock
}

export function updateHeartbeat(lockPath: string, attemptId: string): void {
  const lock = readJson<RecordingLock>(lockPath)
  if (!lock || lock.attemptId !== attemptId)
    throw new Error("recording lock ownership mismatch")
  atomicWriteJson(lockPath, {
    ...lock,
    heartbeatAt: new Date().toISOString()
  })
}

export function isInside(parent: string, candidate: string): boolean {
  const relative = path.relative(path.resolve(parent), path.resolve(candidate))
  return (
    relative !== "" && !relative.startsWith("..") && !path.isAbsolute(relative)
  )
}
