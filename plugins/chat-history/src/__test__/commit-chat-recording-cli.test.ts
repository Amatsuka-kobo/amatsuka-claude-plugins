import fs from "node:fs"
import os from "node:os"
import path from "node:path"
import { fileURLToPath } from "node:url"
import { afterEach, expect, test } from "vitest"
import { runTs } from "../../src/testing/run-ts.js"
import {
  atomicWriteJson,
  createInitialState,
  ensureStateDirs,
  getStatePaths,
  type RecordingLock
} from "../chat-recording-state.js"

const SCRIPT = fileURLToPath(
  new URL("../commit-chat-recording.ts", import.meta.url)
)

const roots: string[] = []
const previousStateRoot = process.env.TASK_UTILITY_CHAT_STATE_DIR

afterEach(() => {
  for (const root of roots.splice(0))
    fs.rmSync(root, { recursive: true, force: true })
  if (previousStateRoot === undefined)
    delete process.env.TASK_UTILITY_CHAT_STATE_DIR
  else process.env.TASK_UTILITY_CHAT_STATE_DIR = previousStateRoot
})

test("CLI は --record-slug と --index-summary-file で新規記録を作る", () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "commit-cli-"))
  roots.push(root)
  const project = path.join(root, "project")
  fs.mkdirSync(path.join(project, "docs", "chat"), { recursive: true })
  const stateRoot = path.join(root, "state")
  process.env.TASK_UTILITY_CHAT_STATE_DIR = stateRoot
  const sessionKey = "session"
  const attemptId = "attempt"
  const transcript = path.join(project, "transcript.jsonl")
  fs.writeFileSync(transcript, "{}\n")
  const paths = getStatePaths(project, sessionKey)
  ensureStateDirs(paths)
  atomicWriteJson(paths.statePath, {
    ...createInitialState(project, transcript, { dev: 1, ino: 1 }),
    attemptId,
    attemptedLine: 2
  })
  atomicWriteJson(paths.lockPath, {
    version: 2,
    attemptId,
    targetLine: 2,
    createdAt: new Date().toISOString(),
    heartbeatAt: new Date().toISOString()
  } satisfies RecordingLock)
  atomicWriteJson(path.join(paths.planDir, `${sessionKey}.json`), {
    version: 2,
    attemptId,
    targetLine: 2,
    recordTarget: { relativePath: null, appendMode: false },
    allowedNewRecordDir: "docs/chat/2026/0724/unknown",
    recordFilePrefix: "0712",
    recordDate: "2026-07-24",
    workerName: "unknown",
    sessionId: "cfa925f8-d36b-4dad-8b79-47bdddf1a653",
    sessionNumber: 1
  })
  const bodyFile = path.join(paths.tempDir, "body.md")
  const indexSummaryFile = path.join(paths.tempDir, "index-summary.md")
  const sessionTitleFile = path.join(paths.tempDir, "session-title.md")
  const headerFile = path.join(paths.tempDir, "header.md")
  fs.writeFileSync(bodyFile, "# unknown\n\n> 質問\n\n# AI\n\n回答\n")
  fs.writeFileSync(indexSummaryFile, "会話の要旨\n")
  fs.writeFileSync(sessionTitleFile, "話題の要旨\n")
  fs.writeFileSync(headerFile, "# New\n\n- 日付: 2026-07-24\n")

  const out = JSON.parse(
    runTs(SCRIPT, [
      "--project",
      project,
      "--session-key",
      sessionKey,
      "--attempt-id",
      attemptId,
      "--target-line",
      "2",
      "--body-file",
      bodyFile,
      "--index-summary-file",
      indexSummaryFile,
      "--session-title-file",
      sessionTitleFile,
      "--header-file",
      headerFile,
      "--record-slug",
      "topic"
    ])
  )
  expect(out.ok).toBe(true)
  expect(out.recordPath).toBe("docs/chat/2026/0724/unknown/0712-topic.md")
  expect(
    fs.existsSync(
      path.join(project, "docs/chat/2026/0724/unknown/0712-topic.md")
    )
  ).toBe(true)
})
