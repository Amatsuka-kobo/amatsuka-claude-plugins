import fs from "node:fs"
import os from "node:os"
import path from "node:path"
import { expect, test } from "vitest"
import {
  createInitialState,
  decideRecordingAction,
  hasRunningRecorder,
  isRecorderDispatch,
  isStaleLock,
  LOCK_GRACE_MS,
  LOCK_STALE_MS,
  migrateState,
  type RecordingLock,
  reconcileGeneration,
  type ScanResult,
  STATE_VERSION,
  scanTranscript
} from "../../chat-recording-state.js"

const scan = (lastUserTurn: number, lineCount = 10): ScanResult => ({
  lastUserTurn,
  lineCount,
  lastNag: -1,
  toolHints: [],
  identity: { dev: 1, ino: 1 }
})

const stateAt = (recordedLine: number, attemptedLine: number) => ({
  ...createInitialState("/p", "/p/t", { dev: 1, ino: 1 }),
  recordedLine,
  attemptedLine
})

test.each([
  {
    name: "1 no-user-turn",
    user: -1,
    recorded: 0,
    attempted: 0,
    context: { hasActiveLock: false },
    expected: { action: "noop", reason: "no-user-turn" }
  },
  {
    name: "2 already-recorded",
    user: 5,
    recorded: 5,
    attempted: 5,
    context: { hasActiveLock: true, recorderRunning: true },
    expected: { action: "noop", reason: "already-recorded" }
  },
  {
    name: "3 recorder-running",
    user: 6,
    recorded: 5,
    attempted: 5,
    context: { hasActiveLock: true, recorderRunning: true },
    expected: { action: "noop", reason: "recorder-running" }
  },
  {
    name: "4 active-lock",
    user: 6,
    recorded: 5,
    attempted: 5,
    context: { hasActiveLock: true, recorderRunning: false },
    expected: { action: "noop", reason: "active-lock" }
  },
  {
    name: "5 failed-attempt",
    user: 6,
    recorded: 5,
    attempted: 6,
    context: { hasActiveLock: false },
    error: true,
    expected: { action: "notify", reason: "failed-attempt" }
  },
  {
    name: "6 already-attempted",
    user: 6,
    recorded: 5,
    attempted: 6,
    context: { hasActiveLock: false },
    expected: { action: "noop", reason: "already-attempted" }
  },
  {
    name: "7 dispatch",
    user: 6,
    recorded: 5,
    attempted: 5,
    context: { hasActiveLock: false },
    expected: { action: "dispatch", targetLine: 6, notify: false }
  }
])("判定表の順序を固定する: $name", (fixture) => {
  const state = {
    ...stateAt(fixture.recorded, fixture.attempted),
    lastError: fixture.error
      ? {
          attemptId: "a",
          at: new Date().toISOString(),
          phase: "commit",
          message: "failed",
          logPath: "/log"
        }
      : null
  }
  expect(
    decideRecordingAction(scan(fixture.user), state, fixture.context)
  ).toEqual(fixture.expected)
})

test("dispatch と未通知の失敗通知は同時に成立する", () => {
  const state = {
    ...stateAt(5, 5),
    lastError: {
      attemptId: "old",
      at: new Date().toISOString(),
      phase: "commit",
      message: "failed",
      logPath: "/log"
    }
  }
  expect(
    decideRecordingAction(scan(6), state, { hasActiveLock: false })
  ).toEqual({ action: "dispatch", targetLine: 6, notify: true })
})

// 世代が変わると recordedLine が 0 に戻るため、前世代の記録先を引き継ぐと
// 同じファイルへ会話全体を再記録してしまう。記録先も一緒に手放す。
test("世代交代で記録先を手放し、通常追記では保持する", () => {
  const state = {
    ...createInitialState("/p", "/p/t", { dev: 1, ino: 1 }),
    recordedLine: 5,
    recordPath: "docs/chat/2026/0725/user/topic.md"
  }
  expect(
    reconcileGeneration(state, scan(4, 20)).state.recordPath
  ).toBeUndefined()
  expect(reconcileGeneration(state, scan(6, 20)).state.recordPath).toBe(
    "docs/chat/2026/0725/user/topic.md"
  )
})

test("tool_use ヒントは recordedLine より後だけから最大20件を集める", () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "chat-scan-"))
  const transcript = path.join(root, "transcript.jsonl")
  const tool = (description: string) =>
    JSON.stringify({
      type: "assistant",
      message: {
        content: [{ type: "tool_use", name: "Bash", input: { description } }]
      }
    })
  try {
    fs.writeFileSync(
      transcript,
      [
        ...Array.from({ length: 20 }, (_, index) => tool(`recorded-${index}`)),
        tool("new-result")
      ].join("\n")
    )
    expect(scanTranscript(transcript, 20).toolHints).toEqual([
      "Bash — new-result"
    ])
  } finally {
    fs.rmSync(root, { recursive: true, force: true })
  }
})

test("chat-recorder 自身の dispatch は tool_use ヒントから除外する", () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "chat-scan-agent-"))
  const transcript = path.join(root, "transcript.jsonl")
  try {
    fs.writeFileSync(
      transcript,
      JSON.stringify({
        type: "assistant",
        message: {
          content: [
            {
              type: "tool_use",
              name: "Agent",
              input: {
                subagent_type: "task-utility:chat-recorder",
                description: "record chat"
              }
            },
            {
              type: "tool_use",
              name: "Agent",
              input: { subagent_type: "gpt-sol", description: "implement" }
            }
          ]
        }
      })
    )
    expect(scanTranscript(transcript).toolHints).toEqual([
      "Agent — gpt-sol — implement"
    ])
    expect(isRecorderDispatch("Agent", "Task-Utility:Chat-Recorder")).toBe(true)
  } finally {
    fs.rmSync(root, { recursive: true, force: true })
  }
})

test.each([
  { lineCount: 4, user: 8 },
  { lineCount: 20, user: 4 }
])("行数またはlastUserTurn減少で世代を切り替える %#", ({ lineCount, user }) => {
  const state = {
    ...createInitialState("/p", "/p/t", { dev: 1, ino: 1 }),
    recordedLine: 5,
    attemptedLine: 8
  }
  const result = reconcileGeneration(state, scan(user, lineCount))
  expect(result.changed).toBe(true)
  expect(result.state.recordedLine).toBe(0)
})

test("行数非減少・lastUserTurn非減少は通常追記", () => {
  const state = {
    ...createInitialState("/p", "/p/t", { dev: 1, ino: 1 }),
    recordedLine: 5
  }
  expect(reconcileGeneration(state, scan(6, 10)).changed).toBe(false)
})

test("recorderRunning の3値に応じて stale 上限を切り替える", () => {
  const now = Date.now()
  const state = {
    ...createInitialState("/p", "/p/t", { dev: 1, ino: 1 }),
    attemptId: "a"
  }
  const lock: RecordingLock = {
    version: STATE_VERSION,
    attemptId: "a",
    targetLine: 1,
    createdAt: new Date(now - LOCK_STALE_MS * 2).toISOString(),
    heartbeatAt: new Date(now - LOCK_STALE_MS * 2).toISOString()
  }
  expect(isStaleLock(lock, state, { now, recorderRunning: true })).toBe(false)
  expect(
    isStaleLock(
      {
        ...lock,
        heartbeatAt: new Date(now - LOCK_GRACE_MS - 1).toISOString()
      },
      state,
      { now, recorderRunning: false }
    )
  ).toBe(true)
  expect(
    isStaleLock(
      {
        ...lock,
        heartbeatAt: new Date(now - LOCK_STALE_MS - 1).toISOString()
      },
      state,
      { now }
    )
  ).toBe(true)
  expect(
    isStaleLock({ ...lock, version: 1 } as unknown as RecordingLock, state, {
      now,
      recorderRunning: true
    })
  ).toBe(true)
})

test("background_tasks の不在と空配列を区別する", () => {
  expect(hasRunningRecorder(undefined)).toBeUndefined()
  expect(hasRunningRecorder([])).toBe(false)
})

test.each([
  "chat-recorder",
  "task-utility:chat-recorder",
  "Task-Utility:Chat-Recorder"
])("agent_type の表記ゆれを recorder と認識する: %s", (agentType) => {
  expect(
    hasRunningRecorder([
      { type: "subagent", status: "running", agent_type: agentType }
    ])
  ).toBe(true)
})

test("非 subagent と終了済み status は無視し、未知 status は実行中に倒す", () => {
  expect(
    hasRunningRecorder([
      { type: "process", status: "running", agent_type: "chat-recorder" },
      { type: "subagent", status: "completed", agent_type: "chat-recorder" }
    ])
  ).toBe(false)
  expect(
    hasRunningRecorder([
      { type: "subagent", status: "future-status", agent_type: "chat-recorder" }
    ])
  ).toBe(true)
})

test("v1 state は記録済み位置だけを安全に引き継ぐ", () => {
  const fallback = createInitialState("/new", "/new/t", { dev: 2, ino: 2 })
  const migrated = migrateState(
    {
      version: 1,
      projectDir: "/old",
      sessionId: "session",
      transcriptPath: "/old/t",
      transcriptIdentity: { dev: 1, ino: 1 },
      recordedLine: 42,
      attemptedLine: 99,
      recordPath: "docs/chat/record.md",
      lastSuccessAt: "2026-07-31T00:00:00.000Z",
      attemptId: "old-attempt",
      previousGeneration: { recordedLine: 1 },
      consecutiveFailures: 3,
      lastError: { attemptId: "old-attempt" }
    },
    fallback
  )
  expect(migrated).toMatchObject({
    version: STATE_VERSION,
    projectDir: "/old",
    sessionId: "session",
    transcriptPath: "/old/t",
    transcriptIdentity: { dev: 1, ino: 1 },
    recordedLine: 42,
    attemptedLine: 42,
    recordPath: "docs/chat/record.md",
    lastSuccessAt: "2026-07-31T00:00:00.000Z",
    lastError: null,
    lastNotifiedAttemptId: null
  })
  expect(migrated).not.toHaveProperty("attemptId")
  expect(migrated).not.toHaveProperty("consecutiveFailures")
  expect(migrated).not.toHaveProperty("previousGeneration")
})

test("壊れた state は fallback を返す", () => {
  const fallback = createInitialState("/p", "/p/t", { dev: 1, ino: 1 })
  expect(migrateState("broken", fallback)).toBe(fallback)
})
