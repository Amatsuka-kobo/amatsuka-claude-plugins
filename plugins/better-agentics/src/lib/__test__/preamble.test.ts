import fs from "node:fs"
import os from "node:os"
import path from "node:path"
import { afterEach, beforeEach, describe, expect, it } from "vitest"
import { pluginRoot, scaffoldFragments } from "../fragments"
import {
  forkPreamble,
  type PreambleContext,
  standardPreamble
} from "../preamble"
import { ROLES } from "../roles"

const FORBIDDEN =
  /codiel|declined|wait-add|test-spec|test-code|test-loop|fix-loop|intent-sync|dev-plan|triage|finalize|Raguel|Epic/
let project: string
let policy: string

beforeEach(() => {
  project = fs.mkdtempSync(path.join(os.tmpdir(), "better-agentics-"))
  policy = fs
    .readFileSync(
      path.join(pluginRoot(), "references", "subagent-policy.md"),
      "utf8"
    )
    .trim()
})

afterEach(() => {
  fs.rmSync(project, { recursive: true, force: true })
})

function context(lang: string): PreambleContext {
  return { pluginRoot: pluginRoot(), projectDir: project, lang }
}

function frDir(): string {
  return path.join(project, ".claude", "better-agentics", "roles", "fr")
}

function makeStale(name: string): void {
  const file = path.join(frDir(), name)
  fs.writeFileSync(
    file,
    fs
      .readFileSync(file, "utf8")
      .replace(/^source-hash: .*$/m, "source-hash: 0000")
  )
}

function markTranslated(name: string, marker: string): void {
  const file = path.join(frDir(), name)
  fs.writeFileSync(
    file,
    fs
      .readFileSync(file, "utf8")
      .replace(/^(## Core Responsibilities|## Preamble)$/m, `$1\n\n${marker}`)
  )
}

describe("standardPreamble", () => {
  it("ja は役割の行・When to invoke 以外のセクション・規律の全文をこの順で含む", () => {
    const text = standardPreamble("code-review", context("ja"))
    const order = [
      "あなたは code-reviewer。担う役割はコードレビューである。役割 ID: code-review",
      "## Core Responsibilities",
      "## 作業手順",
      "## 制約",
      "## Output Format",
      policy
    ].map((part) => text.indexOf(part))
    expect(order.every((index) => index >= 0)).toBe(true)
    expect([...order].sort((a, b) => a - b)).toEqual(order)
  })

  it("ja・en とも When to invoke を含まない", () => {
    for (const lang of ["ja", "en"]) {
      expect(standardPreamble("code-review", context(lang))).not.toContain(
        "## When to invoke"
      )
    }
  })

  it("en は en の断片と ja の規律を使う", () => {
    const text = standardPreamble("code-review", context("en"))
    expect(text).toContain(
      "You are code-reviewer. Your role is Code Review. Role ID: code-review"
    )
    expect(text).toContain("## Procedure")
    expect(text).toContain(policy)
  })

  it("翻訳断片が無い言語は全体を en で組み立てる", () => {
    expect(standardPreamble("code-review", context("fr"))).toBe(
      standardPreamble("code-review", context("en"))
    )
  })

  it("役割の翻訳が ready でも _common.md の翻訳が無ければ全体を en にする", () => {
    scaffoldFragments(pluginRoot(), project, "fr")
    markTranslated("code-review.md", "- FR-ROLE")
    fs.rmSync(path.join(frDir(), "_common.md"))
    const text = standardPreamble("code-review", context("fr"))
    expect(text).not.toContain("FR-ROLE")
    expect(text).toBe(standardPreamble("code-review", context("en")))
  })

  it("役割と _common.md の翻訳がどちらも ready なら訳を使う", () => {
    scaffoldFragments(pluginRoot(), project, "fr")
    markTranslated("code-review.md", "- FR-ROLE")
    markTranslated("_common.md", "FR-COMMON")
    const text = standardPreamble("code-review", context("fr"))
    expect(text).toContain("FR-ROLE")
    expect(text).toContain("FR-COMMON")
  })

  it.each([
    "code-review.md",
    "_common.md"
  ])("%s の翻訳が stale なら全体を en にする", (name) => {
    scaffoldFragments(pluginRoot(), project, "fr")
    markTranslated("code-review.md", "- FR-ROLE")
    markTranslated("_common.md", "FR-COMMON")
    makeStale(name)
    expect(standardPreamble("code-review", context("fr"))).toBe(
      standardPreamble("code-review", context("en"))
    )
  })

  it("13 役割すべての前置きに禁止語を含まない", () => {
    for (const role of ROLES) {
      for (const lang of ["ja", "en"]) {
        expect(standardPreamble(role.id, context(lang))).not.toMatch(FORBIDDEN)
      }
    }
  })
})

describe("forkPreamble", () => {
  it("依頼文の作業だけを行う指示・役割 ID・Output Format・規律を含む", () => {
    const text = forkPreamble("normal-impl", context("ja"))
    expect(text).toContain("依頼文の作業だけを行う")
    expect(text).toContain("役割 ID: normal-impl")
    expect(text).toContain("## Output Format")
    expect(text).toContain(policy)
  })

  it("Core Responsibilities と When to invoke を含まない", () => {
    for (const lang of ["ja", "en"]) {
      const text = forkPreamble("normal-impl", context(lang))
      expect(text).not.toContain("## Core Responsibilities")
      expect(text).not.toContain("## When to invoke")
    }
  })

  it("en は英語の指示と Role ID を使う", () => {
    const text = forkPreamble("general", context("en"))
    expect(text).toContain("Role ID: general")
    expect(text).toContain("Agent tool")
  })

  it("fork の 3 役割の前置きに禁止語を含まない", () => {
    for (const id of ["complex-impl", "normal-impl", "general"] as const) {
      for (const lang of ["ja", "en", "fr"]) {
        expect(forkPreamble(id, context(lang))).not.toMatch(FORBIDDEN)
      }
    }
  })
})
