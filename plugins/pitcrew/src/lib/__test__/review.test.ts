import fs from "node:fs"
import os from "node:os"
import path from "node:path"
import { expect, test } from "vitest"
import { parseFrontmatter } from "../frontmatter.js"
import { renderReviewItem, slugify, writeReviewItem } from "../review.js"
import type { RunState } from "../run.js"

const NOW = new Date("2026-07-16T14:23:05.000Z")

function baseRun(): RunState {
  return {
    startedAt: "2026-07-16T00:00:00.000Z",
    lastCaptureCommit: null,
    lastCaptureAt: null,
    nextReviewId: 2
  }
}

const item = {
  type: "diff" as const,
  title: "auth.ts ほか 1 ファイルの diff",
  agent: "implementer#2",
  paths: ["src/auth.ts", "src/auth.test.ts"],
  base: "a3f2c01",
  head: "7be90d4",
  body: "```diff\n-const a = 1\n+const a = 2\n```\n"
}

test("frontmatter に設計書 §4 のメタデータが入る", () => {
  const text = renderReviewItem("002", item, NOW)
  const { data, body } = parseFrontmatter(text)
  expect(data.id).toBe("002")
  expect(data.type).toBe("diff")
  expect(data.agent).toBe("implementer#2")
  expect(data.created).toBe("2026-07-16T14:23:05.000Z")
  expect(data.base).toBe("a3f2c01")
  expect(data.head).toBe("7be90d4")
  expect(data.paths).toEqual(["src/auth.ts", "src/auth.test.ts"])
  expect(body).toContain("# auth.ts ほか 1 ファイルの diff")
  expect(body).toContain("+const a = 2")
})

test("末尾にコメントテンプレート(urgency/paths/reviewId/base 入り)が付く", () => {
  const text = renderReviewItem("002", item, NOW)
  expect(text).toContain("urgency: normal")
  expect(text).toContain('reviewId: "002"')
  expect(text).toContain(".pitcrew/comments/")
})

test("本文が 600 行を超えると切り詰めて注記する", () => {
  const long = { ...item, body: Array(1000).fill("line").join("\n") }
  const text = renderReviewItem("002", long, NOW)
  expect(text.split("\n").length).toBeLessThan(700)
  expect(text).toContain("省略")
})

test("base/head が null の場合は frontmatter から省く", () => {
  const text = renderReviewItem("003", { ...item, base: null, head: null }, NOW)
  const { data } = parseFrontmatter(text)
  expect(data.base).toBeUndefined()
  expect(data.head).toBeUndefined()
})

test("writeReviewItem が採番・書き込みし、新しい RunState を返す", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "pitcrew-review-"))
  try {
    const res = writeReviewItem(dir, baseRun(), item)
    expect(res.id).toBe("002")
    expect(path.basename(res.file)).toBe("002-diff-auth-ts.md")
    expect(res.run.nextReviewId).toBe(3)
    const written = fs.readFileSync(
      path.join(dir, ".pitcrew", "review", "002-diff-auth-ts.md"),
      "utf8"
    )
    expect(parseFrontmatter(written).data.id).toBe("002")
  } finally {
    fs.rmSync(dir, { recursive: true, force: true })
  }
})

test("slugify は英数字以外を - に潰す", () => {
  expect(slugify("src/auth.ts")).toBe("src-auth-ts")
  expect(slugify("テスト結果")).toBe("item")
})
