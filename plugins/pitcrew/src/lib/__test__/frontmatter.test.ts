import { expect, test } from "vitest"
import { parseFrontmatter, serializeFrontmatter } from "../frontmatter.js"

test("スカラーと配列をシリアライズできる", () => {
  const out = serializeFrontmatter({
    id: "002",
    type: "diff",
    paths: ["src/auth.ts", "src/auth.test.ts"]
  })
  expect(out.split("\n")[0]).toBe("---")
  expect(out.split("\n").at(-1)).toBe("---")
  expect(out).toContain("type: diff")
  expect(out).toContain("paths: [src/auth.ts, src/auth.test.ts]")
})

test("シリアライズ→パースで往復できる(コロン含む値も壊れない)", () => {
  const src = serializeFrontmatter({
    id: "002",
    created: "2026-07-16T14:23:05.000Z",
    agent: "implementer#2",
    paths: ["docs/a.md"]
  })
  const { data, body } = parseFrontmatter(`${src}\n本文です\n`)
  expect(data.id).toBe("002")
  expect(data.created).toBe("2026-07-16T14:23:05.000Z")
  expect(data.agent).toBe("implementer#2")
  expect(data.paths).toEqual(["docs/a.md"])
  expect(body).toBe("本文です\n")
})

test("frontmatter がないテキストは data 空・全文 body", () => {
  const { data, body } = parseFrontmatter("# 見出し\n本文\n")
  expect(data).toEqual({})
  expect(body).toBe("# 見出し\n本文\n")
})

test("空配列をパースできる", () => {
  const { data } = parseFrontmatter("---\npaths: []\n---\n")
  expect(data.paths).toEqual([])
})

test("Stage 2 のコメント frontmatter を解析できる", () => {
  const text = [
    "---",
    "urgency: urgent",
    "paths: [src/auth.ts]",
    'reviewId: "002"',
    "base: a3f2c01",
    "---",
    "この方針はやめてください"
  ].join("\n")
  const { data, body } = parseFrontmatter(text)
  expect(data.urgency).toBe("urgent")
  expect(data.paths).toEqual(["src/auth.ts"])
  expect(data.reviewId).toBe("002")
  expect(data.base).toBe("a3f2c01")
  expect(body).toBe("この方針はやめてください")
})

test("unquoted 値の末尾空白を trim する(手書きコメント対策)", () => {
  const { data } = parseFrontmatter("---\nurgency: urgent  \n---\n本文\n")
  expect(data.urgency).toBe("urgent")
})

test("末尾に空白のあるインライン配列も解釈できる", () => {
  const { data } = parseFrontmatter(
    "---\npaths: [src/a.ts, src/b.ts] \n---\nx\n"
  )
  expect(data.paths).toEqual(["src/a.ts", "src/b.ts"])
})
