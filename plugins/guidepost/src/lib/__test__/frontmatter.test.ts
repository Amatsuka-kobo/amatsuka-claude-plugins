import { expect, test } from "vitest"
import { parseFrontmatter, serializeFrontmatter } from "../frontmatter.js"

test("引用が必要な値をシリアライズして往復できる", () => {
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
