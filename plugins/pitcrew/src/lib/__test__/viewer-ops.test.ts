import fs from "node:fs"
import os from "node:os"
import path from "node:path"
import { expect, test } from "vitest"
import { approveItem, approveItems, writeComment } from "../viewer-ops.js"

function makeProject(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), "pitcrew-ops-"))
}

test("approveItem は review/ から reviewed/ へ移動する", () => {
  const dir = makeProject()
  try {
    const review = path.join(dir, ".pitcrew", "review")
    fs.mkdirSync(review, { recursive: true })
    fs.writeFileSync(path.join(review, "001-diff-x.md"), "内容")
    expect(approveItem(dir, "001-diff-x.md")).toBe(true)
    expect(fs.existsSync(path.join(review, "001-diff-x.md"))).toBe(false)
    expect(
      fs.readFileSync(
        path.join(dir, ".pitcrew", "reviewed", "001-diff-x.md"),
        "utf8"
      )
    ).toBe("内容")
  } finally {
    fs.rmSync(dir, { recursive: true, force: true })
  }
})

test("approveItem は無いファイル・不正な名前で false", () => {
  const dir = makeProject()
  try {
    expect(approveItem(dir, "nope.md")).toBe(false)
    expect(approveItem(dir, "../run.json")).toBe(false)
  } finally {
    fs.rmSync(dir, { recursive: true, force: true })
  }
})

test("writeComment は frontmatter 付き c-NNN.md を書く", () => {
  const dir = makeProject()
  try {
    const name = writeComment(dir, {
      body: "validate() を使ってください。",
      urgency: "urgent",
      paths: ["src/auth.ts"],
      reviewId: "002",
      base: "aaa1111"
    })
    expect(name).toBe("c-001.md")
    const raw = fs.readFileSync(
      path.join(dir, ".pitcrew", "comments", "c-001.md"),
      "utf8"
    )
    expect(raw).toContain("urgency: urgent")
    expect(raw).toContain("paths: [src/auth.ts]")
    expect(raw).toContain('reviewId: "002"')
    expect(raw).toContain("base: aaa1111")
    expect(raw).toContain("validate() を使ってください。")
  } finally {
    fs.rmSync(dir, { recursive: true, force: true })
  }
})

test("採番は comments/ と processed/ の最大番号 + 1", () => {
  const dir = makeProject()
  try {
    const comments = path.join(dir, ".pitcrew", "comments")
    fs.mkdirSync(path.join(comments, "processed"), { recursive: true })
    fs.writeFileSync(path.join(comments, "c-002.md"), "x")
    fs.writeFileSync(path.join(comments, "processed", "c-005.md"), "y")
    const name = writeComment(dir, {
      body: "次のコメント",
      urgency: "normal",
      paths: [],
      reviewId: null,
      base: null
    })
    expect(name).toBe("c-006.md")
  } finally {
    fs.rmSync(dir, { recursive: true, force: true })
  }
})

test("body が空白のみなら書かず null", () => {
  const dir = makeProject()
  try {
    expect(
      writeComment(dir, {
        body: "  \n",
        urgency: "normal",
        paths: [],
        reviewId: null,
        base: null
      })
    ).toBeNull()
    expect(
      fs.existsSync(path.join(dir, ".pitcrew", "comments", "c-001.md"))
    ).toBe(false)
  } finally {
    fs.rmSync(dir, { recursive: true, force: true })
  }
})

test("paths が空なら frontmatter に paths を出さない", () => {
  const dir = makeProject()
  try {
    writeComment(dir, {
      body: "全体コメント",
      urgency: "normal",
      paths: [],
      reviewId: null,
      base: null
    })
    const raw = fs.readFileSync(
      path.join(dir, ".pitcrew", "comments", "c-001.md"),
      "utf8"
    )
    expect(raw).not.toContain("paths:")
    expect(raw).toContain("urgency: normal")
  } finally {
    fs.rmSync(dir, { recursive: true, force: true })
  }
})

test("approveItems は複数項目を reviewed/ へ移動する", () => {
  const dir = makeProject()
  try {
    const review = path.join(dir, ".pitcrew", "review")
    fs.mkdirSync(review, { recursive: true })
    fs.writeFileSync(path.join(review, "001-diff-a.md"), "a")
    fs.writeFileSync(path.join(review, "002-diff-b.md"), "b")
    const result = approveItems(dir, ["001-diff-a.md", "002-diff-b.md"])
    expect(result.moved).toEqual(["001-diff-a.md", "002-diff-b.md"])
    expect(result.failed).toEqual([])
    expect(fs.existsSync(path.join(review, "001-diff-a.md"))).toBe(false)
    expect(
      fs.existsSync(path.join(dir, ".pitcrew", "reviewed", "002-diff-b.md"))
    ).toBe(true)
  } finally {
    fs.rmSync(dir, { recursive: true, force: true })
  }
})

test("approveItems は失敗を failed に積み残りを続行する(フェイルオープン)", () => {
  const dir = makeProject()
  try {
    const review = path.join(dir, ".pitcrew", "review")
    fs.mkdirSync(review, { recursive: true })
    fs.writeFileSync(path.join(review, "002-diff-ok.md"), "ok")
    const result = approveItems(dir, [
      "../run.json", // 不正な名前
      "001-diff-nope.md", // 存在しない
      "002-diff-ok.md" // 正常
    ])
    expect(result.moved).toEqual(["002-diff-ok.md"])
    expect(result.failed).toEqual(["../run.json", "001-diff-nope.md"])
    expect(
      fs.existsSync(path.join(dir, ".pitcrew", "reviewed", "002-diff-ok.md"))
    ).toBe(true)
  } finally {
    fs.rmSync(dir, { recursive: true, force: true })
  }
})

test("approveItems は空配列で moved も failed も空", () => {
  const dir = makeProject()
  try {
    expect(approveItems(dir, [])).toEqual({ moved: [], failed: [] })
  } finally {
    fs.rmSync(dir, { recursive: true, force: true })
  }
})
