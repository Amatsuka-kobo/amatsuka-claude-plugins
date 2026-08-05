import { createHash, randomUUID } from "node:crypto"
import fs from "node:fs"
import os from "node:os"
import path from "node:path"

export const NAG_MARKER = "<!--chat-recorder-nag-->"
export const STATE_VERSION = 2
export const MAX_TOOL_HINTS = 20
export const MAX_TOOL_HINT_LENGTH = 120
export const LOCK_GRACE_MS = 120_000
export const LOCK_STALE_MS = 600_000
export const RECORDER_AGENT_NAME = "chat-recorder"

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
  version: typeof STATE_VERSION
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
  version: typeof STATE_VERSION
  attemptId: string
  targetLine: number
  createdAt: string
  heartbeatAt: string
}

export interface BackgroundTaskInput {
  id?: string
  type?: string
  status?: string
  description?: string
  agent_type?: string
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
  | { action: "dispatch"; targetLine: number; notify: boolean }

export interface DecisionContext {
  hasActiveLock: boolean
  /** background_tasks から判定。undefined = 判定不能(古い Claude Code) */
  recorderRunning?: boolean
}

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

// chat-recorder の Write は Claude 設定ディレクトリ配下を sensitive file として
// 拒否されるため、一時ファイルだけは必ずその外側へ退避させる。
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

export function isRecorderDispatch(
  name: unknown,
  subagentType: unknown
): boolean {
  if (name !== "Agent") return false
  const normalized = String(subagentType).split(":").at(-1)?.toLowerCase()
  return normalized === RECORDER_AGENT_NAME
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
      if (
        content.type !== "tool_use" ||
        isRecorderDispatch(content.name, content.input?.subagent_type)
      )
        continue
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

const isObject = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value)

const isString = (value: unknown): value is string => typeof value === "string"

const isNonNegativeInteger = (value: unknown): value is number =>
  Number.isSafeInteger(value) && Number(value) >= 0

function validIdentity(value: unknown): TranscriptIdentity | null {
  if (!isObject(value)) return null
  const dev = value.dev
  const ino = value.ino
  if (
    (dev !== undefined && !Number.isSafeInteger(dev)) ||
    (ino !== undefined && !Number.isSafeInteger(ino))
  )
    return null
  return {
    dev: dev === undefined ? undefined : Number(dev),
    ino: ino === undefined ? undefined : Number(ino)
  }
}

export function migrateState(
  raw: unknown,
  fallback: RecordingState
): RecordingState {
  if (!isObject(raw)) return fallback
  if (raw.version === STATE_VERSION) return raw as unknown as RecordingState

  const identity = validIdentity(raw.transcriptIdentity)
  const recordedLine = isNonNegativeInteger(raw.recordedLine)
    ? raw.recordedLine
    : fallback.recordedLine
  return {
    ...fallback,
    version: STATE_VERSION,
    projectDir: isString(raw.projectDir) ? raw.projectDir : fallback.projectDir,
    sessionId: isString(raw.sessionId) ? raw.sessionId : fallback.sessionId,
    transcriptPath: isString(raw.transcriptPath)
      ? raw.transcriptPath
      : fallback.transcriptPath,
    transcriptIdentity: identity ?? fallback.transcriptIdentity,
    recordedLine,
    attemptedLine: recordedLine,
    lastSuccessAt: isString(raw.lastSuccessAt)
      ? raw.lastSuccessAt
      : fallback.lastSuccessAt,
    recordPath: isString(raw.recordPath) ? raw.recordPath : fallback.recordPath,
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
      attemptStartedAt: undefined,
      // recordedLine が 0 に戻るため、前世代の記録先を引き継ぐと同じファイルへ
      // 会話全体を再記録してしまう。記録先も一緒に手放す。
      recordPath: undefined
    }
  }
}

const FINISHED_TASK_STATUSES = new Set([
  "completed",
  "failed",
  "cancelled",
  "canceled",
  "stopped",
  "error",
  "done"
])

export function hasRunningRecorder(
  tasks: BackgroundTaskInput[] | undefined
): boolean | undefined {
  if (!Array.isArray(tasks)) return undefined
  return tasks.some((task) => {
    if (typeof task !== "object" || task === null) return false
    if (task.type !== "subagent") return false
    const agentName = String(task.agent_type).split(":").at(-1)?.toLowerCase()
    if (agentName !== RECORDER_AGENT_NAME) return false
    return !FINISHED_TASK_STATUSES.has(String(task.status).toLowerCase())
  })
}

export function isStaleLock(
  lock: RecordingLock | null,
  state: RecordingState,
  options: { now?: number; recorderRunning?: boolean } = {}
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
  if (options.recorderRunning === true) return false
  const maxAge =
    options.recorderRunning === false ? LOCK_GRACE_MS : LOCK_STALE_MS
  return (options.now ?? Date.now()) - heartbeat > maxAge
}

export function decideRecordingAction(
  scan: ScanResult,
  state: RecordingState,
  context: DecisionContext
): RecordingDecision {
  if (scan.lastUserTurn === -1)
    return { action: "noop", reason: "no-user-turn" }
  if (scan.lastUserTurn <= state.recordedLine)
    return { action: "noop", reason: "already-recorded" }
  if (context.recorderRunning === true)
    return { action: "noop", reason: "recorder-running" }
  if (context.hasActiveLock) return { action: "noop", reason: "active-lock" }
  if (state.attemptedLine >= scan.lastUserTurn)
    return state.lastError &&
      state.lastNotifiedAttemptId !== state.lastError.attemptId
      ? { action: "notify", reason: "failed-attempt" }
      : { action: "noop", reason: "already-attempted" }
  return {
    action: "dispatch",
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
