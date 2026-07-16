import { execFileSync } from "node:child_process"
import fs from "node:fs"
import os from "node:os"
import path from "node:path"
import { fileURLToPath } from "node:url"
import { expect, test } from "vitest"
import { parseFrontmatter } from "../../lib/frontmatter.js"
import { runTs } from "../../testing/run-ts.js"

const HOOK = fileURLToPath(
  new URL("../capture-subagent-stop.ts", import.meta.url)
)

function git(dir: string, ...args: string[]): string {
  return execFileSync("git", args, { cwd: dir, encoding: "utf8" })
}

function makeRepo(): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "pitcrew-sstop-"))
  git(dir, "init", "-q")
  git(dir, "config", "user.email", "t@example.com")
  git(dir, "config", "user.name", "t")
  fs.writeFileSync(path.join(dir, "base.ts"), "const base = 1\n")
  git(dir, "add", "-A")
  git(dir, "commit", "-qm", "init")
  return dir
}

function runHook(dir: string, input: Record<string, unknown> = {}): string {
  return runTs(HOOK, [], {
    input: JSON.stringify({ cwd: dir, agent_type: "implementer", ...input }),
    env: { ...process.env, CLAUDE_PROJECT_DIR: dir }
  })
}

function reviewFiles(dir: string): string[] {
  const reviewDir = path.join(dir, ".pitcrew", "review")
  return fs.existsSync(reviewDir) ? fs.readdirSync(reviewDir).sort() : []
}

test("変更があると review/001 が作られ run.json が更新される", () => {
  const dir = makeRepo()
  try {
    fs.writeFileSync(path.join(dir, "feat.ts"), "export const f = 1\n")
    expect(runHook(dir).trim()).toBe("") // stdout 出力なし
    const files = reviewFiles(dir)
    expect(files).toHaveLength(1)
    expect(files[0]).toMatch(/^001-diff-/)
    const { data, body } = parseFrontmatter(
      fs.readFileSync(path.join(dir, ".pitcrew", "review", files[0]), "utf8")
    )
    expect(data.type).toBe("diff")
    expect(data.agent).toBe("implementer")
    expect(data.paths).toEqual(["feat.ts"])
    expect(body).toContain("+export const f = 1")
    const run = JSON.parse(
      fs.readFileSync(path.join(dir, ".pitcrew", "run.json"), "utf8")
    )
    expect(run.nextReviewId).toBe(2)
    expect(run.lastCaptureCommit).toBeTruthy()
    expect(run.lastCaptureAt).toBeTruthy()
  } finally {
    fs.rmSync(dir, { recursive: true, force: true })
  }
})

test("連続捕捉で diff が重複しない(2 回目の base は 1 回目の捕捉時点)", () => {
  const dir = makeRepo()
  try {
    fs.writeFileSync(path.join(dir, "a.ts"), "A\n")
    runHook(dir)
    fs.writeFileSync(path.join(dir, "b.ts"), "B\n")
    runHook(dir, { agent_type: "reviewer" })
    const files = reviewFiles(dir)
    expect(files).toHaveLength(2)
    const second = parseFrontmatter(
      fs.readFileSync(path.join(dir, ".pitcrew", "review", files[1]), "utf8")
    )
    expect(second.data.paths).toEqual(["b.ts"]) // a.ts を含まない
    expect(second.data.agent).toBe("reviewer")
  } finally {
    fs.rmSync(dir, { recursive: true, force: true })
  }
})

test("変更がなければ review 項目を作らない", () => {
  const dir = makeRepo()
  try {
    runHook(dir)
    expect(reviewFiles(dir)).toEqual([])
  } finally {
    fs.rmSync(dir, { recursive: true, force: true })
  }
})

test("git リポジトリでなくても exit 0 で何も書かない", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "pitcrew-nogit-"))
  try {
    expect(runHook(dir).trim()).toBe("")
    expect(fs.existsSync(path.join(dir, ".pitcrew", "review"))).toBe(false)
  } finally {
    fs.rmSync(dir, { recursive: true, force: true })
  }
})

test("壊れた stdin でも exit 0 で素通しする", () => {
  expect(runTs(HOOK, [], { input: "not json" }).trim()).toBe("")
})
