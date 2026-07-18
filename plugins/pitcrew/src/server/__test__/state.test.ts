import fs from "node:fs"
import os from "node:os"
import path from "node:path"
import { expect, test } from "vitest"
import { isSafeName, listState, readItemBody } from "../state.js"

function makeProject(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), "pitcrew-state-"))
}

function writeItem(
  dir: string,
  sub: "review" | "reviewed",
  name: string,
  content: string
): void {
  const d = path.join(dir, ".pitcrew", sub)
  fs.mkdirSync(d, { recursive: true })
  fs.writeFileSync(path.join(d, name), content)
}

const ITEM = `---
id: "002"
type: diff
agent: implementer
created: 2026-07-17T10:00:00.000Z
base: aaa1111
head: bbb2222
paths: [src/auth.ts]
---
# auth.ts の diff

本文
`

test(".pitcrew/ が無ければ空状態を返す", () => {
  const dir = makeProject()
  try {
    const s = listState(dir)
    expect(s.hasRun).toBe(false)
    expect(s.review).toEqual([])
    expect(s.reviewed).toEqual([])
    expect(s.openComments).toBe(0)
    expect(s.processedComments).toBe(0)
  } finally {
    fs.rmSync(dir, { recursive: true, force: true })
  }
})

test("review/ の項目を frontmatter 付きで一覧できる", () => {
  const dir = makeProject()
  try {
    writeItem(dir, "review", "002-diff-auth-ts.md", ITEM)
    const s = listState(dir)
    expect(s.review).toHaveLength(1)
    const item = s.review[0]
    expect(item.name).toBe("002-diff-auth-ts.md")
    expect(item.status).toBe("review")
    expect(item.id).toBe("002")
    expect(item.type).toBe("diff")
    expect(item.agent).toBe("implementer")
    expect(item.base).toBe("aaa1111")
    expect(item.head).toBe("bbb2222")
    expect(item.paths).toEqual(["src/auth.ts"])
    expect(item.title).toBe("auth.ts の diff")
  } finally {
    fs.rmSync(dir, { recursive: true, force: true })
  }
})

test("reviewed/ とコメント数もまとめて返す", () => {
  const dir = makeProject()
  try {
    writeItem(dir, "review", "003-test-vitest.md", ITEM)
    writeItem(dir, "reviewed", "001-artifact-design-md.md", ITEM)
    const comments = path.join(dir, ".pitcrew", "comments")
    fs.mkdirSync(path.join(comments, "processed"), { recursive: true })
    fs.writeFileSync(path.join(comments, "c-001.md"), "---\n---\nx\n")
    fs.writeFileSync(path.join(comments, "processed", "c-000.md"), "y")
    const s = listState(dir)
    expect(s.review.map((i) => i.name)).toEqual(["003-test-vitest.md"])
    expect(s.reviewed.map((i) => i.name)).toEqual(["001-artifact-design-md.md"])
    expect(s.openComments).toBe(1)
    expect(s.processedComments).toBe(1)
  } finally {
    fs.rmSync(dir, { recursive: true, force: true })
  }
})

test("run.json があれば hasRun と実行情報を返す", () => {
  const dir = makeProject()
  try {
    fs.mkdirSync(path.join(dir, ".pitcrew"), { recursive: true })
    fs.writeFileSync(
      path.join(dir, ".pitcrew", "run.json"),
      JSON.stringify({
        startedAt: "2026-07-17T09:00:00.000Z",
        lastCaptureCommit: null,
        lastCaptureAt: "2026-07-17T09:30:00.000Z",
        nextReviewId: 4
      })
    )
    const s = listState(dir)
    expect(s.hasRun).toBe(true)
    expect(s.startedAt).toBe("2026-07-17T09:00:00.000Z")
    expect(s.lastCaptureAt).toBe("2026-07-17T09:30:00.000Z")
  } finally {
    fs.rmSync(dir, { recursive: true, force: true })
  }
})

test("frontmatter が壊れた項目も一覧から落とさない", () => {
  const dir = makeProject()
  try {
    writeItem(dir, "review", "004-broken.md", "frontmatter なし本文だけ")
    const s = listState(dir)
    expect(s.review).toHaveLength(1)
    expect(s.review[0].type).toBeNull()
    expect(s.review[0].title).toBe("004-broken.md")
  } finally {
    fs.rmSync(dir, { recursive: true, force: true })
  }
})

test("readItemBody は全文を返し、無い・不正な名前は null", () => {
  const dir = makeProject()
  try {
    writeItem(dir, "review", "002-diff-auth-ts.md", ITEM)
    expect(readItemBody(dir, "review", "002-diff-auth-ts.md")).toBe(ITEM)
    expect(readItemBody(dir, "review", "nope.md")).toBeNull()
    expect(readItemBody(dir, "review", "../run.json")).toBeNull()
  } finally {
    fs.rmSync(dir, { recursive: true, force: true })
  }
})

test("isSafeName はパストラバーサルを拒否する", () => {
  expect(isSafeName("002-diff-auth-ts.md")).toBe(true)
  expect(isSafeName("c-001.md")).toBe(true)
  expect(isSafeName("../run.json")).toBe(false)
  expect(isSafeName("a/b.md")).toBe(false)
  expect(isSafeName("..%2Fx.md")).toBe(false)
  expect(isSafeName("x.txt")).toBe(false)
  expect(isSafeName("..md")).toBe(false)
})
