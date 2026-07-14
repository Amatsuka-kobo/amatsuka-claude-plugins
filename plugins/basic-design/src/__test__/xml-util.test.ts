import { expect, test } from "vitest"
import { escapeXml } from "../xml-util.js"

test("escapeXml: XML 特殊文字 5 種をすべてエスケープする", () => {
  expect(escapeXml(`<a & "b" 'c'>`)).toBe(
    "&lt;a &amp; &quot;b&quot; &apos;c&apos;&gt;"
  )
})

test("escapeXml: 特殊文字を含まない文字列はそのまま返す", () => {
  expect(escapeXml("users テーブル")).toBe("users テーブル")
})

test("escapeXml: 非文字列は文字列化して処理する", () => {
  expect(escapeXml(123)).toBe("123")
})
