import fs from "node:fs"
import os from "node:os"
import path from "node:path"
import { afterAll, expect, test } from "vitest"
import { existingMentions, linkClaudeMd } from "../claude-md.js"

const tmpDirs: string[] = []
afterAll(() => {
  for (const dir of tmpDirs) fs.rmSync(dir, { recursive: true, force: true })
})

function mkTmp(files: Record<string, string> = {}): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "metatron-claude-md-"))
  tmpDirs.push(dir)
  for (const [rel, body] of Object.entries(files)) {
    fs.mkdirSync(path.dirname(path.join(dir, rel)), { recursive: true })
    fs.writeFileSync(path.join(dir, rel), body, "utf8")
  }
  return dir
}

const read = (dir: string, rel: string): string =>
  fs.readFileSync(path.join(dir, rel), "utf8")

const DOCS = ["docs/ARCHITECTURE.md", "docs/GOTCHAS.md"]

test("L1: CLAUDE.md が無ければ作り、@メンションだけを書く", () => {
  const dir = mkTmp()
  const result = linkClaudeMd(dir, DOCS)
  expect(result.created).toBe(true)
  expect(result.added).toStrictEqual(DOCS)
  expect(read(dir, "CLAUDE.md")).toBe(
    "@docs/ARCHITECTURE.md\n@docs/GOTCHAS.md\n"
  )
})

test("L2: 既存の本文は変えず、空行 1 行を挟んで末尾に足す。2 回目は何も足さない", () => {
  const dir = mkTmp({ "CLAUDE.md": "# 概要\n\n本文\n\n\n" })
  linkClaudeMd(dir, DOCS)
  expect(read(dir, "CLAUDE.md")).toBe(
    "# 概要\n\n本文\n\n@docs/ARCHITECTURE.md\n@docs/GOTCHAS.md\n"
  )
  const again = linkClaudeMd(dir, DOCS)
  expect(again.added).toStrictEqual([])
  expect(again.present).toStrictEqual(DOCS)
})

test("L3: 本文中の言及は @メンションと数えず、行頭の 1 語だけを数える", () => {
  const dir = mkTmp({
    "CLAUDE.md": "詳細は @docs/ARCHITECTURE.md を読む。\n@docs/GOTCHAS.md\n"
  })
  const result = linkClaudeMd(dir, DOCS)
  expect(result.added).toStrictEqual(["docs/ARCHITECTURE.md"])
  expect(result.present).toStrictEqual(["docs/GOTCHAS.md"])
})

test("L5: 空白・制御文字を含むパスは拒否し、CLAUDE.md を作らない", () => {
  for (const bad of ["docs/A B.md", "docs/A.md\n# 注入", "docs/\tA.md"]) {
    const dir = mkTmp()
    expect(() => linkClaudeMd(dir, [bad]), bad).toThrow()
    expect(fs.existsSync(path.join(dir, "CLAUDE.md")), bad).toBe(false)
  }
})

test("L4: .claude/CLAUDE.md だけがあればそこへ ../ 付きで書き、既存の ../ も認める", () => {
  const dir = mkTmp({ ".claude/CLAUDE.md": "@../docs/GOTCHAS.md\n" })
  const result = linkClaudeMd(dir, DOCS)
  expect(result.path).toBe(path.join(dir, ".claude/CLAUDE.md"))
  expect(result.added).toStrictEqual(["docs/ARCHITECTURE.md"])
  expect(read(dir, ".claude/CLAUDE.md")).toBe(
    "@../docs/GOTCHAS.md\n\n@../docs/ARCHITECTURE.md\n"
  )
  expect(existingMentions(dir)).toStrictEqual(new Set(DOCS))
  expect(fs.existsSync(path.join(dir, "CLAUDE.md"))).toBe(false)
})
