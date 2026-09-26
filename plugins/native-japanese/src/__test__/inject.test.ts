import { spawnSync } from "node:child_process"
import fs from "node:fs"
import { createRequire } from "node:module"
import os from "node:os"
import path from "node:path"
import { fileURLToPath } from "node:url"
import { expect, test } from "vitest"
import { runTs } from "../testing/run-ts.js"

const SCRIPT = fileURLToPath(new URL("../inject.ts", import.meta.url))
const DISCIPLINE = fileURLToPath(
  new URL("../../references/discipline.md", import.meta.url)
)
const TSX_CLI = createRequire(import.meta.url).resolve("tsx/cli")
const SESSION_START = JSON.stringify({ hook_event_name: "SessionStart" })

function inject(input: string, script = SCRIPT): string {
  return runTs(script, [], { input })
}

// src/inject.ts だけを複製したプラグインルートを一時ディレクトリに作る。
// discipline が null なら references/ を置かない。
function withPluginRoot(
  discipline: string | null,
  run: (script: string) => void
): void {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "native-japanese-"))
  try {
    fs.writeFileSync(path.join(root, "package.json"), '{"type":"module"}\n')
    fs.mkdirSync(path.join(root, "src"))
    const script = path.join(root, "src", "inject.ts")
    fs.copyFileSync(SCRIPT, script)
    if (discipline !== null) {
      fs.mkdirSync(path.join(root, "references"))
      fs.writeFileSync(
        path.join(root, "references", "discipline.md"),
        discipline
      )
    }
    run(script)
  } finally {
    fs.rmSync(root, { recursive: true, force: true })
  }
}

test.each([
  "SessionStart",
  "SubagentStart"
])("%s で discipline.md の全文を 1 行の JSON で注入する", (event) => {
  const out = inject(JSON.stringify({ hook_event_name: event }))
  expect(out.endsWith("\n")).toBe(true)
  expect(out.slice(0, -1)).not.toContain("\n")
  expect(JSON.parse(out)).toEqual({
    hookSpecificOutput: {
      hookEventName: event,
      additionalContext: fs.readFileSync(DISCIPLINE, "utf8")
    }
  })
})

test.each([
  ["イベント名が無い", "{}"],
  ["未知のイベント名", JSON.stringify({ hook_event_name: "Stop" })],
  ["JSON として読めない", "not json"],
  ["標準入力が空", ""],
  ["JSON の null", "null"],
  ["イベント名が文字列でない", JSON.stringify({ hook_event_name: 1 })]
])("%s なら何も出力しない", (_, input) => {
  expect(inject(input)).toBe("")
})

test("差し替えた本文を注入する(一時ディレクトリでの起動の対照)", () => {
  withPluginRoot("# 見出し\n\n- 本文\n", (script) => {
    expect(
      JSON.parse(inject(SESSION_START, script)).hookSpecificOutput
        .additionalContext
    ).toBe("# 見出し\n\n- 本文\n")
  })
})

test("discipline.md が無ければ何も出力しない", () => {
  withPluginRoot(null, (script) => {
    expect(inject(SESSION_START, script)).toBe("")
  })
})

test("discipline.md が空白だけなら何も出力しない", () => {
  withPluginRoot(" \n\t\n  \n", (script) => {
    expect(inject(SESSION_START, script)).toBe("")
  })
})

test("失敗しても stderr に書かない", () => {
  withPluginRoot(null, (script) => {
    for (const input of ["not json", SESSION_START]) {
      const result = spawnSync(process.execPath, [TSX_CLI, script], {
        input,
        encoding: "utf8",
        env: { ...process.env, NODE_NO_WARNINGS: "1" }
      })
      expect(result.status).toBe(0)
      expect(result.stdout).toBe("")
      expect(result.stderr).toBe("")
    }
  })
})

test("discipline.md は 9,000 文字以内", () => {
  expect(fs.readFileSync(DISCIPLINE, "utf8").length).toBeLessThanOrEqual(9000)
})
