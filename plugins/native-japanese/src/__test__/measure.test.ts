import { execFileSync } from "node:child_process"
import fs from "node:fs"
import os from "node:os"
import path from "node:path"
import { fileURLToPath } from "node:url"
import { afterAll, beforeAll, expect, test } from "vitest"
import { runTs } from "../testing/run-ts.js"

const SCRIPT = fileURLToPath(new URL("../measure.ts", import.meta.url))
const TRANSCRIPTS = fileURLToPath(
  new URL("../fixtures/transcripts", import.meta.url)
)

interface Report {
  morph: { used: boolean; reason?: string }
  lines: number
  sentences: number
  violations: number
  per100Lines: number
  byRule: { ruleId: string; layer: string; count: number }[]
  byWriter?: { writer: string; lines: number; violations: number }[]
  examples: Record<string, { line: number; path?: string }[]>
}

function measure(args: string[], cwd?: string): Report {
  return JSON.parse(runTs(SCRIPT, [...args, "--format", "json"], { cwd }))
}

test("--transcripts で main と agentType ごとに行数と違反数を集計する", () => {
  const r = measure(["--transcripts", TRANSCRIPTS])
  expect(r.byWriter).toEqual([
    { writer: "main", lines: 4, violations: 3 },
    { writer: "general-implementer", lines: 3, violations: 2 }
  ])
  expect(r.lines).toBe(7)
  expect(r.violations).toBe(5)
})

test("--since より前の記録を数えない", () => {
  const r = measure(["--transcripts", TRANSCRIPTS, "--since", "2026-09-26"])
  expect(r.byWriter).toEqual([
    { writer: "main", lines: 3, violations: 2 },
    { writer: "general-implementer", lines: 3, violations: 2 }
  ])
  expect(r.byRule.find((b) => b.ruleId === "avoid:様々な")?.count).toBe(1)
})

test("--format json の出力が契約の形をすべて持つ", () => {
  const r = measure(["--transcripts", TRANSCRIPTS, "--data-dir", "/nowhere"])
  expect(Object.keys(r).sort()).toEqual(
    [
      "morph",
      "lines",
      "sentences",
      "violations",
      "per100Lines",
      "byRule",
      "byWriter",
      "examples"
    ].sort()
  )
  expect(r.morph.used).toBe(false)
  expect(typeof r.morph.reason).toBe("string")
  expect(r.sentences).toBe(0)
  expect(r.per100Lines).toBeCloseTo((5 / 7) * 100, 1)
  expect(r.byRule.map((b) => b.count)).toEqual(
    [...r.byRule.map((b) => b.count)].sort((a, b) => b - a)
  )
  expect(r.byRule.every((b) => b.layer === "regex")).toBe(true)
  expect(r.byRule.reduce((n, b) => n + b.count, 0)).toBe(5)
  expect(r.byRule.find((b) => b.ruleId === "koto-dekiru")?.count).toBe(2)
  for (const [id, vs] of Object.entries(r.examples)) {
    expect(r.byRule.some((b) => b.ruleId === id)).toBe(true)
    expect(vs.length).toBeGreaterThan(0)
    expect(vs.length).toBeLessThanOrEqual(3)
  }
})

let repo: string
const git = (...args: string[]) =>
  execFileSync("git", ["-c", "user.name=t", "-c", "user.email=t@t", ...args], {
    cwd: repo,
    encoding: "utf8"
  })
const write = (p: string, text: string) =>
  fs.writeFileSync(path.join(repo, p), text)

beforeAll(() => {
  repo = fs.mkdtempSync(path.join(os.tmpdir(), "native-japanese-measure-"))
  git("init", "-q")
  write("a.md", "既存の行で、様々な案がある。\n")
  write("c.md", "消すファイルで、様々な案がある。\n")
  write("x.html", "<p>既存で、ことが可能だ。</p>\n<p>空</p>\n")
  git("add", ".")
  git("commit", "-q", "-m", "1")
  write("a.md", "既存の行で、様々な案がある。\n新しい行で、ことが可能だ。\n")
  write(
    "b.md",
    "<!-- native-japanese: ignore-file -->\n\n目印のあるファイルで、ことが可能だ。\n"
  )
  fs.rmSync(path.join(repo, "c.md"))
  write(
    "x.html",
    "<p>既存で、ことが可能だ。</p>\n<p>新しく、ことが可能だ。</p>\n"
  )
  git("add", "-A")
  git("commit", "-q", "-m", "2")
})

afterAll(() => {
  fs.rmSync(repo, { recursive: true, force: true })
})

test("--git で加わった行だけを数え、既存の行と削除したファイルを数えない", () => {
  const r = measure(["--git", "HEAD~1..HEAD"], repo)
  expect(r.byWriter).toBeUndefined()
  expect(r.byRule).toEqual([
    { ruleId: "koto-dekiru", layer: "regex", count: 2 }
  ])
  expect(r.examples["koto-dekiru"]).toEqual([
    expect.objectContaining({ path: "a.md", line: 2 }),
    expect.objectContaining({ path: "x.html", line: 2 })
  ])
  expect(r.lines).toBe(2)
})

test("--git で先頭に目印を持つファイルを数えない", () => {
  const r = measure(["--git", "HEAD~1..HEAD"], repo)
  const paths = Object.values(r.examples)
    .flat()
    .map((v) => v.path)
  expect(paths).not.toContain("b.md")
  expect(r.violations).toBe(2)
})
