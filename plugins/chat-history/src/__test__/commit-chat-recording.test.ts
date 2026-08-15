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
    version: 2,
    attemptId,
    targetLine: 2,
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
    allowedNewRecordDir: "docs/chat/2026/0724/unknown",
    sessionNumber: appendMode ? 2 : 1
  })
  const bodyFile = path.join(paths.tempDir, "body.md")
  const indexLineFile = path.join(paths.tempDir, "index.md")
  const sessionTitleFile = path.join(paths.tempDir, "session-title.md")
  const headerFile = path.join(paths.tempDir, "header.md")
  fs.writeFileSync(bodyFile, "# unknown\n\n> 質問\n\n# AI\n\n回答\n")
  fs.writeFileSync(sessionTitleFile, "話題の要旨\n")
  fs.writeFileSync(headerFile, "# New\n\n- 日付: 2026-07-24\n")
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
    indexLineFile,
    sessionTitleFile,
    headerFile
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
    sessionTitleFile: value.sessionTitleFile,
    headerFile: appendMode ? undefined : value.headerFile,
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
      sessionTitleFile: value.sessionTitleFile,
      headerFile: appendMode ? undefined : value.headerFile,
      recordPath: appendMode ? undefined : value.relativePath
    })
  ).toEqual(result)
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
    sessionTitleFile: value.sessionTitleFile,
    headerFile: value.headerFile,
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
    indexLineFile: value.indexLineFile,
    sessionTitleFile: value.sessionTitleFile
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
    sessionTitleFile: value.sessionTitleFile,
    headerFile: value.headerFile,
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
      sessionTitleFile: value.sessionTitleFile,
      headerFile: value.headerFile,
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
      sessionTitleFile: value.sessionTitleFile,
      headerFile: value.headerFile,
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
      sessionTitleFile: value.sessionTitleFile,
      headerFile: value.headerFile,
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
      indexLineFile: value.indexLineFile,
      sessionTitleFile: value.sessionTitleFile
    })
  ).toThrow(/duplicate/)
  expect(fs.readFileSync(value.recordPath, "utf8")).toBe(before)
  expect(fs.existsSync(value.paths.lockPath)).toBe(true)
  expect(
    readJson<RecordingState>(value.paths.statePath)?.lastError?.phase
  ).toBe("commit")
})

test("追記時はセッション見出しを生成して本文の前に置く", () => {
  const value = setup(true)
  commitChatRecording({
    project: value.project,
    sessionKey: value.sessionKey,
    attemptId: value.attemptId,
    targetLine: 2,
    bodyFile: value.bodyFile,
    indexLineFile: value.indexLineFile,
    sessionTitleFile: value.sessionTitleFile
  })
  expect(fs.readFileSync(value.recordPath, "utf8")).toBe(
    "# Existing\n\n## セッション 2: 話題の要旨\n\n# unknown\n\n> 質問\n\n# AI\n\n回答\n"
  )
})

test("新規時はヘッダー・区切り・セッション見出し・本文を結合する", () => {
  const value = setup(false)
  commitChatRecording({
    project: value.project,
    sessionKey: value.sessionKey,
    attemptId: value.attemptId,
    targetLine: 2,
    bodyFile: value.bodyFile,
    indexLineFile: value.indexLineFile,
    sessionTitleFile: value.sessionTitleFile,
    headerFile: value.headerFile,
    recordPath: value.relativePath
  })
  expect(fs.readFileSync(value.recordPath, "utf8")).toBe(
    "# New\n\n- 日付: 2026-07-24\n\n---\n\n## セッション 1: 話題の要旨\n\n# unknown\n\n> 質問\n\n# AI\n\n回答\n"
  )
})

test("追記時に --header-file を渡すと拒否する", () => {
  const value = setup(true)
  expect(() =>
    commitChatRecording({
      project: value.project,
      sessionKey: value.sessionKey,
      attemptId: value.attemptId,
      targetLine: 2,
      bodyFile: value.bodyFile,
      indexLineFile: value.indexLineFile,
      sessionTitleFile: value.sessionTitleFile,
      headerFile: value.headerFile
    })
  ).toThrow(/header/)
})

test("新規時に --header-file が無ければ拒否する", () => {
  const value = setup(false)
  expect(() =>
    commitChatRecording({
      project: value.project,
      sessionKey: value.sessionKey,
      attemptId: value.attemptId,
      targetLine: 2,
      bodyFile: value.bodyFile,
      indexLineFile: value.indexLineFile,
      sessionTitleFile: value.sessionTitleFile,
      recordPath: value.relativePath
    })
  ).toThrow(/header/)
})

test("セッション要旨が空または複数行なら拒否する", () => {
  const value = setup(true)
  fs.writeFileSync(value.sessionTitleFile, "一行目\n二行目\n")
  expect(() =>
    commitChatRecording({
      project: value.project,
      sessionKey: value.sessionKey,
      attemptId: value.attemptId,
      targetLine: 2,
      bodyFile: value.bodyFile,
      indexLineFile: value.indexLineFile,
      sessionTitleFile: value.sessionTitleFile
    })
  ).toThrow(/session title/)
})

// 旧版 prepare が書いた plan には sessionNumber が無い。検証しないと
// `## セッション undefined` が記録に残る。
test("plan の sessionNumber が欠けていれば拒否する", () => {
  const value = setup(true)
  const planPath = path.join(value.paths.planDir, `${value.sessionKey}.json`)
  const plan = JSON.parse(fs.readFileSync(planPath, "utf8"))
  delete plan.sessionNumber
  atomicWriteJson(planPath, plan)
  expect(() =>
    commitChatRecording({
      project: value.project,
      sessionKey: value.sessionKey,
      attemptId: value.attemptId,
      targetLine: 2,
      bodyFile: value.bodyFile,
      indexLineFile: value.indexLineFile,
      sessionTitleFile: value.sessionTitleFile
    })
  ).toThrow(/sessionNumber/)
  expect(fs.readFileSync(value.recordPath, "utf8")).toBe("# Existing\n")
})

test("成功時に一時ファイル 4 本をすべて削除する", () => {
  const value = setup(false)
  commitChatRecording({
    project: value.project,
    sessionKey: value.sessionKey,
    attemptId: value.attemptId,
    targetLine: 2,
    bodyFile: value.bodyFile,
    indexLineFile: value.indexLineFile,
    sessionTitleFile: value.sessionTitleFile,
    headerFile: value.headerFile,
    recordPath: value.relativePath
  })
  expect(fs.existsSync(value.bodyFile)).toBe(false)
  expect(fs.existsSync(value.indexLineFile)).toBe(false)
  expect(fs.existsSync(value.sessionTitleFile)).toBe(false)
  expect(fs.existsSync(value.headerFile)).toBe(false)
})

test("本文が 8MB を超えると拒否する", () => {
  const value = setup(true)
  fs.writeFileSync(value.bodyFile, `> 質問\n${"a".repeat(8 * 1024 * 1024)}\n`)
  expect(() =>
    commitChatRecording({
      project: value.project,
      sessionKey: value.sessionKey,
      attemptId: value.attemptId,
      targetLine: 2,
      bodyFile: value.bodyFile,
      indexLineFile: value.indexLineFile,
      sessionTitleFile: value.sessionTitleFile
    })
  ).toThrow(/too large/)
})
