import fs from "node:fs"
import os from "node:os"
import path from "node:path"
import { afterEach, expect, test } from "vitest"
import {
  atomicWriteJson,
  createInitialState,
  ensureStateDirs,
  getStatePaths,
  type RecordingLock,
  type RecordingState,
  readJson
} from "../chat-recording-state.js"
import { commitChatRecording } from "../commit-chat-recording.js"

const roots: string[] = []
const previousStateRoot = process.env.TASK_UTILITY_CHAT_STATE_DIR

afterEach(() => {
  for (const root of roots.splice(0))
    fs.rmSync(root, { recursive: true, force: true })
  if (previousStateRoot === undefined)
    delete process.env.TASK_UTILITY_CHAT_STATE_DIR
  else process.env.TASK_UTILITY_CHAT_STATE_DIR = previousStateRoot
})

function setup(appendMode: boolean) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "commit-chat-"))
  roots.push(root)
  const project = path.join(root, "project")
  fs.mkdirSync(path.join(project, "docs", "chat"), { recursive: true })
  process.env.TASK_UTILITY_CHAT_STATE_DIR = path.join(root, "state")
  const sessionKey = "session"
  const attemptId = "attempt"
  const relativePath = "docs/chat/2026/0724/unknown/topic.md"
  const docsRelative = "2026/0724/unknown/topic.md"
  const recordPath = path.join(project, relativePath)
  if (appendMode) {
    fs.mkdirSync(path.dirname(recordPath), { recursive: true })
    fs.writeFileSync(recordPath, "# Existing\n")
  }
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
    version: 1,
    attemptId,
    targetLine: 2,
    pid: process.pid,
    createdAt: new Date().toISOString(),
    heartbeatAt: new Date().toISOString()
  } satisfies RecordingLock)
  atomicWriteJson(path.join(paths.planDir, `${sessionKey}.json`), {
    version: 1,
    attemptId,
    targetLine: 2,
    recordTarget: {
      relativePath: appendMode ? relativePath : null,
      appendMode
    },
    allowedNewRecordDir: "docs/chat/2026/0724/unknown"
  })
  const bodyFile = path.join(paths.tempDir, "body.md")
  const indexLineFile = path.join(paths.tempDir, "index.md")
  fs.writeFileSync(
    bodyFile,
    appendMode
      ? "\n## セッション 2\n\n### USER\n\n> 質問\n"
      : "# New\n\n## セッション 1\n\n### USER\n\n> 質問\n"
  )
  fs.writeFileSync(
    indexLineFile,
    `- \`${docsRelative}\` | 2026-07-24 | unknown | summary\n`
  )
  return {
    root,
    project,
    sessionKey,
    attemptId,
    relativePath,
    docsRelative,
    recordPath,
    paths,
    bodyFile,
    indexLineFile
  }
}

test.each([
  false,
  true
])("新規=%s の本文・INDEX・状態を一括更新する", (appendMode) => {
  const value = setup(appendMode)
  const result = commitChatRecording({
    project: value.project,
    sessionKey: value.sessionKey,
    attemptId: value.attemptId,
    targetLine: 2,
    bodyFile: value.bodyFile,
    indexLineFile: value.indexLineFile,
    recordPath: appendMode ? undefined : value.relativePath
  })
  expect(result.ok).toBe(true)
  expect(fs.readFileSync(value.recordPath, "utf8")).toContain("> 質問")
  expect(
    fs.readFileSync(
      path.join(value.project, "docs", "chat", "INDEX.md"),
      "utf8"
    )
  ).toContain(`\`${value.docsRelative}\``)
  expect(readJson<RecordingState>(value.paths.statePath)?.recordedLine).toBe(2)
  expect(fs.existsSync(value.paths.lockPath)).toBe(false)
  expect(
    commitChatRecording({
      project: value.project,
      sessionKey: value.sessionKey,
      attemptId: value.attemptId,
      targetLine: 2,
      bodyFile: value.bodyFile,
      indexLineFile: value.indexLineFile,
      recordPath: appendMode ? undefined : value.relativePath
    })
  ).toEqual(result)
})

test("commit 成功で連続失敗カウンタを 0 に戻す", () => {
  const value = setup(true)
  const state = readJson<RecordingState>(value.paths.statePath)
  atomicWriteJson(value.paths.statePath, {
    ...(state as RecordingState),
    consecutiveFailures: 3
  })
  commitChatRecording({
    project: value.project,
    sessionKey: value.sessionKey,
    attemptId: value.attemptId,
    targetLine: 2,
    bodyFile: value.bodyFile,
    indexLineFile: value.indexLineFile
  })
  expect(
    readJson<RecordingState>(value.paths.statePath)?.consecutiveFailures
  ).toBe(0)
})

test("commit 失敗で連続失敗カウンタを増やす", () => {
  const value = setup(true)
  expect(() =>
    commitChatRecording({
      project: value.project,
      sessionKey: value.sessionKey,
      attemptId: value.attemptId,
      targetLine: 2,
      bodyFile: path.join(value.paths.tempDir, "missing.md"),
      indexLineFile: value.indexLineFile
    })
  ).toThrow()
  expect(
    readJson<RecordingState>(value.paths.statePath)?.consecutiveFailures
  ).toBe(1)
})

test("新規 INDEX はヘッダーと空行を付けて作成する", () => {
  const value = setup(false)
  commitChatRecording({
    project: value.project,
    sessionKey: value.sessionKey,
    attemptId: value.attemptId,
    targetLine: 2,
    bodyFile: value.bodyFile,
    indexLineFile: value.indexLineFile,
    recordPath: value.relativePath
  })
  expect(
    fs.readFileSync(
      path.join(value.project, "docs", "chat", "INDEX.md"),
      "utf8"
    )
  ).toBe(
    `# Chat Records Index\n\n- \`${value.docsRelative}\` | 2026-07-24 | unknown | summary\n`
  )
})

test.each([
  ["docs/chat 相対", (value: ReturnType<typeof setup>) => value.docsRelative],
  ["プロジェクト相対", (value: ReturnType<typeof setup>) => value.relativePath]
])("既存の%s INDEX 行を一意に更新して重複させない", (_, existingPath) => {
  const value = setup(true)
  const indexPath = path.join(value.project, "docs", "chat", "INDEX.md")
  fs.writeFileSync(
    indexPath,
    `# Chat Records Index\n\n- \`${existingPath(value)}\` | old\n`
  )
  commitChatRecording({
    project: value.project,
    sessionKey: value.sessionKey,
    attemptId: value.attemptId,
    targetLine: 2,
    bodyFile: value.bodyFile,
    indexLineFile: value.indexLineFile
  })
  const updated = fs.readFileSync(indexPath, "utf8")
  expect(updated.match(new RegExp(value.docsRelative, "g"))).toHaveLength(1)
  expect(updated).toContain(
    `- \`${value.docsRelative}\` | 2026-07-24 | unknown | summary`
  )
})

test("新規行をエントリのパス昇順位置へ挿入し非エントリ行を並べ替えない", () => {
  const value = setup(false)
  const indexPath = path.join(value.project, "docs", "chat", "INDEX.md")
  fs.writeFileSync(
    indexPath,
    [
      "# Chat Records Index",
      "",
      "<!-- keep-before -->",
      "- `2025/0101/user/alpha.md` | old",
      "<!-- keep-middle -->",
      "- `2027/0101/user/zulu.md` | future",
      "<!-- keep-after -->",
      ""
    ].join("\n")
  )
  commitChatRecording({
    project: value.project,
    sessionKey: value.sessionKey,
    attemptId: value.attemptId,
    targetLine: 2,
    bodyFile: value.bodyFile,
    indexLineFile: value.indexLineFile,
    recordPath: value.relativePath
  })
  expect(fs.readFileSync(indexPath, "utf8").split("\n")).toEqual([
    "# Chat Records Index",
    "",
    "<!-- keep-before -->",
    "- `2025/0101/user/alpha.md` | old",
    "<!-- keep-middle -->",
    `- \`${value.docsRelative}\` | 2026-07-24 | unknown | summary`,
    "- `2027/0101/user/zulu.md` | future",
    "<!-- keep-after -->",
    ""
  ])
})

test("既存新規パスとの衝突を排他的作成で拒否する", () => {
  const value = setup(false)
  fs.mkdirSync(path.dirname(value.recordPath), { recursive: true })
  fs.writeFileSync(value.recordPath, "do not replace")
  expect(() =>
    commitChatRecording({
      project: value.project,
      sessionKey: value.sessionKey,
      attemptId: value.attemptId,
      targetLine: 2,
      bodyFile: value.bodyFile,
      indexLineFile: value.indexLineFile,
      recordPath: value.relativePath
    })
  ).toThrow()
  expect(fs.readFileSync(value.recordPath, "utf8")).toBe("do not replace")
  expect(fs.existsSync(value.paths.lockPath)).toBe(true)
})

test("新規パス検証エラーは prepare と同じ期待形式と実値を示す", () => {
  const value = setup(false)
  const invalid = "docs/chat/2026/0724/unknown/Not_Kebab.md"
  expect(() =>
    commitChatRecording({
      project: value.project,
      sessionKey: value.sessionKey,
      attemptId: value.attemptId,
      targetLine: 2,
      bodyFile: value.bodyFile,
      indexLineFile: value.indexLineFile,
      recordPath: invalid
    })
  ).toThrow(
    `expected docs/chat/2026/0724/unknown/<kebab-case>.md, got ${invalid}`
  )
})

test("INDEX 参照エラーは期待する docs/chat 相対パスを示す", () => {
  const value = setup(false)
  fs.writeFileSync(value.indexLineFile, "| unrelated | summary |\n")
  expect(() =>
    commitChatRecording({
      project: value.project,
      sessionKey: value.sessionKey,
      attemptId: value.attemptId,
      targetLine: 2,
      bodyFile: value.bodyFile,
      indexLineFile: value.indexLineFile,
      recordPath: value.relativePath
    })
  ).toThrow(`docs/chat-relative path ${value.docsRelative}`)
})

test("INDEX 重複失敗時は本文を元サイズへ truncate しロックを保持する", () => {
  const value = setup(true)
  const before = fs.readFileSync(value.recordPath, "utf8")
  fs.writeFileSync(
    path.join(value.project, "docs", "chat", "INDEX.md"),
    `| a | ${value.relativePath} |\n| b | ${value.relativePath} |\n`
  )
  expect(() =>
    commitChatRecording({
      project: value.project,
      sessionKey: value.sessionKey,
      attemptId: value.attemptId,
      targetLine: 2,
      bodyFile: value.bodyFile,
      indexLineFile: value.indexLineFile
    })
  ).toThrow(/duplicate/)
  expect(fs.readFileSync(value.recordPath, "utf8")).toBe(before)
  expect(fs.existsSync(value.paths.lockPath)).toBe(true)
  expect(
    readJson<RecordingState>(value.paths.statePath)?.lastError?.phase
  ).toBe("commit")
})
