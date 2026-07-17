import fs from "node:fs"
import os from "node:os"
import path from "node:path"
import { fileURLToPath } from "node:url"
import { expect, test } from "vitest"
import { parseFrontmatter } from "../../lib/frontmatter.js"
import { runTs } from "../../testing/run-ts.js"

const HOOK = fileURLToPath(
  new URL("../capture-post-tool-use.ts", import.meta.url)
)

function makeProject(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), "pitcrew-ptu-"))
}

function runHook(dir: string, input: Record<string, unknown>): string {
  return runTs(HOOK, [], {
    input: JSON.stringify({ cwd: dir, ...input }),
    env: { ...process.env, CLAUDE_PROJECT_DIR: dir }
  })
}

function reviewFiles(dir: string): string[] {
  const reviewDir = path.join(dir, ".pitcrew", "review")
  return fs.existsSync(reviewDir) ? fs.readdirSync(reviewDir).sort() : []
}

function writeArtifact(dir: string, rel: string, content: string): string {
  const abs = path.join(dir, rel)
  fs.mkdirSync(path.dirname(abs), { recursive: true })
  fs.writeFileSync(abs, content)
  return abs
}

test("docs/ 配下への Write で artifact 項目が作られる", () => {
  const dir = makeProject()
  try {
    const abs = writeArtifact(dir, "docs/design.md", "# 設計\n本文\n")
    const out = runHook(dir, {
      tool_name: "Write",
      tool_input: { file_path: abs, content: "# 設計\n本文\n" }
    })
    expect(out.trim()).toBe("")
    const files = reviewFiles(dir)
    expect(files).toHaveLength(1)
    expect(files[0]).toMatch(/^001-artifact-/)
    const raw = fs.readFileSync(
      path.join(dir, ".pitcrew", "review", files[0]),
      "utf8"
    )
    const { data, body } = parseFrontmatter(raw)
    expect(data.type).toBe("artifact")
    expect(data.paths).toEqual(["docs/design.md"])
    expect(body).toContain("# 設計")
  } finally {
    fs.rmSync(dir, { recursive: true, force: true })
  }
})

test("Edit は old/new の変更概要を併記する", () => {
  const dir = makeProject()
  try {
    const abs = writeArtifact(dir, "docs/design.md", "# 設計\n新しい方針\n")
    runHook(dir, {
      tool_name: "Edit",
      tool_input: {
        file_path: abs,
        old_string: "古い方針",
        new_string: "新しい方針"
      }
    })
    const files = reviewFiles(dir)
    const body = fs.readFileSync(
      path.join(dir, ".pitcrew", "review", files[0]),
      "utf8"
    )
    expect(body).toContain("古い方針")
    expect(body).toContain("新しい方針")
    expect(body).toContain("変更概要")
  } finally {
    fs.rmSync(dir, { recursive: true, force: true })
  }
})

test("同一ファイルへの連続 Write は同じ項目を上書きする(コアレス)", () => {
  const dir = makeProject()
  try {
    const abs = writeArtifact(dir, "docs/design.md", "v1\n")
    runHook(dir, { tool_name: "Write", tool_input: { file_path: abs } })
    fs.writeFileSync(abs, "v2\n")
    runHook(dir, { tool_name: "Write", tool_input: { file_path: abs } })
    const files = reviewFiles(dir)
    expect(files).toHaveLength(1)
    const raw = fs.readFileSync(
      path.join(dir, ".pitcrew", "review", files[0]),
      "utf8"
    )
    expect(parseFrontmatter(raw).data.id).toBe("001")
    expect(raw).toContain("v2")
    expect(raw).not.toContain("v1")
  } finally {
    fs.rmSync(dir, { recursive: true, force: true })
  }
})

test("対象外パス(src/ や docs/chat/)は何もしない", () => {
  const dir = makeProject()
  try {
    const abs1 = writeArtifact(dir, "src/a.ts", "code")
    const abs2 = writeArtifact(dir, "docs/chat/x.md", "chat")
    runHook(dir, { tool_name: "Write", tool_input: { file_path: abs1 } })
    runHook(dir, { tool_name: "Write", tool_input: { file_path: abs2 } })
    expect(reviewFiles(dir)).toEqual([])
  } finally {
    fs.rmSync(dir, { recursive: true, force: true })
  }
})

test("プロジェクト外の file_path は無視する", () => {
  const dir = makeProject()
  const outside = fs.mkdtempSync(path.join(os.tmpdir(), "pitcrew-out-"))
  try {
    const abs = path.join(outside, "docs", "x.md")
    fs.mkdirSync(path.dirname(abs), { recursive: true })
    fs.writeFileSync(abs, "x")
    runHook(dir, { tool_name: "Write", tool_input: { file_path: abs } })
    expect(reviewFiles(dir)).toEqual([])
  } finally {
    fs.rmSync(dir, { recursive: true, force: true })
    fs.rmSync(outside, { recursive: true, force: true })
  }
})

test("壊れた stdin でも exit 0 で素通しする", () => {
  expect(runTs(HOOK, [], { input: "not json" }).trim()).toBe("")
})

test("ホワイトリストの Bash コマンドで test 項目が作られる", () => {
  const dir = makeProject()
  try {
    runHook(dir, {
      tool_name: "Bash",
      tool_input: { command: "pnpm test" },
      tool_response: { stdout: "Tests  12 passed (12)", stderr: "" }
    })
    const files = reviewFiles(dir)
    expect(files).toHaveLength(1)
    expect(files[0]).toMatch(/^001-test-/)
    const raw = fs.readFileSync(
      path.join(dir, ".pitcrew", "review", files[0]),
      "utf8"
    )
    const { data, body } = parseFrontmatter(raw)
    expect(data.type).toBe("test")
    expect(body).toContain("pnpm test")
    expect(body).toContain("12 passed")
    expect(body).toContain("成功")
  } finally {
    fs.rmSync(dir, { recursive: true, force: true })
  }
})

test("失敗出力は「失敗の疑い」として記録される", () => {
  const dir = makeProject()
  try {
    runHook(dir, {
      tool_name: "Bash",
      tool_input: { command: "pnpm test" },
      tool_response: { stdout: "Tests  1 failed | 11 passed", stderr: "" }
    })
    const raw = fs.readFileSync(
      path.join(dir, ".pitcrew", "review", reviewFiles(dir)[0]),
      "utf8"
    )
    expect(raw).toContain("失敗の疑い")
  } finally {
    fs.rmSync(dir, { recursive: true, force: true })
  }
})

test("ホワイトリスト外の Bash コマンドは何もしない", () => {
  const dir = makeProject()
  try {
    runHook(dir, {
      tool_name: "Bash",
      tool_input: { command: "git status" },
      tool_response: { stdout: "clean", stderr: "" }
    })
    expect(reviewFiles(dir)).toEqual([])
  } finally {
    fs.rmSync(dir, { recursive: true, force: true })
  }
})

test("PostToolUseFailure の Bash は failed 項目として記録される", () => {
  const dir = makeProject()
  try {
    runHook(dir, {
      hook_event_name: "PostToolUseFailure",
      tool_name: "Bash",
      tool_input: { command: "pnpm build" },
      tool_response: { stdout: "Building...", stderr: "" },
      error: "Command exited with non-zero status code 1"
    })
    const raw = fs.readFileSync(
      path.join(dir, ".pitcrew", "review", reviewFiles(dir)[0]),
      "utf8"
    )
    expect(raw).toContain("失敗")
    expect(raw).toContain("Command exited with non-zero status code 1")
  } finally {
    fs.rmSync(dir, { recursive: true, force: true })
  }
})

test("PostToolUseFailure のホワイトリスト外 Bash は無視される", () => {
  const dir = makeProject()
  try {
    runHook(dir, {
      hook_event_name: "PostToolUseFailure",
      tool_name: "Bash",
      tool_input: { command: "git status" },
      error: "Command exited with non-zero status code 1"
    })
    expect(reviewFiles(dir)).toEqual([])
  } finally {
    fs.rmSync(dir, { recursive: true, force: true })
  }
})

function writeConfig(dir: string, frontmatter: string): void {
  const claudeDir = path.join(dir, ".claude")
  fs.mkdirSync(claudeDir, { recursive: true })
  fs.writeFileSync(
    path.join(claudeDir, "pitcrew.local.md"),
    `---\n${frontmatter}\n---\n`
  )
}

test("config で artifact を外すと docs/ への Write を捕捉しない", () => {
  const dir = makeProject()
  try {
    writeConfig(dir, "capture_targets: [diff, test]")
    const abs = writeArtifact(dir, "docs/design.md", "# 設計\n")
    runHook(dir, { tool_name: "Write", tool_input: { file_path: abs } })
    expect(reviewFiles(dir)).toEqual([])
  } finally {
    fs.rmSync(dir, { recursive: true, force: true })
  }
})

test("config の artifact_globs で捕捉対象を置き換えられる", () => {
  const dir = makeProject()
  try {
    writeConfig(dir, 'artifact_globs: ["notes/**/*.md"]')
    const notes = writeArtifact(dir, "notes/memo.md", "メモ\n")
    const docs = writeArtifact(dir, "docs/design.md", "# 設計\n")
    runHook(dir, { tool_name: "Write", tool_input: { file_path: notes } })
    runHook(dir, { tool_name: "Write", tool_input: { file_path: docs } })
    const files = reviewFiles(dir)
    expect(files).toHaveLength(1)
    expect(files[0]).toContain("memo")
  } finally {
    fs.rmSync(dir, { recursive: true, force: true })
  }
})

test("config で test を外すとホワイトリストコマンドも捕捉しない", () => {
  const dir = makeProject()
  try {
    writeConfig(dir, "capture_targets: [diff, artifact]")
    runHook(dir, {
      tool_name: "Bash",
      tool_input: { command: "pnpm test" },
      tool_response: { stdout: "1 passed", stderr: "" }
    })
    expect(reviewFiles(dir)).toEqual([])
  } finally {
    fs.rmSync(dir, { recursive: true, force: true })
  }
})

test("config の test_commands で追加したコマンドを捕捉する", () => {
  const dir = makeProject()
  try {
    writeConfig(dir, 'test_commands: ["deno test"]')
    runHook(dir, {
      tool_name: "Bash",
      tool_input: { command: "deno test --allow-read" },
      tool_response: { stdout: "ok", stderr: "" }
    })
    expect(reviewFiles(dir)).toHaveLength(1)
  } finally {
    fs.rmSync(dir, { recursive: true, force: true })
  }
})
