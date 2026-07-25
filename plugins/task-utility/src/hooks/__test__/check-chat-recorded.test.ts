import fs from "node:fs"
import os from "node:os"
import path from "node:path"
import { fileURLToPath } from "node:url"
import { expect, test } from "vitest"
import {
  getSessionKey,
  getStatePaths,
  type RecordingState,
  readJson
} from "../../chat-recording-state.js"
import { runTs } from "../../testing/run-ts.js"
import { buildClaudeArgs, buildRecorderPrompt } from "../check-chat-recorded.js"

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
  command: string
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
  const command = path.join(root, "fake-claude")
  fs.writeFileSync(command, "#!/bin/sh\nexit 0\n", { mode: 0o755 })
  return {
    root,
    project,
    transcript,
    stateRoot: path.join(root, "state"),
    command,
    sessionId: "session-test"
  }
}

function run(
  value: Fixture,
  extra: { stopHookActive?: boolean; command?: string } = {}
): string {
  return runTs(HOOK, [], {
    input: JSON.stringify({
      transcript_path: value.transcript,
      cwd: value.project,
      session_id: value.sessionId,
      stop_hook_active: extra.stopHookActive
    }),
    env: {
      ...process.env,
      CLAUDE_PROJECT_DIR: value.project,
      CLAUDE_PLUGIN_ROOT: "/plugin/root",
      TASK_UTILITY_CHAT_STATE_DIR: value.stateRoot,
      TASK_UTILITY_CLAUDE_COMMAND: extra.command ?? value.command
    }
  })
}

function stateOf(value: Fixture): RecordingState | null {
  const key = getSessionKey(value.sessionId, value.transcript)
  return readJson<RecordingState>(
    getStatePaths(value.project, key, {
      TASK_UTILITY_CHAT_STATE_DIR: value.stateRoot
    }).statePath
  )
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

test("未記録実発言では detached fixture を起動し attemptedLine を保存する", () => {
  const value = fixture([user("質問です")])
  try {
    expect(run(value).trim()).toBe("")
    const state = stateOf(value)
    expect(state?.attemptedLine).toBe(1)
    expect(state?.recordedLine).toBe(0)
    expect(state?.attemptId).toBeTruthy()
  } finally {
    fs.rmSync(value.root, { recursive: true, force: true })
  }
})

test("同一実発言は有効ロックにより二重起動しない", () => {
  const value = fixture([user("質問です")])
  // 即終了する既定 fixture では 2 回目の実行時に PID が死んで stale 扱いになるため、
  // 「recorder が実行中」を再現する生存し続けるコマンドでロックの有効性を検証する
  const liveCommand = path.join(value.root, "fake-claude-live")
  fs.writeFileSync(liveCommand, "#!/bin/sh\nsleep 60\n", { mode: 0o755 })
  try {
    run(value, { command: liveCommand })
    const first = stateOf(value)
    expect(run(value, { command: liveCommand }).trim()).toBe("")
    expect(stateOf(value)?.attemptId).toBe(first?.attemptId)
  } finally {
    fs.rmSync(value.root, { recursive: true, force: true })
  }
})

test("claude コマンド不在では現行マーカー付き block にフォールバックする", () => {
  const value = fixture([user("質問です")])
  try {
    const out = JSON.parse(
      run(value, { command: path.join(value.root, "missing-claude") })
    )
    expect(out.decision).toBe("block")
    expect(out.reason).toContain("<!--chat-recorder-nag-->")
    expect(out.reason).toContain("task-utility:chat-recorder")
    expect(out.reason).toContain("準備コマンド")
    expect(out.reason).toContain("確定コマンド")
  } finally {
    fs.rmSync(value.root, { recursive: true, force: true })
  }
})

test("相対パス・引数付きのコマンド差し替えを拒否する", () => {
  const value = fixture([user("質問です")])
  try {
    const out = JSON.parse(run(value, { command: "./claude --flag" }))
    expect(out.decision).toBe("block")
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
    assistantTool("Bash", { description: "build\n\u001b[31m危険\u001b[0m" })
  ])
  try {
    run(value)
    const state = stateOf(value)
    const key = getSessionKey(value.sessionId, value.transcript)
    const paths = getStatePaths(value.project, key, {
      TASK_UTILITY_CHAT_STATE_DIR: value.stateRoot
    })
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

test("spawn 引数は hook/MCPを止め、状態基底と一時領域だけを add-dir する", () => {
  const args = buildClaudeArgs("prompt", [
    "/state/project-key",
    "/tmp/task-utility-chat-recorder-1000/project-key/temp",
    "/state/project-key"
  ])
  expect(args).toContain('{"disableAllHooks":true}')
  expect(args).toContain("--strict-mcp-config")
  expect(args.filter((_, index) => args[index - 1] === "--add-dir")).toEqual([
    "/state/project-key",
    "/tmp/task-utility-chat-recorder-1000/project-key/temp"
  ])
  expect(args[args.indexOf("--append-system-prompt") + 1]).toContain(
    "CLAUDE.md"
  )
})

test("recorder prompt は prepare/commit と限定責務を含む", () => {
  const prompt = buildRecorderPrompt({
    projectDir: "/project",
    transcriptPath: "/transcript",
    sessionKey: "session",
    attemptId: "attempt",
    targetLine: 2,
    recordedLine: 0,
    gitUserName: "user",
    localDate: "2026-07-24",
    toolHints: ["Write — result.md"],
    pluginRoot: "/plugin",
    bodyPath: "/state/body.md",
    indexPath: "/state/index.md"
  })
  expect(prompt).toContain("prepare-chat-recording.mjs")
  expect(prompt).toContain("commit-chat-recording.mjs")
  expect(prompt).toContain("記録する以外の作業をしてはいけません")
  expect(prompt).toContain("allowedNewRecordDir 直下")
  expect(prompt).toContain("ケバブケース名と .md 拡張子")
  expect(prompt).toContain("プロジェクト相対パス")
  expect(prompt).toContain("docs/chat/ からの相対パス")
  expect(prompt).toContain("バッククォート")
  expect(prompt).toContain("先頭に docs/chat/ を付けない")
})
