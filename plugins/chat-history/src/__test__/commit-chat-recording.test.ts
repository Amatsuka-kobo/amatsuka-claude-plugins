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
  const relativePath = appendMode
    ? "docs/chat/2026/0724/unknown/topic.md"
    : "docs/chat/2026/0724/unknown/0712-topic.md"
  const docsRelative = appendMode
    ? "2026/0724/unknown/topic.md"
    : "2026/0724/unknown/0712-topic.md"
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
    version: 2,
    attemptId,
    targetLine: 2,
    recordTarget: {
      relativePath: appendMode ? relativePath : null,
      appendMode
    },
    allowedNewRecordDir: "docs/chat/2026/0724/unknown",
    recordFilePrefix: "0712",
    recordDate: "2026-07-24",
    workerName: "unknown",
    sessionId: "cfa925f8-d36b-4dad-8b79-47bdddf1a653",
    sessionNumber: appendMode ? 2 : 1
  })
  const bodyFile = path.join(paths.tempDir, "body.md")
  const indexSummaryFile = path.join(paths.tempDir, "index-summary.md")
  const sessionTitleFile = path.join(paths.tempDir, "session-title.md")
  const headerFile = path.join(paths.tempDir, "header.md")
  fs.writeFileSync(bodyFile, "# unknown\n\n> 質問\n\n# AI\n\n回答\n")
  fs.writeFileSync(indexSummaryFile, "会話の要旨\n")
  fs.writeFileSync(sessionTitleFile, "話題の要旨\n")
  fs.writeFileSync(headerFile, "# New\n\n- 日付: 2026-07-24\n")
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
    indexSummaryFile,
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
    indexSummaryFile: value.indexSummaryFile,
    sessionTitleFile: value.sessionTitleFile,
    headerFile: appendMode ? undefined : value.headerFile,
    recordSlug: appendMode ? undefined : "topic"
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
      indexSummaryFile: value.indexSummaryFile,
      sessionTitleFile: value.sessionTitleFile,
      headerFile: appendMode ? undefined : value.headerFile,
      recordSlug: appendMode ? undefined : "topic"
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
    indexSummaryFile: value.indexSummaryFile,
    sessionTitleFile: value.sessionTitleFile,
    headerFile: value.headerFile,
    recordSlug: "topic"
  })
  expect(
    fs.readFileSync(
      path.join(value.project, "docs", "chat", "INDEX.md"),
      "utf8"
    )
  ).toBe(
    `# Chat Records Index\n\n- \`${value.docsRelative}\` | 2026-07-24 | unknown | 会話の要旨\n`
  )
})

test("新規記録のヘッダー末尾にセッション ID を刻む", () => {
  const value = setup(false)
  commitChatRecording({
    project: value.project,
    sessionKey: value.sessionKey,
    attemptId: value.attemptId,
    targetLine: 2,
    bodyFile: value.bodyFile,
    indexSummaryFile: value.indexSummaryFile,
    sessionTitleFile: value.sessionTitleFile,
    headerFile: value.headerFile,
    recordSlug: "topic"
  })
  const record = fs.readFileSync(
    path.join(value.project, "docs/chat/2026/0724/unknown/0712-topic.md"),
    "utf8"
  )
  expect(record).toContain(
    "- セッション ID: cfa925f8-d36b-4dad-8b79-47bdddf1a653"
  )
  // 区切り行より前(ヘッダー内)にあること
  expect(record.indexOf("- セッション ID:")).toBeLessThan(record.indexOf("---"))
})

// 追記対象のファイルは、新規作成時に既にセッション ID を持っている。
// 追記のたびに足すと同じ行が積み上がる。
test("追記時はセッション ID を書かない", () => {
  const value = setup(true)
  commitChatRecording({
    project: value.project,
    sessionKey: value.sessionKey,
    attemptId: value.attemptId,
    targetLine: 2,
    bodyFile: value.bodyFile,
    indexSummaryFile: value.indexSummaryFile,
    sessionTitleFile: value.sessionTitleFile
  })
  expect(fs.readFileSync(value.recordPath, "utf8")).not.toContain(
    "- セッション ID:"
  )
})

test.each([
  ["改行を含む", "abc\ndef"],
  ["長すぎる", "x".repeat(200)]
])("不正なセッション ID(%s)なら行を足さない", (_label, sessionId) => {
  const value = setup(false)
  const planPath = path.join(value.paths.planDir, `${value.sessionKey}.json`)
  const plan = readJson<Record<string, unknown>>(planPath)
  atomicWriteJson(planPath, { ...plan, sessionId })
  commitChatRecording({
    project: value.project,
    sessionKey: value.sessionKey,
    attemptId: value.attemptId,
    targetLine: 2,
    bodyFile: value.bodyFile,
    indexSummaryFile: value.indexSummaryFile,
    sessionTitleFile: value.sessionTitleFile,
    headerFile: value.headerFile,
    recordSlug: "topic"
  })
  const record = fs.readFileSync(
    path.join(value.project, "docs/chat/2026/0724/unknown/0712-topic.md"),
    "utf8"
  )
  expect(record).not.toContain("- セッション ID:")
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
    indexSummaryFile: value.indexSummaryFile,
    sessionTitleFile: value.sessionTitleFile
  })
  const updated = fs.readFileSync(indexPath, "utf8")
  expect(updated.match(new RegExp(value.docsRelative, "g"))).toHaveLength(1)
  expect(updated).toContain(
    `- \`${value.docsRelative}\` | 2026-07-24 | unknown | 会話の要旨`
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
    indexSummaryFile: value.indexSummaryFile,
    sessionTitleFile: value.sessionTitleFile,
    headerFile: value.headerFile,
    recordSlug: "topic"
  })
  expect(fs.readFileSync(indexPath, "utf8").split("\n")).toEqual([
    "# Chat Records Index",
    "",
    "<!-- keep-before -->",
    "- `2025/0101/user/alpha.md` | old",
    "<!-- keep-middle -->",
    `- \`${value.docsRelative}\` | 2026-07-24 | unknown | 会話の要旨`,
    "- `2027/0101/user/zulu.md` | future",
    "<!-- keep-after -->",
    ""
  ])
})

test.each([
  ["大文字を含む", "Topic"],
  ["スラッシュを含む", "dir/topic"],
  ["拡張子付き", "topic.md"],
  ["先頭が 4 桁数字", "0712-topic"],
  ["4 桁数字のみ", "0712"],
  ["連続ハイフン", "topic--name"],
  ["長さ超過", "a".repeat(81)]
])("不正なスラッグ(%s)を拒否する", (_label, slug) => {
  const value = setup(false)
  expect(() =>
    commitChatRecording({
      project: value.project,
      sessionKey: value.sessionKey,
      attemptId: value.attemptId,
      targetLine: 2,
      bodyFile: value.bodyFile,
      indexSummaryFile: value.indexSummaryFile,
      sessionTitleFile: value.sessionTitleFile,
      headerFile: value.headerFile,
      recordSlug: slug
    })
  ).toThrow(/record slug/)
})

test("新規記録でスラッグが無ければ失敗する", () => {
  const value = setup(false)
  expect(() =>
    commitChatRecording({
      project: value.project,
      sessionKey: value.sessionKey,
      attemptId: value.attemptId,
      targetLine: 2,
      bodyFile: value.bodyFile,
      indexSummaryFile: value.indexSummaryFile,
      sessionTitleFile: value.sessionTitleFile,
      headerFile: value.headerFile
    })
  ).toThrow(/--record-slug is required/)
})

test("スラッグからプレフィックス付きのパスを合成する", () => {
  const value = setup(false)
  const result = commitChatRecording({
    project: value.project,
    sessionKey: value.sessionKey,
    attemptId: value.attemptId,
    targetLine: 2,
    bodyFile: value.bodyFile,
    indexSummaryFile: value.indexSummaryFile,
    sessionTitleFile: value.sessionTitleFile,
    headerFile: value.headerFile,
    recordSlug: "topic"
  })
  expect(result.recordPath).toBe("docs/chat/2026/0724/unknown/0712-topic.md")
})

test("追記時は recordSlug を無視して plan のパスへ書く", () => {
  const value = setup(true)
  const result = commitChatRecording({
    project: value.project,
    sessionKey: value.sessionKey,
    attemptId: value.attemptId,
    targetLine: 2,
    bodyFile: value.bodyFile,
    indexSummaryFile: value.indexSummaryFile,
    sessionTitleFile: value.sessionTitleFile,
    recordSlug: "ignored-slug"
  })
  expect(result.recordPath).toBe("docs/chat/2026/0724/unknown/topic.md")
})

test("plan の version が 2 でなければ拒否する", () => {
  const value = setup(false)
  const planPath = path.join(value.paths.planDir, `${value.sessionKey}.json`)
  const plan = readJson<Record<string, unknown>>(planPath)
  if (!plan) throw new Error("plan is missing")
  delete plan.recordTarget
  atomicWriteJson(planPath, { ...plan, version: 1 })
  expect(() =>
    commitChatRecording({
      project: value.project,
      sessionKey: value.sessionKey,
      attemptId: value.attemptId,
      targetLine: 2,
      bodyFile: value.bodyFile,
      indexSummaryFile: value.indexSummaryFile,
      sessionTitleFile: value.sessionTitleFile,
      headerFile: value.headerFile,
      recordSlug: "topic"
    })
  ).toThrow(/plan schema version/)
})

test.each([
  "allowedNewRecordDir",
  "recordFilePrefix",
  "recordDate",
  "workerName"
])("plan の確定値 %s が欠けていれば拒否する", (field) => {
  const value = setup(false)
  const planPath = path.join(value.paths.planDir, `${value.sessionKey}.json`)
  const plan = readJson<Record<string, unknown>>(planPath) ?? {}
  delete plan[field]
  atomicWriteJson(planPath, plan)
  expect(() =>
    commitChatRecording({
      project: value.project,
      sessionKey: value.sessionKey,
      attemptId: value.attemptId,
      targetLine: 2,
      bodyFile: value.bodyFile,
      indexSummaryFile: value.indexSummaryFile,
      sessionTitleFile: value.sessionTitleFile,
      headerFile: value.headerFile,
      recordSlug: "topic"
    })
  ).toThrow()
})

test("INDEX 行を plan の確定値と要旨から合成する", () => {
  const value = setup(false)
  commitChatRecording({
    project: value.project,
    sessionKey: value.sessionKey,
    attemptId: value.attemptId,
    targetLine: 2,
    bodyFile: value.bodyFile,
    indexSummaryFile: value.indexSummaryFile,
    sessionTitleFile: value.sessionTitleFile,
    headerFile: value.headerFile,
    recordSlug: "topic"
  })
  const index = fs.readFileSync(
    path.join(value.project, "docs/chat/INDEX.md"),
    "utf8"
  )
  expect(index).toContain(
    "- `2026/0724/unknown/0712-topic.md` | 2026-07-24 | unknown | 会話の要旨"
  )
})

test.each([
  ["区切り文字を含む", "要旨 | 追加"],
  ["空", ""]
])("不正な要旨(%s)を拒否する", (_label, summary) => {
  const value = setup(false)
  fs.writeFileSync(value.indexSummaryFile, `${summary}\n`)
  expect(() =>
    commitChatRecording({
      project: value.project,
      sessionKey: value.sessionKey,
      attemptId: value.attemptId,
      targetLine: 2,
      bodyFile: value.bodyFile,
      indexSummaryFile: value.indexSummaryFile,
      sessionTitleFile: value.sessionTitleFile,
      headerFile: value.headerFile,
      recordSlug: "topic"
    })
  ).toThrow(/INDEX summary/)
})

test("追記時は既存の INDEX 行を再合成して置き換える", () => {
  const value = setup(true)
  const indexPath = path.join(value.project, "docs/chat/INDEX.md")
  fs.writeFileSync(
    indexPath,
    `# Chat Records Index\n\n- \`${value.docsRelative}\` | 2026-07-24 | unknown | 古い要旨\n`
  )
  fs.writeFileSync(value.indexSummaryFile, "新しい要旨\n")
  commitChatRecording({
    project: value.project,
    sessionKey: value.sessionKey,
    attemptId: value.attemptId,
    targetLine: 2,
    bodyFile: value.bodyFile,
    indexSummaryFile: value.indexSummaryFile,
    sessionTitleFile: value.sessionTitleFile
  })
  const index = fs.readFileSync(indexPath, "utf8")
  expect(index).toContain("新しい要旨")
  expect(index).not.toContain("古い要旨")
  expect(
    index.split("\n").filter((line) => line.includes(value.docsRelative))
  ).toHaveLength(1)
})

test("同名のファイルがあれば連番を付けて新規作成する", () => {
  const value = setup(false)
  const taken = path.join(
    value.project,
    "docs/chat/2026/0724/unknown/0712-topic.md"
  )
  fs.mkdirSync(path.dirname(taken), { recursive: true })
  fs.writeFileSync(taken, "do not replace")
  const result = commitChatRecording({
    project: value.project,
    sessionKey: value.sessionKey,
    attemptId: value.attemptId,
    targetLine: 2,
    bodyFile: value.bodyFile,
    indexSummaryFile: value.indexSummaryFile,
    sessionTitleFile: value.sessionTitleFile,
    headerFile: value.headerFile,
    recordSlug: "topic"
  })
  expect(result.recordPath).toBe("docs/chat/2026/0724/unknown/0712-topic-2.md")
  expect(fs.readFileSync(taken, "utf8")).toBe("do not replace")
})

// 連番へ逃げたあと INDEX 検証で落ちたとき、消すのは自分が作った連番ファイルであり、
// 衝突していた既存ファイル(別セッションの記録)を触ってはならない。
test("連番で作成したあと失敗したら、連番ファイルだけを消す", () => {
  const value = setup(false)
  const taken = path.join(
    value.project,
    "docs/chat/2026/0724/unknown/0712-topic.md"
  )
  fs.mkdirSync(path.dirname(taken), { recursive: true })
  fs.writeFileSync(taken, "do not replace")
  // INDEX に重複行を仕込んで検証を失敗させる
  const docsRelative = "2026/0724/unknown/0712-topic-2.md"
  fs.writeFileSync(
    path.join(value.project, "docs/chat/INDEX.md"),
    `# Chat Records Index\n\n- \`${docsRelative}\` | 2026-07-24 | unknown | 1\n- \`${docsRelative}\` | 2026-07-24 | unknown | 2\n`
  )
  expect(() =>
    commitChatRecording({
      project: value.project,
      sessionKey: value.sessionKey,
      attemptId: value.attemptId,
      targetLine: 2,
      bodyFile: value.bodyFile,
      indexSummaryFile: value.indexSummaryFile,
      sessionTitleFile: value.sessionTitleFile,
      headerFile: value.headerFile,
      recordSlug: "topic"
    })
  ).toThrow()
  expect(fs.readFileSync(taken, "utf8")).toBe("do not replace")
  expect(
    fs.existsSync(
      path.join(value.project, "docs/chat/2026/0724/unknown/0712-topic-2.md")
    )
  ).toBe(false)
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
      indexSummaryFile: value.indexSummaryFile,
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
    indexSummaryFile: value.indexSummaryFile,
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
    indexSummaryFile: value.indexSummaryFile,
    sessionTitleFile: value.sessionTitleFile,
    headerFile: value.headerFile,
    recordSlug: "topic"
  })
  expect(fs.readFileSync(value.recordPath, "utf8")).toBe(
    "# New\n\n- 日付: 2026-07-24\n- セッション ID: cfa925f8-d36b-4dad-8b79-47bdddf1a653\n\n---\n\n## セッション 1: 話題の要旨\n\n# unknown\n\n> 質問\n\n# AI\n\n回答\n"
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
      indexSummaryFile: value.indexSummaryFile,
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
      indexSummaryFile: value.indexSummaryFile,
      sessionTitleFile: value.sessionTitleFile,
      recordSlug: "topic"
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
      indexSummaryFile: value.indexSummaryFile,
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
      indexSummaryFile: value.indexSummaryFile,
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
    indexSummaryFile: value.indexSummaryFile,
    sessionTitleFile: value.sessionTitleFile,
    headerFile: value.headerFile,
    recordSlug: "topic"
  })
  expect(fs.existsSync(value.bodyFile)).toBe(false)
  expect(fs.existsSync(value.indexSummaryFile)).toBe(false)
  expect(fs.existsSync(value.sessionTitleFile)).toBe(false)
  expect(fs.existsSync(value.headerFile)).toBe(false)
})

test("plan.userTurnLine があれば成功後の state に recordedUserTurn として保存する", () => {
  const value = setup(true)
  const planPath = path.join(value.paths.planDir, `${value.sessionKey}.json`)
  const plan = readJson<Record<string, unknown>>(planPath)
  atomicWriteJson(planPath, { ...plan, userTurnLine: 1 })
  commitChatRecording({
    project: value.project,
    sessionKey: value.sessionKey,
    attemptId: value.attemptId,
    targetLine: 2,
    bodyFile: value.bodyFile,
    indexSummaryFile: value.indexSummaryFile,
    sessionTitleFile: value.sessionTitleFile
  })
  const state = readJson<RecordingState>(value.paths.statePath)
  expect(state?.recordedUserTurn).toBe(1)
  expect(state?.attemptedUserTurn).toBeGreaterThanOrEqual(1)
})

test.each([
  { name: "effectiveTargetLine あり", effectiveTargetLine: 5, recordedLine: 5 },
  {
    name: "effectiveTargetLine なし",
    effectiveTargetLine: undefined,
    recordedLine: 2
  }
])("$name の recordedLine を保存する", ({
  effectiveTargetLine,
  recordedLine
}) => {
  const value = setup(true)
  const planPath = path.join(value.paths.planDir, `${value.sessionKey}.json`)
  const plan = readJson<Record<string, unknown>>(planPath)
  atomicWriteJson(planPath, {
    ...plan,
    userTurnLine: 1,
    ...(effectiveTargetLine === undefined ? {} : { effectiveTargetLine })
  })

  const result = commitChatRecording({
    project: value.project,
    sessionKey: value.sessionKey,
    attemptId: value.attemptId,
    targetLine: 2,
    bodyFile: value.bodyFile,
    indexSummaryFile: value.indexSummaryFile,
    sessionTitleFile: value.sessionTitleFile
  })

  const state = readJson<RecordingState>(value.paths.statePath)
  expect(result.recordedLine).toBe(recordedLine)
  expect(state?.recordedLine).toBe(recordedLine)
  expect(state?.attemptedLine).toBe(recordedLine)
  expect(state?.recordedUserTurn).toBe(1)
})

test("plan.userTurnLine が targetLine を超えていれば拒否する", () => {
  const value = setup(true)
  const planPath = path.join(value.paths.planDir, `${value.sessionKey}.json`)
  const plan = readJson<Record<string, unknown>>(planPath)
  atomicWriteJson(planPath, { ...plan, userTurnLine: 3 })
  expect(() =>
    commitChatRecording({
      project: value.project,
      sessionKey: value.sessionKey,
      attemptId: value.attemptId,
      targetLine: 2,
      bodyFile: value.bodyFile,
      indexSummaryFile: value.indexSummaryFile,
      sessionTitleFile: value.sessionTitleFile
    })
  ).toThrow(/userTurnLine/)
})

test("plan.effectiveTargetLine が targetLine を下回っていれば拒否する", () => {
  const value = setup(true)
  const planPath = path.join(value.paths.planDir, `${value.sessionKey}.json`)
  const plan = readJson<Record<string, unknown>>(planPath)
  atomicWriteJson(planPath, { ...plan, effectiveTargetLine: 1 })
  expect(() =>
    commitChatRecording({
      project: value.project,
      sessionKey: value.sessionKey,
      attemptId: value.attemptId,
      targetLine: 2,
      bodyFile: value.bodyFile,
      indexSummaryFile: value.indexSummaryFile,
      sessionTitleFile: value.sessionTitleFile
    })
  ).toThrow(/effectiveTargetLine/)
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
      indexSummaryFile: value.indexSummaryFile,
      sessionTitleFile: value.sessionTitleFile
    })
  ).toThrow(/too large/)
})
