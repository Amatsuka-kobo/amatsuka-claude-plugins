import fs from "node:fs"
import os from "node:os"
import path from "node:path"
import { expect, test } from "vitest"
import {
  claimComment,
  listComments,
  type PitcrewComment,
  pathMatchesComment,
  renderInjection
} from "../comments.js"

function makeProject(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), "pitcrew-comments-"))
}

function writeComment(dir: string, name: string, content: string): void {
  const commentsDir = path.join(dir, ".pitcrew", "comments")
  fs.mkdirSync(commentsDir, { recursive: true })
  fs.writeFileSync(path.join(commentsDir, name), content)
}

const URGENT = `---
urgency: urgent
paths: [src/auth.ts]
reviewId: "002"
base: a3f2c01
---
この方針はやめて、既存の validate() を使ってください。
`

const NORMAL = `---
urgency: normal
paths: [docs/design.md]
---
設計書の §3 に理由を追記してください。
`

test("listComments は comments/ 直下の md を名前順に返す", () => {
  const dir = makeProject()
  try {
    writeComment(dir, "c-002.md", NORMAL)
    writeComment(dir, "c-001.md", URGENT)
    // processed/ 内は対象外
    const processed = path.join(dir, ".pitcrew", "comments", "processed")
    fs.mkdirSync(processed, { recursive: true })
    fs.writeFileSync(path.join(processed, "c-000.md"), URGENT)

    const comments = listComments(dir)
    expect(comments.map((c) => c.name)).toEqual(["c-001.md", "c-002.md"])
    expect(comments[0].urgency).toBe("urgent")
    expect(comments[0].paths).toEqual(["src/auth.ts"])
    expect(comments[0].reviewId).toBe("002")
    expect(comments[0].base).toBe("a3f2c01")
    expect(comments[0].body).toContain("validate()")
    expect(comments[1].urgency).toBe("normal")
  } finally {
    fs.rmSync(dir, { recursive: true, force: true })
  }
})

test("frontmatter の無いコメントは normal・paths 空として扱う", () => {
  const dir = makeProject()
  try {
    writeComment(dir, "c-001.md", "テンプレを使わない手書きコメント\n")
    const comments = listComments(dir)
    expect(comments).toHaveLength(1)
    expect(comments[0].urgency).toBe("normal")
    expect(comments[0].paths).toEqual([])
    expect(comments[0].body).toContain("手書きコメント")
  } finally {
    fs.rmSync(dir, { recursive: true, force: true })
  }
})

test("paths が文字列単体でも配列に正規化する", () => {
  const dir = makeProject()
  try {
    writeComment(
      dir,
      "c-001.md",
      "---\nurgency: urgent\npaths: src/auth.ts\n---\nx\n"
    )
    expect(listComments(dir)[0].paths).toEqual(["src/auth.ts"])
  } finally {
    fs.rmSync(dir, { recursive: true, force: true })
  }
})

test("pathMatchesComment は完全一致と祖先ディレクトリでマッチする", () => {
  // 第1引数 = コメント側、第2引数 = ツール入力側
  expect(pathMatchesComment("src/auth.ts", "src/auth.ts")).toBe(true)
  expect(pathMatchesComment("src", "src/auth.ts")).toBe(true)
  expect(pathMatchesComment("src/", "src/auth.ts")).toBe(true)
  expect(pathMatchesComment("src/auth.ts", "src/auth.test.ts")).toBe(false)
  expect(pathMatchesComment("src/auth", "src/auth.ts")).toBe(false)
  expect(pathMatchesComment("", "src/auth.ts")).toBe(false)
  // 逆方向(ツール側が祖先)はマッチしない
  expect(pathMatchesComment("src/auth.ts", "src")).toBe(false)
  // バックスラッシュ区切り(手書きコメントの Windows パス)も正規化して照合する
  expect(pathMatchesComment("src\\auth.ts", "src/auth.ts")).toBe(true)
})

test("claimComment は processed/ へ rename し、二重クレームは失敗する", () => {
  const dir = makeProject()
  try {
    writeComment(dir, "c-001.md", URGENT)
    expect(claimComment(dir, "c-001.md")).toBe(true)
    expect(
      fs.existsSync(path.join(dir, ".pitcrew", "comments", "c-001.md"))
    ).toBe(false)
    expect(
      fs.existsSync(
        path.join(dir, ".pitcrew", "comments", "processed", "c-001.md")
      )
    ).toBe(true)
    // 既に移動済み → 敗者は false を受けてスキップする(設計書 §6)
    expect(claimComment(dir, "c-001.md")).toBe(false)
  } finally {
    fs.rmSync(dir, { recursive: true, force: true })
  }
})

test("renderInjection はコメントを作成順に連結し、上限超過は切り詰める", () => {
  const short: PitcrewComment = {
    name: "c-001.md",
    file: "/tmp/x/c-001.md",
    urgency: "urgent",
    paths: ["src/auth.ts"],
    reviewId: null,
    base: "a3f2c01",
    body: "コメント本文A"
  }
  const long: PitcrewComment = {
    ...short,
    name: "c-002.md",
    body: "あ".repeat(20_000)
  }
  const text = renderInjection([short], 9000)
  expect(text).toContain("[pitcrew]")
  expect(text).toContain("c-001.md")
  expect(text).toContain("src/auth.ts")
  expect(text).toContain("a3f2c01")
  expect(text).toContain("コメント本文A")

  const truncated = renderInjection([short, long], 9000)
  expect(truncated.length).toBeLessThanOrEqual(9000)
  expect(truncated).toContain("processed/")
  expect(truncated).toContain("c-002.md")
})

test("renderInjection は切り詰め注記より小さい上限も超えない", () => {
  const comment: PitcrewComment = {
    name: "c-001.md",
    file: "/tmp/x/c-001.md",
    urgency: "normal",
    paths: [],
    reviewId: null,
    base: null,
    body: "あ".repeat(100)
  }

  expect(renderInjection([comment], 10)).toHaveLength(10)
})
