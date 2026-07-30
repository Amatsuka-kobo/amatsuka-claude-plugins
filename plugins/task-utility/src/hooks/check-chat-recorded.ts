#!/usr/bin/env node
import fs from "node:fs"
import path from "node:path"
import { fileURLToPath } from "node:url"
import {
  acquireLock,
  appendLog,
  atomicWriteJson,
  type BackgroundTaskInput,
  createInitialState,
  decideRecordingAction,
  ensureStateDirs,
  getSessionKey,
  getStatePaths,
  hasRunningRecorder,
  isStaleLock,
  migrateState,
  NAG_MARKER,
  type RecordingLock,
  type RecordingState,
  readJson,
  reconcileGeneration,
  scanTranscript
} from "../chat-recording-state.js"

interface HookInput {
  stop_hook_active?: boolean
  cwd?: string
  transcript_path?: string
  session_id?: string
  background_tasks?: BackgroundTaskInput[]
}

interface AttemptPlan {
  version: 1
  attemptId: string
  targetLine: number
  metadataHints: string[]
}

export const MAX_INJECT_CHARS = 1200

export interface InjectionValues {
  projectDir: string
  transcriptPath: string
  sessionKey: string
  attemptId: string
  targetLine: number
  pluginRoot: string
}

function readInput(): HookInput | null {
  try {
    return JSON.parse(fs.readFileSync(0, "utf8")) as HookInput
  } catch {
    return null
  }
}

export function renderInjection(
  values: InjectionValues,
  maxChars: number = MAX_INJECT_CHARS
): string {
  const required = [
    NAG_MARKER,
    "[task-utility] この会話には docs/chat/ に未記録のターンがある。",
    `- projectDir: ${values.projectDir}`,
    `- transcriptPath: ${values.transcriptPath}`,
    `- sessionKey: ${values.sessionKey}`,
    `- attemptId: ${values.attemptId}`,
    `- targetLine: ${values.targetLine}`,
    `- pluginRoot: ${values.pluginRoot}`
  ]
  const supplemental = [
    'このプロジェクトの記録運用では、メインエージェントはこの通知を受け取った時点で、上記の値をそのまま渡して Agent ツールの subagent_type "task-utility:chat-recorder" を run_in_background: true で起動し、その完了を待たずに現在のターンを終える。記録の手順とフォーマット契約は chat-recorder 側の定義に含まれており、メイン側で会話本文を読んだり docs/chat/ を編集したりすることは手順に含まれない。',
    "記録の結果は docs/chat/ 配下のファイルと INDEX.md にのみ反映され、ユーザーへの応答文には現れない。記録に関する言及・完了報告は応答の構成要素ではない。",
    "attemptId が現在の記録試行と一致しない通知(過去のセッションの再生を含む)は既に失効しており、対象ではない。"
  ]
  const lines = [...required, ...supplemental]
  while (lines.length > required.length && lines.join("\n").length > maxChars)
    lines.pop()
  return lines.join("\n").slice(0, maxChars)
}

function notificationMessage(state: RecordingState): string | undefined {
  if (!state.lastError) return undefined
  return `chat-recorder の前回実行に失敗しました。ログ: ${state.lastError.logPath} (${state.lastError.message})`
}

function outputNotification(state: RecordingState): boolean {
  const systemMessage = notificationMessage(state)
  if (!systemMessage) return false
  console.log(JSON.stringify({ systemMessage }))
  return true
}

async function main(): Promise<void> {
  const input = readInput()
  if (!input || input.stop_hook_active) return
  const projectDir = path.resolve(
    process.env.CLAUDE_PROJECT_DIR || input.cwd || process.cwd()
  )
  if (!fs.existsSync(path.join(projectDir, "docs", "chat"))) return
  const transcriptPath = input.transcript_path
  if (!transcriptPath || !fs.existsSync(transcriptPath)) return

  const sessionKey = getSessionKey(input.session_id, transcriptPath)
  const paths = getStatePaths(projectDir, sessionKey)
  try {
    ensureStateDirs(paths)
  } catch (error) {
    // ここを握りつぶすと記録も通知もされず完全に無音で終わる。
    // 一時領域が使えない場合はサブエージェントへ委譲しても同じ理由で失敗するため、
    // dispatch ではなく通知だけを出す。
    console.log(
      JSON.stringify({
        systemMessage: `chat-recorder の作業ディレクトリを準備できませんでした: ${
          error instanceof Error ? error.message : String(error)
        }`
      })
    )
    return
  }

  const fullScan = scanTranscript(transcriptPath)
  if (fullScan.lastNag > fullScan.lastUserTurn) return
  const fallback = createInitialState(
    projectDir,
    transcriptPath,
    fullScan.identity,
    input.session_id
  )
  let state = migrateState(readJson<unknown>(paths.statePath), fallback)
  const generation = reconcileGeneration(state, fullScan)
  state = generation.state
  const scan = scanTranscript(transcriptPath, state.recordedLine)
  atomicWriteJson(paths.statePath, state)

  const recorderRunning = hasRunningRecorder(input.background_tasks)
  let activeLock = false
  if (fs.existsSync(paths.lockPath)) {
    const lock = readJson<RecordingLock>(paths.lockPath)
    if (isStaleLock(lock, state, { recorderRunning })) {
      appendLog(
        paths.logPath,
        `[hook] recovered stale lock: ${fs.readFileSync(paths.lockPath, "utf8").trim()}`
      )
      fs.rmSync(paths.lockPath, { force: true })
      state = {
        ...state,
        lastError: {
          attemptId: lock?.attemptId ?? state.attemptId ?? "unknown",
          at: new Date().toISOString(),
          phase: "stale-lock",
          message: "background recorder did not complete",
          logPath: paths.logPath
        }
      }
      atomicWriteJson(paths.statePath, state)
    } else activeLock = true
  }

  const decision = decideRecordingAction(scan, state, {
    hasActiveLock: activeLock,
    recorderRunning
  })
  if (decision.action === "noop") return
  if (decision.action === "notify") {
    if (outputNotification(state))
      atomicWriteJson(paths.statePath, {
        ...state,
        lastNotifiedAttemptId: state.lastError?.attemptId ?? null
      } satisfies RecordingState)
    return
  }

  let lock: RecordingLock
  try {
    lock = acquireLock(paths.lockPath, decision.targetLine)
  } catch {
    return
  }
  const planPath = path.join(paths.planDir, `${sessionKey}.json`)
  atomicWriteJson(planPath, {
    version: 1,
    attemptId: lock.attemptId,
    targetLine: decision.targetLine,
    metadataHints: scan.toolHints
  } satisfies AttemptPlan)

  const stagedState: RecordingState = {
    ...state,
    attemptId: lock.attemptId,
    attemptStartedAt: lock.createdAt,
    attemptedLine: decision.targetLine,
    lastNotifiedAttemptId:
      decision.notify && state.lastError
        ? state.lastError.attemptId
        : state.lastNotifiedAttemptId
  }
  atomicWriteJson(paths.statePath, stagedState)

  const pluginRoot =
    process.env.CLAUDE_PLUGIN_ROOT ||
    path.resolve(
      import.meta.dirname,
      path.basename(import.meta.dirname) === "scripts" ? ".." : "../.."
    )
  const additionalContext = renderInjection({
    projectDir,
    transcriptPath,
    sessionKey,
    attemptId: lock.attemptId,
    targetLine: decision.targetLine,
    pluginRoot
  })
  const output: Record<string, unknown> = {
    hookSpecificOutput: {
      hookEventName: "Stop",
      additionalContext
    }
  }
  if (decision.notify) output.systemMessage = notificationMessage(state)
  console.log(JSON.stringify(output))
}

try {
  if (
    process.argv[1] &&
    fs.realpathSync(process.argv[1]) ===
      fs.realpathSync(fileURLToPath(import.meta.url))
  )
    await main()
} catch {
  process.exitCode = 0
}
