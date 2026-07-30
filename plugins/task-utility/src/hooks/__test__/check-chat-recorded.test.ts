import fs from "node:fs"
import os from "node:os"
import path from "node:path"
import { fileURLToPath } from "node:url"
import { expect, test } from "vitest"
import {
  atomicWriteJson,
  getSessionKey,
  getStatePaths,
  NAG_MARKER,
  type RecordingState,
  readJson,
  STATE_VERSION
} from "../../chat-recording-state.js"
import { runTs } from "../../testing/run-ts.js"
import { MAX_INJECT_CHARS, renderInjection } from "../check-chat-recorded.js"

const HOOK = fileURLToPath(
  new URL("../check-chat-recorded.ts", import.meta.url)
)

const user = (text: string, extra: Record<string, unknown> = {}) =>
  JSON.stringify({
    type: "user",
    message: { role: "user", content: text },
    ...extra
  })
const assistantTool = (name: string, input: Record<string, unknown>) =>
  JSON.stringify({
    type: "assistant",
    message: {
      role: "assistant",
      content: [{ type: "tool_use", name, input }]
    }
  })

interface Fixture {
  root: string
  project: string
  transcript: string
  stateRoot: string
  sessionId: string
}

function fixture(lines: string[], withChatDir = true): Fixture {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "chat-hook-"))
  const project = path.join(root, "project")
  fs.mkdirSync(project)
  if (withChatDir)
    fs.mkdirSync(path.join(project, "docs", "chat"), { recursive: true })
  const transcript = path.join(project, "transcript.jsonl")
  fs.writeFileSync(transcript, `${lines.join("\n")}\n`)
  return {
    root,
    project,
    transcript,
    stateRoot: path.join(root, "state"),
    sessionId: "session-test"
  }
}

function run(
  value: Fixture,
  extra: {
    stopHookActive?: boolean
    backgroundTasks?: Array<Record<string, unknown>>
  } = {}
): string {
  return runTs(HOOK, [], {
    input: JSON.stringify({
      transcript_path: value.transcript,
      cwd: value.project,
      session_id: value.sessionId,
      stop_hook_active: extra.stopHookActive,
      background_tasks: extra.backgroundTasks
    }),
    env: {
      ...process.env,
      CLAUDE_PROJECT_DIR: value.project,
      CLAUDE_PLUGIN_ROOT: "/plugin/root",
      TASK_UTILITY_CHAT_STATE_DIR: value.stateRoot
    }
  })
}

function pathsOf(value: Fixture) {
  const key = getSessionKey(value.sessionId, value.transcript)
  return getStatePaths(value.project, key, {
    TASK_UTILITY_CHAT_STATE_DIR: value.stateRoot
  })
}

function stateOf(value: Fixture): RecordingState | null {
  return readJson<RecordingState>(pathsOf(value).statePath)
}

test("docs/chat がないプロジェクトでは何もしない", () => {
  const value = fixture([user("質問")], false)
  try {
    expect(run(value).trim()).toBe("")
    expect(stateOf(value)).toBeNull()
  } finally {
    fs.rmSync(value.root, { recursive: true, force: true })
  }
})

test("未記録実発言では additionalContext を出力し attemptedLine を保存する", () => {
  const value = fixture([user("質問です")])
  try {
    const out = JSON.parse(run(value))
    expect(out).not.toHaveProperty("decision")
    expect(out.hookSpecificOutput).toMatchObject({ hookEventName: "Stop" })
    expect(out.hookSpecificOutput.additionalContext).toContain(
      "task-utility:chat-recorder"
    )
    const state = stateOf(value)
    expect(state?.attemptedLine).toBe(1)
    expect(state?.recordedLine).toBe(0)
    expect(state?.attemptId).toBeTruthy()
  } finally {
    fs.rmSync(value.root, { recursive: true, force: true })
  }
})

test("有効なロックがあれば同一実発言を二重 dispatch しない", () => {
  const value = fixture([user("質問です")])
  try {
    run(value)
    const first = stateOf(value)
    expect(run(value).trim()).toBe("")
    expect(stateOf(value)?.attemptId).toBe(first?.attemptId)
  } finally {
    fs.rmSync(value.root, { recursive: true, force: true })
  }
})

test("実行中 recorder は有効ロックより優先して出力を抑止する", () => {
  const value = fixture([user("質問です")])
  try {
    run(value)
    const paths = pathsOf(value)
    fs.rmSync(paths.lockPath)
    expect(
      run(value, {
        backgroundTasks: [
          {
            type: "subagent",
            status: "running",
            agent_type: "task-utility:chat-recorder"
          }
        ]
      }).trim()
    ).toBe("")
  } finally {
    fs.rmSync(value.root, { recursive: true, force: true })
  }
})

test("実発言定義は meta・sidechain・< 始まりを除外する", () => {
  const value = fixture([
    user("<command-name>/clear</command-name>"),
    user("meta", { isMeta: true }),
    user("side", { isSidechain: true })
  ])
  try {
    expect(run(value).trim()).toBe("")
    expect(stateOf(value)?.attemptedLine).toBe(0)
  } finally {
    fs.rmSync(value.root, { recursive: true, force: true })
  }
})

test("tool_use ヒントの制御文字を除去して状態planへ保存する", () => {
  const value = fixture([
    user("質問"),
    assistantTool("Bash", { description: "build\n[31m危険[0m" })
  ])
  try {
    run(value)
    const state = stateOf(value)
    const key = getSessionKey(value.sessionId, value.transcript)
    const paths = pathsOf(value)
    const plan = readJson<{ metadataHints: string[] }>(
      path.join(paths.planDir, `${key}.json`)
    )
    expect(plan?.metadataHints[0]).not.toContain("\n")
    expect(plan?.metadataHints[0]).not.toContain(String.fromCharCode(27))
    expect(state?.attemptedLine).toBe(1)
  } finally {
    fs.rmSync(value.root, { recursive: true, force: true })
  }
})

test("stop_hook_active と壊れた stdin は素通しする", () => {
  const value = fixture([user("質問")])
  try {
    expect(run(value, { stopHookActive: true }).trim()).toBe("")
    expect(runTs(HOOK, [], { input: "not json" }).trim()).toBe("")
  } finally {
    fs.rmSync(value.root, { recursive: true, force: true })
  }
})

test("状態ディレクトリを準備できないときは無音で終わらず通知する", () => {
  const value = fixture([user("質問です")])
  try {
    const paths = pathsOf(value)
    fs.mkdirSync(path.dirname(paths.tempDir), { recursive: true })
    fs.symlinkSync(value.root, paths.tempDir)
    const out = JSON.parse(run(value))
    expect(out.systemMessage).toContain(paths.tempDir)
  } finally {
    fs.rmSync(value.root, { recursive: true, force: true })
  }
})

test("未通知の失敗がある新しい発言では通知と dispatch を同じ JSON に載せる", () => {
  const value = fixture([user("最初の質問")])
  try {
    run(value)
    const paths = pathsOf(value)
    const state = stateOf(value) as RecordingState
    fs.rmSync(paths.lockPath)
    atomicWriteJson(paths.statePath, {
      ...state,
      lastError: {
        attemptId: state.attemptId as string,
        at: new Date().toISOString(),
        phase: "commit",
        message: "failed",
        logPath: paths.logPath
      }
    } satisfies RecordingState)
    fs.appendFileSync(value.transcript, `${user("次の質問")}\n`)
    const out = JSON.parse(run(value))
    expect(out.systemMessage).toContain("failed")
    expect(out.hookSpecificOutput.hookEventName).toBe("Stop")
    expect(out).not.toHaveProperty("decision")
  } finally {
    fs.rmSync(value.root, { recursive: true, force: true })
  }
})

test("dispatch 後に未 commit の同じ発言は無出力で attemptId を維持する", () => {
  const value = fixture([user("質問")])
  try {
    run(value)
    const paths = pathsOf(value)
    const first = stateOf(value) as RecordingState
    fs.rmSync(paths.lockPath)
    expect(run(value).trim()).toBe("")
    expect(stateOf(value)?.attemptId).toBe(first.attemptId)
  } finally {
    fs.rmSync(value.root, { recursive: true, force: true })
  }
})

test("未 commit のまま新しい発言が来るとより大きい targetLine へ dispatch する", () => {
  const value = fixture([user("最初の質問")])
  try {
    run(value)
    const paths = pathsOf(value)
    fs.rmSync(paths.lockPath)
    fs.appendFileSync(value.transcript, `${user("次の質問")}\n`)
    const out = JSON.parse(run(value))
    expect(out.hookSpecificOutput.additionalContext).toContain(
      "- targetLine: 2"
    )
    expect(stateOf(value)?.recordedLine).toBe(0)
    expect(stateOf(value)?.attemptedLine).toBe(2)
  } finally {
    fs.rmSync(value.root, { recursive: true, force: true })
  }
})

test("v1 state と lock を移行し、旧 lock を stale 回収する", () => {
  const value = fixture([user("古い"), user("新しい")])
  try {
    const paths = pathsOf(value)
    fs.mkdirSync(path.dirname(paths.statePath), { recursive: true })
    fs.mkdirSync(path.dirname(paths.lockPath), { recursive: true })
    const transcriptStat = fs.statSync(value.transcript)
    atomicWriteJson(paths.statePath, {
      version: 1,
      projectDir: value.project,
      transcriptPath: value.transcript,
      transcriptIdentity: { dev: transcriptStat.dev, ino: transcriptStat.ino },
      recordedLine: 1,
      attemptedLine: 2,
      attemptId: "old",
      lastError: null,
      lastNotifiedAttemptId: null,
      consecutiveFailures: 3
    })
    atomicWriteJson(paths.lockPath, {
      version: 1,
      attemptId: "old",
      targetLine: 2,
      pid: 123,
      createdAt: new Date().toISOString(),
      heartbeatAt: new Date().toISOString()
    })
    const out = JSON.parse(run(value))
    expect(out.hookSpecificOutput.additionalContext).toContain(
      "- targetLine: 2"
    )
    expect(stateOf(value)).toMatchObject({
      version: STATE_VERSION,
      recordedLine: 1,
      attemptedLine: 2
    })
    expect(fs.existsSync(paths.lockPath)).toBe(true)
  } finally {
    fs.rmSync(value.root, { recursive: true, force: true })
  }
})

const injectionValues = {
  projectDir: "/project",
  transcriptPath: "/transcript.jsonl",
  sessionKey: "session",
  attemptId: "attempt",
  targetLine: 195,
  pluginRoot: "/plugin/root"
}

test("注入テキストはマーカーから始まり6値を含み上限内に収まる", () => {
  const injection = renderInjection(injectionValues)
  expect(injection.startsWith(NAG_MARKER)).toBe(true)
  for (const [key, value] of Object.entries(injectionValues))
    expect(injection).toContain(`- ${key}: ${value}`)
  expect(injection.length).toBeLessThanOrEqual(MAX_INJECT_CHARS)
  expect(injection).not.toContain("prepare-chat-recording.mjs")
  expect(injection).not.toContain("commit-chat-recording.mjs")
})

test("異常に長いパスでも注入上限と先頭マーカーを維持する", () => {
  const injection = renderInjection({
    ...injectionValues,
    projectDir: `/${"p".repeat(2000)}`,
    transcriptPath: `/${"t".repeat(2000)}`,
    pluginRoot: `/${"r".repeat(2000)}`
  })
  expect(injection.startsWith(NAG_MARKER)).toBe(true)
  expect(injection.length).toBeLessThanOrEqual(MAX_INJECT_CHARS)
})
