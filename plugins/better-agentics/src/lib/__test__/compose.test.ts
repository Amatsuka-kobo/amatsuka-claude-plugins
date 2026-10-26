import fs from "node:fs"
import os from "node:os"
import path from "node:path"
import { fileURLToPath } from "node:url"
import { afterEach, beforeEach, describe, expect, it } from "vitest"
import { type ComposeInput, compose } from "../compose"
import { parseDocument } from "../document"
import { decodeRecord, textHash } from "../hash"

const ROOT = fileURLToPath(new URL("../../../", import.meta.url))
let project: string

beforeEach(() => {
  project = fs.mkdtempSync(path.join(os.tmpdir(), "better-agentics-"))
})

afterEach(() => {
  fs.rmSync(project, { recursive: true, force: true })
})

function input(overrides: Partial<ComposeInput> = {}): ComposeInput {
  return {
    name: "code-reviewer",
    roleId: "code-review",
    model: "sonnet",
    effort: "high",
    lang: "ja",
    pluginRoot: ROOT,
    projectDir: project,
    mcpTools: [],
    denyTools: [],
    ...overrides
  }
}

describe("compose", () => {
  it("frontmatter を設計書 §10 の順で書く", () => {
    const document = parseDocument(compose(input()))
    expect(document.order).toEqual([
      "name",
      "description",
      "model",
      "effort",
      "tools",
      "better-agentics-role",
      "better-agentics-hash"
    ])
    expect(document.meta.get("name")).toBe("code-reviewer")
    expect(document.meta.get("description")).toBe("変更差分のレビュー")
    expect(document.meta.get("model")).toBe("sonnet")
    expect(document.meta.get("effort")).toBe("high")
    expect(document.meta.get("tools")).toBe("Read, Grep, Glob, Bash")
    expect(document.meta.get("better-agentics-role")).toBe("code-review")
    expect(document.meta.has("color")).toBe(false)
  })

  it("effort が undefined なら effort 行を書かない", () => {
    expect(
      parseDocument(compose(input({ effort: undefined }))).meta.has("effort")
    ).toBe(false)
  })

  it("MCP のツールを tools の末尾に足し、denyTools があれば disallowedTools を書く", () => {
    const document = parseDocument(
      compose(
        input({
          mcpTools: ["mcp__serena"],
          denyTools: ["mcp__serena__replace_content"]
        })
      )
    )
    expect(document.meta.get("tools")).toBe(
      "Read, Grep, Glob, Bash, mcp__serena"
    )
    expect(document.meta.get("disallowedTools")).toBe(
      "mcp__serena__replace_content"
    )
    expect(document.order.indexOf("disallowedTools")).toBe(
      document.order.indexOf("tools") + 1
    )
  })

  it("前置きに名前と役割名を、括弧で囲まずに書く", () => {
    expect(parseDocument(compose(input())).preamble).toBe(
      "あなたは code-reviewer。担う役割はコードレビューである。"
    )
    expect(parseDocument(compose(input({ lang: "en" }))).preamble).toBe(
      "You are code-reviewer. Your role is Code Review."
    )
  })

  it("本文の見出しを語彙の順に並べる", () => {
    expect([...parseDocument(compose(input())).sections.keys()]).toEqual([
      "## When to invoke",
      "## Core Responsibilities",
      "## 作業手順",
      "## 制約",
      "## Output Format"
    ])
  })

  it("better-agentics-hash に description・前置き・各セクションのハッシュを記録する", () => {
    const document = parseDocument(compose(input()))
    const record = decodeRecord(document.meta.get("better-agentics-hash"))
    expect(record?.description).toBe(
      textHash(document.meta.get("description") ?? "")
    )
    expect(record?.preamble).toBe(textHash(document.preamble))
    expect(Object.keys(record?.sections ?? {})).toEqual([
      ...document.sections.keys()
    ])
    for (const [heading, body] of document.sections) {
      expect(record?.sections[heading]).toBe(textHash(body))
    }
  })
})
