import fs from "node:fs"
import os from "node:os"
import path from "node:path"
import { fileURLToPath } from "node:url"
import { expect, test } from "vitest"
import { runTs } from "../../testing/run-ts.js"

const HOOK = fileURLToPath(
  new URL("../inject-pre-tool-use.ts", import.meta.url)
)

function makeProject(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), "pitcrew-inject-pre-"))
}

function writeComment(dir: string, name: string, content: string): void {
  const commentsDir = path.join(dir, ".pitcrew", "comments")
  fs.mkdirSync(commentsDir, { recursive: true })
  fs.writeFileSync(path.join(commentsDir, name), content)
}

function runHook(dir: string, input: Record<string, unknown>): string {
  return runTs(HOOK, [], {
    input: JSON.stringify({ cwd: dir, ...input }),
    env: { ...process.env, CLAUDE_PROJECT_DIR: dir }
  })
}

function editInput(dir: string, rel: string): Record<string, unknown> {
  return {
    tool_name: "Edit",
    tool_input: { file_path: path.join(dir, rel) }
  }
}

const URGENT_AUTH = `---
urgency: urgent
paths: [src/auth.ts]
---
validate() を使ってください。
`

test("パス一致した urgent は additionalContext で注入され processed/ へ移動する", () => {
  const dir = makeProject()
  try {
    writeComment(dir, "c-001.md", URGENT_AUTH)
    const out = runHook(dir, editInput(dir, "src/auth.ts"))
    const parsed = JSON.parse(out) as {
      hookSpecificOutput: { hookEventName: string; additionalContext: string }
    }
    expect(parsed.hookSpecificOutput.hookEventName).toBe("PreToolUse")
    expect(parsed.hookSpecificOutput.additionalContext).toContain("validate()")
    expect(parsed.hookSpecificOutput.additionalContext).toContain("[pitcrew]")
    expect(
      fs.existsSync(path.join(dir, ".pitcrew", "comments", "c-001.md"))
    ).toBe(false)
    expect(
      fs.existsSync(
        path.join(dir, ".pitcrew", "comments", "processed", "c-001.md")
      )
    ).toBe(true)
  } finally {
    fs.rmSync(dir, { recursive: true, force: true })
  }
})

test("祖先ディレクトリ指定の urgent もマッチする", () => {
  const dir = makeProject()
  try {
    writeComment(
      dir,
      "c-001.md",
      "---\nurgency: urgent\npaths: [src]\n---\nsrc 配下の方針変更。\n"
    )
    const out = runHook(dir, editInput(dir, "src/deep/auth.ts"))
    expect(out).toContain("方針変更")
  } finally {
    fs.rmSync(dir, { recursive: true, force: true })
  }
})

test("normal コメントは注入せず comments/ に残す", () => {
  const dir = makeProject()
  try {
    writeComment(
      dir,
      "c-001.md",
      "---\nurgency: normal\npaths: [src/auth.ts]\n---\n後で見て。\n"
    )
    const out = runHook(dir, editInput(dir, "src/auth.ts"))
    expect(out.trim()).toBe("")
    expect(
      fs.existsSync(path.join(dir, ".pitcrew", "comments", "c-001.md"))
    ).toBe(true)
  } finally {
    fs.rmSync(dir, { recursive: true, force: true })
  }
})

test("パスが一致しない urgent は注入せず残す", () => {
  const dir = makeProject()
  try {
    writeComment(dir, "c-001.md", URGENT_AUTH)
    const out = runHook(dir, editInput(dir, "src/other.ts"))
    expect(out.trim()).toBe("")
    expect(
      fs.existsSync(path.join(dir, ".pitcrew", "comments", "c-001.md"))
    ).toBe(true)
  } finally {
    fs.rmSync(dir, { recursive: true, force: true })
  }
})

test("複数の urgent が一致した場合は作成順に連結する", () => {
  const dir = makeProject()
  try {
    writeComment(
      dir,
      "c-002.md",
      "---\nurgency: urgent\npaths: [src/auth.ts]\n---\n二つ目。\n"
    )
    writeComment(
      dir,
      "c-001.md",
      "---\nurgency: urgent\npaths: [src/auth.ts]\n---\n一つ目。\n"
    )
    const out = runHook(dir, editInput(dir, "src/auth.ts"))
    const context = (
      JSON.parse(out) as {
        hookSpecificOutput: { additionalContext: string }
      }
    ).hookSpecificOutput.additionalContext
    expect(context.indexOf("一つ目")).toBeLessThan(context.indexOf("二つ目"))
  } finally {
    fs.rmSync(dir, { recursive: true, force: true })
  }
})

test("プロジェクト外のパスや対象外ツールは何もしない", () => {
  const dir = makeProject()
  try {
    writeComment(dir, "c-001.md", URGENT_AUTH)
    const outside = runHook(dir, {
      tool_name: "Edit",
      tool_input: { file_path: "/etc/hosts" }
    })
    expect(outside.trim()).toBe("")
    const bash = runHook(dir, {
      tool_name: "Bash",
      tool_input: { command: "echo hi" }
    })
    expect(bash.trim()).toBe("")
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
