import fs from "node:fs"
import os from "node:os"
import path from "node:path"
import { afterEach, expect, test } from "vitest"
import {
  atomicWriteJson,
  createInitialState,
  ensureStateDirs,
  getStatePaths,
  type RecordingLock
} from "../chat-recording-state.js"
import { prepareChatRecording, safeWorker } from "../prepare-chat-recording.js"

const roots: string[] = []
const previousStateRoot = process.env.TASK_UTILITY_CHAT_STATE_DIR
const previousPluginRoot = process.env.CLAUDE_PLUGIN_ROOT

afterEach(() => {
  for (const root of roots.splice(0))
    fs.rmSync(root, { recursive: true, force: true })
  if (previousStateRoot === undefined)
    delete process.env.TASK_UTILITY_CHAT_STATE_DIR
  else process.env.TASK_UTILITY_CHAT_STATE_DIR = previousStateRoot
  if (previousPluginRoot === undefined) delete process.env.CLAUDE_PLUGIN_ROOT
  else process.env.CLAUDE_PLUGIN_ROOT = previousPluginRoot
})

function setup(lines: string[]) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "prepare-chat-"))
  roots.push(root)
  const project = path.join(root, "project")
  const plugin = path.join(root, "plugin")
  fs.mkdirSync(path.join(project, "docs", "chat"), { recursive: true })
  fs.mkdirSync(path.join(plugin, "skills", "chat"), { recursive: true })
  fs.writeFileSync(
    path.join(plugin, "skills", "chat", "SKILL.md"),
    "# Fake chat contract\n"
  )
  const transcript = path.join(project, "transcript.jsonl")
  fs.writeFileSync(transcript, `${lines.join("\n")}\n`)
  const stateRoot = path.join(root, "state")
  process.env.TASK_UTILITY_CHAT_STATE_DIR = stateRoot
  process.env.CLAUDE_PLUGIN_ROOT = plugin
  const sessionKey = "session"
  const attemptId = "attempt"
  const paths = getStatePaths(project, sessionKey)
  ensureStateDirs(paths)
  const state = {
    ...createInitialState(project, transcript, { dev: 1, ino: 1 }),
    attemptId,
    attemptedLine: lines.length
  }
  atomicWriteJson(paths.statePath, state)
  atomicWriteJson(paths.lockPath, {
    version: 2,
    attemptId,
    targetLine: lines.length,
    createdAt: new Date().toISOString(),
    heartbeatAt: new Date().toISOString()
  } satisfies RecordingLock)
  atomicWriteJson(path.join(paths.planDir, `${sessionKey}.json`), {
    version: 1,
    attemptId,
    targetLine: lines.length,
    metadataHints: ["Write — result.md"]
  })
  return { root, project, transcript, sessionKey, attemptId, paths }
}

const user = (text: string) =>
  JSON.stringify({ type: "user", message: { content: text } })

test("1コマンド相当で契約・差分・探索情報を JSON 化できる", () => {
  const value = setup([user("質問")])
  const result = prepareChatRecording({
    project: value.project,
    transcript: value.transcript,
    sessionKey: value.sessionKey,
    attemptId: value.attemptId,
    targetLine: 1
  })
  expect(result.skillContract).toContain("Fake chat contract")
  expect(result.conversation).toContain("> 質問")
  expect(result.recordTarget).toEqual({ relativePath: null, appendMode: false })
  expect(result.metadataHints).toEqual(["Write — result.md"])
  expect(result.allowedNewRecordDir).toMatch(
    /^docs\/chat\/\d{4}\/\d{4}\/[^/]+$/
  )
  expect(result.newRecordPathExample).toBe(
    `${result.allowedNewRecordDir}/conversation-topic.md`
  )
  expect(result.bodyFile).toBe(
    path.join(
      value.paths.tempDir,
      `${value.sessionKey}-${value.attemptId}.body.md`
    )
  )
  expect(result.indexLineFile).toBe(
    path.join(
      value.paths.tempDir,
      `${value.sessionKey}-${value.attemptId}.index-line.md`
    )
  )
  expect(path.isAbsolute(result.bodyFile as string)).toBe(true)
  expect(path.isAbsolute(result.indexLineFile as string)).toBe(true)
  expect(result.indexEntryPath).toBeNull()
  expect(result.indexLineExample).toContain(
    "`YYYY/MMDD/<worker>/<kebab-case>.md`"
  )
  expect(result.indexLineExample).not.toContain("`docs/chat/")
})

test("作業者名がパス成分として空またはドットなら unknown にする", () => {
  expect(safeWorker(".")).toBe("unknown")
  expect(safeWorker("  ")).toBe("unknown")
})

test("recordedLine 行を含めず targetLine 行を含める", () => {
  const value = setup([user("古い"), user("新しい")])
  const state = JSON.parse(fs.readFileSync(value.paths.statePath, "utf8"))
  atomicWriteJson(value.paths.statePath, { ...state, recordedLine: 1 })
  const result = prepareChatRecording({
    project: value.project,
    transcript: value.transcript,
    sessionKey: value.sessionKey,
    attemptId: value.attemptId,
    targetLine: 2
  })
  expect(result.conversation).toContain("新しい")
  expect(result.conversation).not.toContain("古い")
})

function argsOf(value: ReturnType<typeof setup>) {
  return {
    project: value.project,
    transcript: value.transcript,
    sessionKey: value.sessionKey,
    attemptId: value.attemptId,
    targetLine: 1
  }
}

function setRecordPath(value: ReturnType<typeof setup>, recordPath: string) {
  const state = JSON.parse(fs.readFileSync(value.paths.statePath, "utf8"))
  atomicWriteJson(value.paths.statePath, { ...state, recordPath })
}

// 同じ日に複数セッションがあると候補が2件以上になり、単一候補判定だけでは
// 毎回新規ファイルが作られてセッションの記録が断片化する。
test("記録先は同一セッションが既に書いた state.recordPath を優先する", () => {
  const value = setup([user("質問")])
  const dir = prepareChatRecording(argsOf(value)).allowedNewRecordDir as string
  const absoluteDir = path.join(value.project, dir)
  fs.mkdirSync(absoluteDir, { recursive: true })
  fs.writeFileSync(path.join(absoluteDir, "other-session.md"), "# other\n")
  const mine = `${dir}/my-session.md`
  fs.writeFileSync(path.join(value.project, mine), "# mine\n")
  setRecordPath(value, mine)
  expect(prepareChatRecording(argsOf(value)).recordTarget).toEqual({
    relativePath: mine,
    appendMode: true
  })
})

test("state.recordPath のファイルが無ければ単一候補判定に戻る", () => {
  const value = setup([user("質問")])
  const dir = prepareChatRecording(argsOf(value)).allowedNewRecordDir as string
  const absoluteDir = path.join(value.project, dir)
  fs.mkdirSync(absoluteDir, { recursive: true })
  fs.writeFileSync(path.join(absoluteDir, "only.md"), "# only\n")
  setRecordPath(value, `${dir}/deleted.md`)
  expect(prepareChatRecording(argsOf(value)).recordTarget).toEqual({
    relativePath: `${dir}/only.md`,
    appendMode: true
  })
})

test("docs/chat の外を指す state.recordPath は採用しない", () => {
  const value = setup([user("質問")])
  fs.writeFileSync(path.join(value.project, "escape.md"), "# escape\n")
  setRecordPath(value, "escape.md")
  expect(prepareChatRecording(argsOf(value)).recordTarget).toEqual({
    relativePath: null,
    appendMode: false
  })
})

test("既存 INDEX は docs/chat 相対キーで探索し例も同じ表記にする", () => {
  const value = setup([user("質問")])
  const args = {
    project: value.project,
    transcript: value.transcript,
    sessionKey: value.sessionKey,
    attemptId: value.attemptId,
    targetLine: 1
  }
  const first = prepareChatRecording(args)
  const allowedDir = first.allowedNewRecordDir as string
  const relativePath = `${allowedDir}/topic.md`
  const docsRelative = relativePath.replace(/^docs\/chat\//, "")
  fs.mkdirSync(path.join(value.project, allowedDir), { recursive: true })
  fs.writeFileSync(
    path.join(value.project, relativePath),
    "# Existing\n\n## セッション 1\n"
  )
  const expectedLine = `- \`${docsRelative}\` | 2026-07-24 | unknown | summary`
  fs.writeFileSync(
    path.join(value.project, "docs", "chat", "INDEX.md"),
    `# Chat Records Index\n\n${expectedLine}\n`
  )

  const result = prepareChatRecording(args)
  expect(result.indexLine).toBe(expectedLine)
  expect(result.indexEntryPath).toBe(docsRelative)
  expect(result.indexLineExample).toContain(`\`${docsRelative}\``)
  expect(result.indexLineExample).not.toContain("`docs/chat/")
})

test("hook が承認したものと異なる transcript を拒否する", () => {
  const value = setup([user("質問")])
  const other = path.join(value.root, "other.jsonl")
  fs.writeFileSync(other, `${user("別")}\n`)
  expect(() =>
    prepareChatRecording({
      project: value.project,
      transcript: other,
      sessionKey: value.sessionKey,
      attemptId: value.attemptId,
      targetLine: 1
    })
  ).toThrow(/hook-approved/)
})
