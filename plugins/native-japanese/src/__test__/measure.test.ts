import { execFileSync } from "node:child_process"
import fs from "node:fs"
import os from "node:os"
import path from "node:path"
import { fileURLToPath } from "node:url"
import { afterAll, beforeAll, describe, expect, test } from "vitest"
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

// 実行する側の環境に形態素解析の設定があっても結果が変わらないよう、2 つの変数を外して渡す
function measure(
  args: string[],
  cwd?: string,
  env: Record<string, string> = {}
): Report {
  const {
    CLAUDE_PLUGIN_DATA: _d,
    AMATSUKA_NATIVE_JAPANESE_MORPH: _m,
    ...rest
  } = process.env
  return JSON.parse(
    runTs(SCRIPT, [...args, "--format", "json"], {
      cwd,
      env: { ...rest, ...env }
    })
  )
}

const FIXTURE: { text: string }[] = JSON.parse(
  fs.readFileSync(
    new URL("../fixtures/morph/tokens.json", import.meta.url),
    "utf8"
  )
)
// sentences.txt の n 行目(1 始まり)
const sentence = (n: number) => (FIXTURE[n - 1] as { text: string }).text

// lindera の .node の代わりに src/testing/fake-lindera.cjs を読み込ませるデータディレクトリを作る
function fakeDataDir(): string {
  const data = fs.mkdtempSync(path.join(os.tmpdir(), "native-japanese-data-"))
  const dir = path.join(data, "morph", "lindera-6.2.0")
  fs.mkdirSync(dir, { recursive: true })
  const stub = fileURLToPath(
    new URL("../testing/fake-lindera.cjs", import.meta.url)
  )
  fs.writeFileSync(
    path.join(dir, "ready.json"),
    JSON.stringify({
      version: "6.2.0",
      target: "test",
      node: path.relative(dir, stub),
      dict: "ipadic",
      files: {}
    })
  )
  return data
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

describe("形態素解析の層", () => {
  let data: string
  let repo2: string
  let logs: string
  const git2 = (...args: string[]) =>
    execFileSync(
      "git",
      ["-c", "user.name=t", "-c", "user.email=t@t", ...args],
      { cwd: repo2, encoding: "utf8" }
    )
  const write2 = (p: string, text: string) =>
    fs.writeFileSync(path.join(repo2, p), text)

  beforeAll(() => {
    data = fakeDataDir()
    repo2 = fs.mkdtempSync(path.join(os.tmpdir(), "native-japanese-morph-"))
    git2("init", "-q")
    write2("a.md", `${sentence(1)}\n`)
    write2("x.html", `<p>${sentence(1)}</p>\n`)
    git2("add", ".")
    git2("commit", "-q", "-m", "1")
    // 既存の文の違反は数えず、加わった文の違反だけを数える
    write2("a.md", `${sentence(1)}\n\n${sentence(3)}\n`)
    write2("x.html", `<p>${sentence(1)}</p>\n<p>${sentence(3)}</p>\n`)
    git2("add", "-A")
    git2("commit", "-q", "-m", "2")

    logs = fs.mkdtempSync(path.join(os.tmpdir(), "native-japanese-logs-"))
    const rec = (ts: string, file: string, content: string) =>
      JSON.stringify({
        type: "assistant",
        timestamp: ts,
        message: {
          role: "assistant",
          content: [
            {
              type: "tool_use",
              name: "Write",
              input: { file_path: file, content }
            }
          ]
        }
      })
    fs.writeFileSync(
      path.join(logs, "s.jsonl"),
      [
        rec("2026-09-25T00:00:00.000Z", "/r/old.md", `${sentence(1)}\n`),
        rec("2026-09-26T00:00:00.000Z", "/r/new.md", `${sentence(11)}\n`)
      ].join("\n")
    )
  })

  afterAll(() => {
    for (const d of [data, repo2, logs])
      fs.rmSync(d, { recursive: true, force: true })
  })

  test("--data-dir を渡すと AMATSUKA_NATIVE_JAPANESE_MORPH=off でも形態素解析を使う", () => {
    const r = measure(["--git", "HEAD~1..HEAD", "--data-dir", data], repo2, {
      AMATSUKA_NATIVE_JAPANESE_MORPH: "off"
    })
    expect(r.morph).toEqual({ used: true })
  })

  test("--data-dir が無ければ CLAUDE_PLUGIN_DATA を使い、off なら使わない", () => {
    const env = { CLAUDE_PLUGIN_DATA: data }
    expect(measure(["--git", "HEAD~1..HEAD"], repo2, env).morph.used).toBe(true)
    const off = measure(["--git", "HEAD~1..HEAD"], repo2, {
      ...env,
      AMATSUKA_NATIVE_JAPANESE_MORPH: "off"
    })
    expect(off.morph.used).toBe(false)
    expect(off.byRule).toEqual([])
  })

  test("--git で、加わった行と重なる形態素解析の違反と文だけを数える", () => {
    const r = measure(["--git", "HEAD~1..HEAD", "--data-dir", data], repo2)
    expect(r.byRule).toEqual([
      { ruleId: "muse-shugo", layer: "morph", count: 2 }
    ])
    // a.md も x.html も、3 行目・2 行目に加わった文の違反だけが残る
    expect(r.examples["muse-shugo"]).toEqual([
      expect.objectContaining({ path: "a.md", line: 3, endLine: 3 }),
      expect.objectContaining({ path: "x.html", line: 2, endLine: 2 })
    ])
    expect(r.sentences).toBe(2)
  })

  test("--transcripts と --since で、その日以降の本文の違反と文だけを数える", () => {
    const all = measure(["--transcripts", logs, "--data-dir", data])
    expect(all.byRule.map((b) => [b.ruleId, b.count])).toEqual([
      ["bunmatsu-renzoku", 1],
      ["muse-shugo", 1]
    ])
    expect(all.sentences).toBe(5)
    const since = measure([
      "--transcripts",
      logs,
      "--since",
      "2026-09-26",
      "--data-dir",
      data
    ])
    expect(since.byRule).toEqual([
      { ruleId: "bunmatsu-renzoku", layer: "morph", count: 1 }
    ])
    expect(since.sentences).toBe(4)
  })

  test("取得物の無いディレクトリでは使わず、理由を書く", () => {
    const r = measure(
      ["--git", "HEAD~1..HEAD", "--data-dir", "/nowhere"],
      repo2
    )
    expect(r.morph.used).toBe(false)
    expect(r.morph.reason).toBeTruthy()
    expect(r.sentences).toBe(0)
  })
})
