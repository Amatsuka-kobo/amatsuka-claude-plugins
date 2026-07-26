import fs from "node:fs"
import os from "node:os"
import path from "node:path"
import { fileURLToPath } from "node:url"
import { expect, test } from "vitest"
import { runTs } from "../../testing/run-ts.js"

const PRE_HOOK = fileURLToPath(
  new URL("../inject-pre-tool-use.ts", import.meta.url)
)
const STOP_HOOK = fileURLToPath(new URL("../inject-stop.ts", import.meta.url))

function makeProject(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), "guidepost-inject-pre-"))
}

function writeQuestion(dir: string, name: string, body: string): void {
  const questionsDir = path.join(dir, ".guidepost", "queue", "questions")
  fs.mkdirSync(questionsDir, { recursive: true })
  fs.writeFileSync(
    path.join(questionsDir, name),
    [
      "---",
      "tourId: 20260727-120000-abcdef0",
      "stopId: stop-03",
      "createdAt: 2026-07-27T12:00:00.000Z",
      "---",
      body,
      ""
    ].join("\n")
  )
}

function runHook(
  hook: string,
  dir: string,
  input: Record<string, unknown> = {}
): string {
  return runTs(hook, [], {
    input: JSON.stringify({ cwd: dir, ...input }),
    env: { ...process.env, CLAUDE_PROJECT_DIR: dir }
  })
}

test("PreToolUse はツール種別やパスによらず additionalContext を注入する", () => {
  const dir = makeProject()
  try {
    writeQuestion(dir, "20260727T120000000.md", "境界条件は何ですか？")

    const parsed = JSON.parse(
      runHook(PRE_HOOK, dir, {
        tool_name: "Bash",
        tool_input: { command: "true" }
      })
    ) as {
      hookSpecificOutput: {
        hookEventName: string
        additionalContext: string
        permissionDecision?: string
      }
    }
    expect(parsed.hookSpecificOutput.hookEventName).toBe("PreToolUse")
    expect(parsed.hookSpecificOutput.additionalContext).toContain("境界条件")
    expect(parsed.hookSpecificOutput.additionalContext).toContain("[guidepost]")
    expect(parsed.hookSpecificOutput.permissionDecision).toBeUndefined()
  } finally {
    fs.rmSync(dir, { recursive: true, force: true })
  }
})

test("注入した質問は processed へ移動する", () => {
  const dir = makeProject()
  try {
    const name = "20260727T120000000.md"
    writeQuestion(dir, name, "移動確認")

    runHook(PRE_HOOK, dir, { tool_name: "Read", tool_input: {} })

    expect(
      fs.existsSync(path.join(dir, ".guidepost", "queue", "questions", name))
    ).toBe(false)
    expect(
      fs.existsSync(
        path.join(dir, ".guidepost", "queue", "questions", "processed", name)
      )
    ).toBe(true)
  } finally {
    fs.rmSync(dir, { recursive: true, force: true })
  }
})

test("Stop がクレームした質問を PreToolUse は二重注入しない", () => {
  const dir = makeProject()
  try {
    writeQuestion(dir, "20260727T120000000.md", "一度だけ届ける質問")

    const first = runHook(STOP_HOOK, dir)
    const second = runHook(PRE_HOOK, dir, {
      tool_name: "Edit",
      tool_input: { file_path: path.join(dir, "unrelated.ts") }
    })

    expect(first).toContain("一度だけ届ける質問")
    expect(second.trim()).toBe("")
  } finally {
    fs.rmSync(dir, { recursive: true, force: true })
  }
})

test("キューディレクトリなしと不正 stdin は無出力かつ exit 0 になる", () => {
  const dir = makeProject()
  try {
    expect(runHook(PRE_HOOK, dir, { tool_name: "Read" }).trim()).toBe("")
    const malformed = runTs(PRE_HOOK, [], {
      input: "not json",
      env: { ...process.env, CLAUDE_PROJECT_DIR: dir }
    })
    expect(malformed.trim()).toBe("")
  } finally {
    fs.rmSync(dir, { recursive: true, force: true })
  }
})
