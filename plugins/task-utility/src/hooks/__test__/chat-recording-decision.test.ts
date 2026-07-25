import fs from "node:fs"
import os from "node:os"
import path from "node:path"
import { expect, test } from "vitest"
import {
  createInitialState,
  decideRecordingAction,
  FALLBACK_THRESHOLD,
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

test("連続失敗が閾値に達したらサブエージェント委譲へ block する", () => {
  const base = {
    ...createInitialState("/p", "/p/t", { dev: 1, ino: 1 }),
    recordedLine: 5,
    // 失敗済み試行では attemptedLine が既に lastUserTurn まで進んでいる。
    // block 判定がこの条件より手前に無いと到達できない。
    attemptedLine: 6
  }
  expect(
    decideRecordingAction(
      scan(6),
      { ...base, consecutiveFailures: FALLBACK_THRESHOLD - 1 },
      false
    ).action
  ).toBe("noop")
  const decision = decideRecordingAction(
    scan(6),
    { ...base, consecutiveFailures: FALLBACK_THRESHOLD },
    false
  )
  expect(decision.action).toBe("block")
  expect(decision.action === "block" && decision.targetLine).toBe(6)
})

test("block より記録済み・実行中ロックの判定が優先される", () => {
  const state = {
    ...createInitialState("/p", "/p/t", { dev: 1, ino: 1 }),
    recordedLine: 6,
    attemptedLine: 6,
    consecutiveFailures: FALLBACK_THRESHOLD + 5
  }
  expect(decideRecordingAction(scan(6), state, false).action).toBe("noop")
  expect(
    decideRecordingAction(scan(7), { ...state, recordedLine: 5 }, true).action
  ).toBe("noop")
})

test("世代交代で連続失敗カウンタを 0 に戻す", () => {
  const state = {
    ...createInitialState("/p", "/p/t", { dev: 1, ino: 1 }),
    recordedLine: 5,
    attemptedLine: 8,
    consecutiveFailures: 3
  }
  const result = reconcileGeneration(state, scan(4, 20))
  expect(result.changed).toBe(true)
  expect(result.state.consecutiveFailures).toBe(0)
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
