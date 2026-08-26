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
import {
  firstTranscriptTimestamp,
  localRecordParts,
  prepareChatRecording,
  resolveSessionStartedAt,
  safeWorker
} from "../prepare-chat-recording.js"

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

function writeTranscript(lines: string[]): string {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "session-start-"))
  roots.push(root)
  const file = path.join(root, "transcript.jsonl")
  fs.writeFileSync(file, `${lines.join("\n")}\n`)
  return file
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

test("bodyFile に原文本文を書き出し、パスとセッション番号を返す", () => {
  const value = setup([user("質問")])
  const result = prepareChatRecording(argsOf(value))
  expect(result.sessionTitleFile).toBe(
    path.join(
      value.paths.tempDir,
      `${value.sessionKey}-${value.attemptId}.session-title.md`
    )
  )
  expect(result.headerFile).toBe(
    path.join(
      value.paths.tempDir,
      `${value.sessionKey}-${value.attemptId}.header.md`
    )
  )
  expect(result.sessionNumber).toBe(1)
  const body = fs.readFileSync(result.bodyFile as string, "utf8")
  expect(body).toContain("> 質問")
  expect(body.endsWith("\n")).toBe(true)
  expect(body).toBe(`${result.conversation as string}\n`)
})

test("sessionNumber は既存記録の最大セッション番号 + 1 になる", () => {
  const value = setup([user("質問")])
  const dir = prepareChatRecording(argsOf(value)).allowedNewRecordDir as string
  const relativePath = `${dir}/topic.md`
  fs.mkdirSync(path.join(value.project, dir), { recursive: true })
  fs.writeFileSync(
    path.join(value.project, relativePath),
    "# Existing\n\n## セッション 1\n\n## セッション 2\n"
  )
  setRecordPath(value, relativePath)
  const result = prepareChatRecording(argsOf(value))
  expect(result.lastSessionNumber).toBe(2)
  expect(result.sessionNumber).toBe(3)
  const plan = JSON.parse(
    fs.readFileSync(
      path.join(value.paths.planDir, `${value.sessionKey}.json`),
      "utf8"
    )
  )
  expect(plan.sessionNumber).toBe(3)
})

// 原文記録では 1 セッションの本文が容易に 60 行を超える。末尾数十行の窓で番号を
// 数えると見出しを見失い、番号が 1 に戻ってセッション見出しが重複する。
test("セッション本文が 60 行を超えても sessionNumber は全文から算出する", () => {
  const value = setup([user("質問")])
  const dir = prepareChatRecording(argsOf(value)).allowedNewRecordDir as string
  const relativePath = `${dir}/long.md`
  fs.mkdirSync(path.join(value.project, dir), { recursive: true })
  const longBody = Array.from({ length: 120 }, (_, i) => `> 行 ${i}`).join("\n")
  fs.writeFileSync(
    path.join(value.project, relativePath),
    `# Existing\n\n## セッション 3: 要旨\n\n${longBody}\n`
  )
  setRecordPath(value, relativePath)
  const result = prepareChatRecording(argsOf(value))
  expect(result.tailContext as string).not.toContain("## セッション")
  expect(result.lastSessionNumber).toBe(3)
  expect(result.sessionNumber).toBe(4)
})

// 旧テンプレートは `## セッション1` とスペース無しで書いていた。既存記録が大半なので
// この形式を数え落とすと、追記のたびに番号が 1 に戻る。
test("旧形式のスペース無し見出しからも sessionNumber を継承する", () => {
  const value = setup([user("質問")])
  const dir = prepareChatRecording(argsOf(value)).allowedNewRecordDir as string
  const relativePath = `${dir}/legacy.md`
  fs.mkdirSync(path.join(value.project, dir), { recursive: true })
  fs.writeFileSync(
    path.join(value.project, relativePath),
    "# Existing\n\n## セッション1: 要旨\n\n> 質問\n"
  )
  setRecordPath(value, relativePath)
  const result = prepareChatRecording(argsOf(value))
  expect(result.lastSessionNumber).toBe(1)
  expect(result.sessionNumber).toBe(2)
})

test("同一セッションの古い attempt の一時ファイルだけを掃除する", () => {
  const value = setup([user("質問")])
  // attemptId("attempt") を名前に含めない。含めると掃除の除外条件に当たって残ってしまう
  const stale = path.join(
    value.paths.tempDir,
    `${value.sessionKey}-previous.body.md`
  )
  const otherSession = path.join(value.paths.tempDir, "other-session-x.body.md")
  fs.writeFileSync(stale, "stale\n")
  fs.writeFileSync(otherSession, "keep\n")
  prepareChatRecording(argsOf(value))
  expect(fs.existsSync(stale)).toBe(false)
  expect(fs.existsSync(otherSession)).toBe(true)
})

test("ユーザー側の見出しに作業者名を使う", () => {
  const value = setup([user("質問")])
  const result = prepareChatRecording(argsOf(value))
  expect(result.conversation).toMatch(
    new RegExp(`^# ${safeWorker(result.workerName as string)}\\n\\n> 質問`)
  )
})

test("テストは Asia/Tokyo 固定で走る", () => {
  expect(process.env.TZ).toBe("Asia/Tokyo")
  // UTC 21:59 は JST では翌日 06:59
  expect(new Date("2026-08-25T21:59:00Z").getHours()).toBe(6)
})

test("localRecordParts は与えた Date のローカル年月日と時分を返す", () => {
  // 2026-08-25T21:59:21Z は Asia/Tokyo では 2026-08-26 06:59
  const parts = localRecordParts(new Date("2026-08-25T21:59:21.651Z"))
  expect(parts).toEqual({
    year: "2026",
    monthDay: "0826",
    hhmm: "0659",
    date: "2026-08-26"
  })
})

test("localRecordParts は 1 桁の月日時分をゼロ埋めする", () => {
  const parts = localRecordParts(new Date("2026-01-04T00:05:00+09:00"))
  expect(parts).toEqual({
    year: "2026",
    monthDay: "0104",
    hhmm: "0005",
    date: "2026-01-04"
  })
})

test("firstTranscriptTimestamp は timestamp を持たない先頭行を読み飛ばす", () => {
  const file = writeTranscript([
    JSON.stringify({ type: "last-prompt", leafUuid: "x" }),
    JSON.stringify({ type: "mode" }),
    JSON.stringify({ type: "permission-mode" }),
    JSON.stringify({ type: "atis-latch" }),
    JSON.stringify({ type: "user", timestamp: "2026-08-25T21:59:21.651Z" }),
    JSON.stringify({ type: "assistant", timestamp: "2026-08-25T22:10:00.000Z" })
  ])
  expect(firstTranscriptTimestamp(file)?.toISOString()).toBe(
    "2026-08-25T21:59:21.651Z"
  )
})

test("firstTranscriptTimestamp は壊れた行と不正な timestamp を読み飛ばす", () => {
  const file = writeTranscript([
    "{ not json",
    JSON.stringify({ type: "mode", timestamp: 12345 }),
    JSON.stringify({ type: "mode", timestamp: "not-a-date" }),
    JSON.stringify({ type: "user", timestamp: "2026-03-01T00:00:00.000Z" })
  ])
  expect(firstTranscriptTimestamp(file)?.toISOString()).toBe(
    "2026-03-01T00:00:00.000Z"
  )
})

test("firstTranscriptTimestamp は null の行を読み飛ばす", () => {
  const file = writeTranscript([
    "null",
    JSON.stringify({ type: "user", timestamp: "2026-03-01T00:00:00.000Z" })
  ])
  expect(firstTranscriptTimestamp(file)?.toISOString()).toBe(
    "2026-03-01T00:00:00.000Z"
  )
})

// 最初のユーザー発言に大きな貼り付けがあると、1 行が数百 KiB になる。
// 先頭を一定バイトだけ読む実装だと、この行の timestamp を取りこぼす。
test("firstTranscriptTimestamp は 1 行が非常に長くても timestamp を拾う", () => {
  const file = writeTranscript([
    JSON.stringify({ type: "mode" }),
    JSON.stringify({
      type: "user",
      timestamp: "2026-05-05T00:00:00.000Z",
      message: { content: "x".repeat(300_000) }
    })
  ])
  expect(firstTranscriptTimestamp(file)?.toISOString()).toBe(
    "2026-05-05T00:00:00.000Z"
  )
})

test("firstTranscriptTimestamp は timestamp が無ければ null を返す", () => {
  const file = writeTranscript([
    JSON.stringify({ type: "last-prompt" }),
    JSON.stringify({ type: "mode" })
  ])
  expect(firstTranscriptTimestamp(file)).toBeNull()
})

test("firstTranscriptTimestamp は読めないファイルで null を返す", () => {
  expect(firstTranscriptTimestamp("/nonexistent/transcript.jsonl")).toBeNull()
})

test("resolveSessionStartedAt は timestamp が無ければファイルの時刻へ落ちる", () => {
  const file = writeTranscript([JSON.stringify({ type: "mode" })])
  const stat = fs.statSync(file)
  // birthtimeMs は小数を持ちうる一方、Date.getTime() は整数ミリ秒を返す。
  const expected =
    stat.birthtimeMs > 0
      ? Math.trunc(stat.birthtimeMs)
      : Math.trunc(stat.mtimeMs)
  expect(resolveSessionStartedAt(file).getTime()).toBe(expected)
})
