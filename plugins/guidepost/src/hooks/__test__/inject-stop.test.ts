import fs from "node:fs"
import os from "node:os"
import path from "node:path"
import { fileURLToPath } from "node:url"
import { expect, test } from "vitest"
import { runTs } from "../../testing/run-ts.js"

const HOOK = fileURLToPath(new URL("../inject-stop.ts", import.meta.url))

function makeProject(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), "guidepost-inject-stop-"))
}

function writeQuestion(dir: string, name: string, content: string): void {
  const questionsDir = path.join(dir, ".guidepost", "queue", "questions")
  fs.mkdirSync(questionsDir, { recursive: true })
  fs.writeFileSync(path.join(questionsDir, name), content)
}

function validQuestion(body: string): string {
  return [
    "---",
    "tourId: 20260727-120000-abcdef0",
    "stopId: stop-02",
    "createdAt: 2026-07-27T12:00:00.000Z",
    "---",
    body,
    ""
  ].join("\n")
}

function runHook(dir: string, input: Record<string, unknown> = {}): string {
  return runTs(HOOK, [], {
    input: JSON.stringify({ cwd: dir, ...input }),
    env: { ...process.env, CLAUDE_PROJECT_DIR: dir }
  })
}

test("未処理質問を回答先付きで差し戻し processed へ移動する", () => {
  const dir = makeProject()
  try {
    const name = "20260727T120000000.md"
    writeQuestion(dir, name, validQuestion("この変更が必要な理由は？"))

    const out = runHook(dir)
    const parsed = JSON.parse(out) as { decision: string; reason: string }
    const answer = path.join(
      dir,
      ".guidepost",
      "tours",
      "20260727-120000-abcdef0",
      "answers",
      "stop-02-20260727T120000000.md"
    )
    expect(parsed.decision).toBe("block")
    expect(parsed.reason).toContain("この変更が必要な理由は？")
    expect(parsed.reason).toContain(answer)
    expect(parsed.reason).toContain("新規ファイル")
    expect(parsed.reason).toContain("既存ファイルへの追記はしない")
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

test("stop_hook_active が true なら無出力で質問を残す", () => {
  const dir = makeProject()
  try {
    const name = "20260727T120000000.md"
    writeQuestion(dir, name, validQuestion("残る質問"))

    expect(runHook(dir, { stop_hook_active: true }).trim()).toBe("")
    expect(
      fs.existsSync(path.join(dir, ".guidepost", "queue", "questions", name))
    ).toBe(true)
  } finally {
    fs.rmSync(dir, { recursive: true, force: true })
  }
})

test("未処理質問がなければ無出力で終了する", () => {
  const dir = makeProject()
  try {
    expect(runHook(dir).trim()).toBe("")
  } finally {
    fs.rmSync(dir, { recursive: true, force: true })
  }
})

test("frontmatter のない質問は回答先を推測せず回答のみ指示する", () => {
  const dir = makeProject()
  try {
    writeQuestion(
      dir,
      "broken.md",
      "どこかのストップについての手書き質問です。\n"
    )

    const parsed = JSON.parse(runHook(dir)) as {
      decision: string
      reason: string
    }
    expect(parsed.decision).toBe("block")
    expect(parsed.reason).toContain("手書き質問")
    expect(parsed.reason).toContain("特定できないため")
    expect(parsed.reason).toContain("セッション内で回答のみ")
    expect(parsed.reason).toContain("answers/ への書き込みは不要")
    expect(parsed.reason).not.toContain("回答の書き込み先:")
  } finally {
    fs.rmSync(dir, { recursive: true, force: true })
  }
})

test("不正な stdin では無出力かつ exit 0 になる", () => {
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
