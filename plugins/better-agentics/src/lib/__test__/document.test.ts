import { describe, expect, it } from "vitest"
import {
  duplicateHeadings,
  parseDocument,
  render,
  sectionBody
} from "../document"

const SAMPLE = [
  "---",
  "name: code-reviewer",
  "description: a: b",
  "hooks:",
  "  PreToolUse:",
  "    - matcher: Bash",
  "model: sonnet",
  "---",
  "",
  "前置きの文。",
  "",
  "## When to invoke",
  "",
  "- first",
  "",
  "## 作業手順",
  "",
  "- 手順",
  ""
].join("\n")

describe("parseDocument", () => {
  it("frontmatter のキーの順と値を、最初の `: ` で分けて読む", () => {
    const document = parseDocument(SAMPLE)
    expect(document.order).toEqual(["name", "description", "hooks", "model"])
    expect(document.meta.get("description")).toBe("a: b")
  })

  it("block 値は字下げされた後続行を含めて 1 つの値として保つ", () => {
    const document = parseDocument(SAMPLE)
    expect(document.meta.get("hooks")).toBe(
      "\n  PreToolUse:\n    - matcher: Bash"
    )
  })

  it("前置きと各セクションの本文を trim して読む", () => {
    const document = parseDocument(SAMPLE)
    expect(document.preamble).toBe("前置きの文。")
    expect([...document.sections.keys()]).toEqual([
      "## When to invoke",
      "## 作業手順"
    ])
    expect(document.sections.get("## 作業手順")).toBe("- 手順")
  })
})

describe("render", () => {
  it("frontmatter・前置き・セクションの順と本文を保って組み立て直す", () => {
    expect(render(parseDocument(SAMPLE))).toBe(SAMPLE)
  })
})

describe("sectionBody", () => {
  const body = "## A\n\n- first\n\n## B\n\nx\n\n## A\n\n- second\n"

  it("同じ見出しが 2 回あれば最初の配下だけを返す", () => {
    expect(sectionBody(body, "## A")).toBe("- first")
  })

  it("見出しが無ければ undefined を返す", () => {
    expect(sectionBody(body, "## C")).toBeUndefined()
  })
})

describe("duplicateHeadings", () => {
  it("2 回以上現れる見出しを返す", () => {
    expect(
      duplicateHeadings(
        "---\nname: x\n---\n\n## When to invoke\n\na\n\n## When to invoke\n\nb\n"
      )
    ).toEqual(["## When to invoke"])
  })

  it("重複が無ければ空を返す", () => {
    expect(duplicateHeadings(SAMPLE)).toEqual([])
  })
})
