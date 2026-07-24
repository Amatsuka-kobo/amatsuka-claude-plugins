import fs from "node:fs"
import os from "node:os"
import path from "node:path"
import { expect, test } from "vitest"
import {
  createInitialState,
  decideRecordingAction,
  isStaleLock,
  type RecordingLock,
  reconcileGeneration,
  type ScanResult,
  scanTranscript
} from "../../chat-recording-state.js"

const scan = (lastUserTurn: number, lineCount = 10): ScanResult => ({
  lastUserTurn,
  lineCount,
  lastNag: -1,
  toolHints: [],
  identity: { dev: 1, ino: 1 }
})

test.each([
  { user: -1, recorded: 0, attempted: 0, lock: false, action: "noop" },
  { user: 5, recorded: 5, attempted: 5, lock: false, action: "noop" },
  { user: 6, recorded: 5, attempted: 5, lock: true, action: "noop" },
  { user: 6, recorded: 5, attempted: 6, lock: false, action: "noop" },
  { user: 6, recorded: 5, attempted: 5, lock: false, action: "spawn" }
])("spawn 判定表 %#", ({ user, recorded, attempted, lock, action }) => {
  const state = {
    ...createInitialState("/p", "/p/t", { dev: 1, ino: 1 }),
    recordedLine: recorded,
    attemptedLine: attempted
  }
  expect(decideRecordingAction(scan(user), state, lock).action).toBe(action)
})

test("失敗済みの同一発言は notify になり再試行しない", () => {
  const state = {
    ...createInitialState("/p", "/p/t", { dev: 1, ino: 1 }),
    attemptedLine: 6,
    lastError: {
      attemptId: "a",
      at: new Date().toISOString(),
      phase: "commit",
      message: "failed",
      logPath: "/log"
    }
  }
  expect(decideRecordingAction(scan(6), state, false).action).toBe("notify")
  expect(
    decideRecordingAction(
      scan(6),
      { ...state, lastNotifiedAttemptId: "a" },
      false
    ).action
  ).toBe("noop")
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

test("PID不在またはheartbeat超過のロックは stale", () => {
  const now = Date.now()
  const state = {
    ...createInitialState("/p", "/p/t", { dev: 1, ino: 1 }),
    attemptId: "a"
  }
  const lock: RecordingLock = {
    version: 1,
    attemptId: "a",
    targetLine: 1,
    pid: 123,
    createdAt: new Date(now - 1000).toISOString(),
    heartbeatAt: new Date(now - 31 * 60_000).toISOString()
  }
  expect(isStaleLock(lock, state, now, () => true)).toBe(true)
  expect(
    isStaleLock(
      { ...lock, heartbeatAt: new Date(now).toISOString() },
      state,
      now,
      () => false
    )
  ).toBe(true)
  expect(
    isStaleLock(
      {
        ...lock,
        pid: null,
        createdAt: new Date(now - 60_000).toISOString(),
        heartbeatAt: new Date(now).toISOString()
      },
      state,
      now
    )
  ).toBe(false)
  expect(
    isStaleLock(
      {
        ...lock,
        pid: null,
        createdAt: new Date(now - 60_000).toISOString(),
        heartbeatAt: new Date(now - 31_000).toISOString()
      },
      state,
      now
    )
  ).toBe(true)
})
