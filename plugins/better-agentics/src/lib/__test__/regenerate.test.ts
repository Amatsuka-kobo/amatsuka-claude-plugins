import { describe, expect, it } from "vitest"
import { parseDocument } from "../document"
import { decodeRecord, encodeRecord, textHash } from "../hash"
import { classify, compare, merge } from "../regenerate"

function documentOf(options: {
  meta?: string[]
  record?: Record<string, string>
  description?: string
  preamble?: string
  sections: [string, string][]
}): string {
  const record = options.record
    ? {
        description: options.record.description,
        preamble: options.record.preamble,
        sections: Object.fromEntries(
          Object.entries(options.record).filter(([key]) =>
            key.startsWith("## ")
          )
        )
      }
    : undefined
  return [
    "---",
    "name: code-reviewer",
    `description: ${options.description ?? "変更差分のレビュー"}`,
    ...(options.meta ?? []),
    ...(record ? [`better-agentics-hash: ${encodeRecord(record)}`] : []),
    "---",
    "",
    options.preamble ?? "前置き",
    "",
    ...options.sections.flatMap(([heading, body]) => [heading, "", body, ""])
  ].join("\n")
}

const TEMPLATE = [
  "---",
  "name: code-reviewer",
  "description: 変更差分のレビュー",
  "model: sonnet",
  "effort: high",
  "tools: Read, Grep",
  "better-agentics-role: code-review",
  `better-agentics-hash: ${encodeRecord({
    description: textHash("変更差分のレビュー"),
    preamble: textHash("前置き"),
    sections: { "## A": textHash("a"), "## B": textHash("b") }
  })}`,
  "---",
  "",
  "前置き",
  "",
  "## A",
  "",
  "a",
  "",
  "## B",
  "",
  "b",
  ""
].join("\n")

describe("classify", () => {
  it("既存とテンプレートが同じなら記録の有無を問わず same", () => {
    expect(classify("x", " x ", undefined)).toBe("same")
    expect(classify("x", "x", textHash("y"))).toBe("same")
  })

  it("記録が無く違えば unknown", () => {
    expect(classify("x", "y", undefined)).toBe("unknown")
  })

  it("既存 = 記録 ≠ テンプレートなら templateChanged", () => {
    expect(classify("x", "y", textHash("x"))).toBe("templateChanged")
  })

  it("既存 ≠ 記録ならテンプレートとの関係を問わず userEdited", () => {
    expect(classify("x", "y", textHash("z"))).toBe("userEdited")
  })
})

describe("compare", () => {
  it("description・前置き・セクションを分類し、extra と new を返す", () => {
    const existing = documentOf({
      record: {
        description: textHash("変更差分のレビュー"),
        preamble: textHash("前置き"),
        "## A": textHash("a-old")
      },
      sections: [
        ["## A", "a-old"],
        ["## C", "c"]
      ]
    })
    const reports = compare(existing, TEMPLATE)
    expect(reports.map((report) => [report.key, report.state])).toEqual([
      ["description", "same"],
      ["preamble", "same"],
      ["## A", "templateChanged"],
      ["## B", "new"],
      ["## C", "extra"]
    ])
    expect(reports[2]).toMatchObject({ existing: "a-old", template: "a" })
    expect(reports[3]).not.toHaveProperty("existing")
  })
})

describe("merge", () => {
  const existing = documentOf({
    meta: [
      "model: opus",
      "color: blue",
      "agent-policy-role: code-review",
      "disallowedTools: mcp__x__write"
    ],
    record: { "## A": textHash("a-edited") },
    sections: [
      ["## A", "a-edited-again"],
      ["## B", "b-old"],
      ["## Extra", "extra"]
    ]
  })

  it("keep のセクションを既存の本文で保ち、extra を後ろに残す", () => {
    const result = merge({
      existingRaw: existing,
      templateRaw: TEMPLATE,
      keep: new Set(["## A"])
    })
    const document = parseDocument(result.content)
    expect([...document.sections]).toEqual([
      ["## A", "a-edited-again"],
      ["## B", "b"],
      ["## Extra", "extra"]
    ])
    expect(result.kept).toEqual(["## A", "## Extra"])
    expect(result.replaced).toContain("## B")
  })

  it("保持したキーには既存の記録を書き、記録の無い保持は記録から外す", () => {
    const result = merge({
      existingRaw: existing,
      templateRaw: TEMPLATE,
      keep: new Set(["## A", "preamble"])
    })
    const record = decodeRecord(
      parseDocument(result.content).meta.get("better-agentics-hash")
    )
    expect(record?.sections["## A"]).toBe(textHash("a-edited"))
    expect(record?.sections["## B"]).toBe(textHash("b"))
    expect(record?.preamble).toBeUndefined()
  })

  it("生成するキーはテンプレートの値、それ以外の既存のキーは後ろに残す", () => {
    const result = merge({
      existingRaw: existing,
      templateRaw: TEMPLATE,
      keep: new Set()
    })
    const document = parseDocument(result.content)
    expect(document.order).toEqual([
      "name",
      "description",
      "model",
      "effort",
      "tools",
      "better-agentics-role",
      "better-agentics-hash",
      "color",
      "agent-policy-role"
    ])
    expect(document.meta.get("model")).toBe("sonnet")
    expect(result.keysKept).toEqual(["color", "agent-policy-role"])
  })

  it("name は既存の値を残す", () => {
    const renamed = existing.replace(
      "name: code-reviewer",
      "name: docs-reviewer"
    )
    const result = merge({
      existingRaw: renamed,
      templateRaw: TEMPLATE,
      keep: new Set()
    })
    expect(parseDocument(result.content).meta.get("name")).toBe("docs-reviewer")
  })

  it("merge の後に compare すると置き換えたセクションは same になる", () => {
    const result = merge({
      existingRaw: existing,
      templateRaw: TEMPLATE,
      keep: new Set()
    })
    const states = compare(result.content, TEMPLATE)
      .filter(
        (report) => report.key.startsWith("## ") && report.key !== "## Extra"
      )
      .map((report) => report.state)
    expect(states).toEqual(["same", "same"])
  })
})
