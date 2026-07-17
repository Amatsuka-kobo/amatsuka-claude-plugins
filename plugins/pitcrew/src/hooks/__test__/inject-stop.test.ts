import fs from "node:fs"
import os from "node:os"
import path from "node:path"
import { fileURLToPath } from "node:url"
import { expect, test } from "vitest"
import { runTs } from "../../testing/run-ts.js"

const HOOK = fileURLToPath(new URL("../inject-stop.ts", import.meta.url))

function makeProject(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), "pitcrew-inject-stop-"))
}

function writeComment(dir: string, name: string, content: string): void {
  const commentsDir = path.join(dir, ".pitcrew", "comments")
  fs.mkdirSync(commentsDir, { recursive: true })
  fs.writeFileSync(path.join(commentsDir, name), content)
}

function runHook(dir: string, input: Record<string, unknown> = {}): string {
  return runTs(HOOK, [], {
    input: JSON.stringify({ cwd: dir, ...input }),
    env: { ...process.env, CLAUDE_PROJECT_DIR: dir }
  })
}

test("normal と取り残し urgent をまとめて差し戻し、processed/ へ移動する", () => {
  const dir = makeProject()
  try {
    writeComment(
      dir,
      "c-001.md",
      "---\nurgency: urgent\npaths: [src/never-touched.ts]\n---\n緊急のやつ。\n"
    )
    writeComment(
      dir,
      "c-002.md",
      "---\nurgency: normal\npaths: [docs/design.md]\n---\n通常のやつ。\n"
    )
    const out = runHook(dir)
    const parsed = JSON.parse(out) as { decision: string; reason: string }
    expect(parsed.decision).toBe("block")
    expect(parsed.reason).toContain("緊急のやつ")
    expect(parsed.reason).toContain("通常のやつ")
    const commentsDir = path.join(dir, ".pitcrew", "comments")
    expect(fs.existsSync(path.join(commentsDir, "c-001.md"))).toBe(false)
    expect(fs.existsSync(path.join(commentsDir, "c-002.md"))).toBe(false)
    expect(fs.existsSync(path.join(commentsDir, "processed", "c-001.md"))).toBe(
      true
    )
    expect(fs.existsSync(path.join(commentsDir, "processed", "c-002.md"))).toBe(
      true
    )
  } finally {
    fs.rmSync(dir, { recursive: true, force: true })
  }
})

test("stop_hook_active: true では差し戻さずコメントも残す(無限ループ防止)", () => {
  const dir = makeProject()
  try {
    writeComment(
      dir,
      "c-001.md",
      "---\nurgency: normal\n---\n残るべきコメント。\n"
    )
    const out = runHook(dir, { stop_hook_active: true })
    expect(out.trim()).toBe("")
    expect(
      fs.existsSync(path.join(dir, ".pitcrew", "comments", "c-001.md"))
    ).toBe(true)
  } finally {
    fs.rmSync(dir, { recursive: true, force: true })
  }
})

test("未回収コメントが無ければ無出力で終了する", () => {
  const dir = makeProject()
  try {
    const out = runHook(dir)
    expect(out.trim()).toBe("")
  } finally {
    fs.rmSync(dir, { recursive: true, force: true })
  }
})

test("コメント無し+stop_hook_active: true でも無出力で終了する", () => {
  const dir = makeProject()
  try {
    const out = runHook(dir, { stop_hook_active: true })
    expect(out.trim()).toBe("")
  } finally {
    fs.rmSync(dir, { recursive: true, force: true })
  }
})

test("frontmatter の無い手書きコメントもターン境界で回収される", () => {
  const dir = makeProject()
  try {
    writeComment(dir, "c-001.md", "テンプレ無しの手書き。\n")
    const out = runHook(dir)
    const parsed = JSON.parse(out) as { decision: string; reason: string }
    expect(parsed.decision).toBe("block")
    expect(parsed.reason).toContain("手書き")
  } finally {
    fs.rmSync(dir, { recursive: true, force: true })
  }
})

test("不正な stdin では無出力で正常終了する(フェイルオープン)", () => {
  const dir = makeProject()
  try {
    const out = runTs(HOOK, [], {
      input: "not json",
      env: { ...process.env, CLAUDE_PROJECT_DIR: dir }
    })
    expect(out.trim()).toBe("")
  } finally {
    fs.rmSync(dir, { recursive: true, force: true })
  }
})
