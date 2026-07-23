import fs from "node:fs"
import os from "node:os"
import path from "node:path"
import { fileURLToPath } from "node:url"
import { expect, test } from "vitest"
import { infectionFilePath, readInfections } from "../lib/infection-store.js"
import { loadState } from "../lib/state-store.js"
import { runTs } from "../testing/run-ts.js"

const HOOK = fileURLToPath(new URL("../detect-infection.ts", import.meta.url))
const SESSION = "session-1"

function makeProject(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), "raphael-detect-"))
}

function runHook(dir: string, fixture: Record<string, unknown>): string {
  return runTs(HOOK, [], {
    input: JSON.stringify({ cwd: dir, session_id: SESSION, ...fixture }),
    env: { ...process.env, CLAUDE_PROJECT_DIR: dir }
  })
}

function writeFile(dir: string, relativePath: string, content: string): string {
  const filePath = path.join(dir, relativePath)
  fs.mkdirSync(path.dirname(filePath), { recursive: true })
  fs.writeFileSync(filePath, content)
  return filePath
}

function withProject(fn: (dir: string) => void): void {
  const dir = makeProject()
  try {
    fn(dir)
  } finally {
    fs.rmSync(dir, { recursive: true, force: true })
  }
}

test("fixture stdin から command failure、retry loop、user rejection、edit churn を記録する", () => {
  withProject((dir) => {
    for (const toolUseId of ["failure-1", "failure-2", "failure-3"]) {
      expect(
        runHook(dir, {
          hook_event_name: "PostToolUseFailure",
          tool_name: "Bash",
          tool_use_id: toolUseId,
          tool_input: { command: "pnpm test" },
          tool_response: { stderr: "test failed", exit_code: 2 }
        }).trim()
      ).toBe("")
    }

    const edited = writeFile(dir, "src/file.ts", "const value = 'one'\n")
    for (const [toolUseId, replacement] of [
      ["edit-1", "one"],
      ["edit-2", "two"],
      ["edit-3", "three"]
    ]) {
      fs.writeFileSync(edited, `const value = '${replacement}'\n`)
      expect(
        runHook(dir, {
          hook_event_name: "PostToolUse",
          tool_name: "Edit",
          tool_use_id: toolUseId,
          tool_input: { file_path: edited, new_string: replacement }
        }).trim()
      ).toBe("")
    }

    expect(
      runHook(dir, {
        hook_event_name: "UserPromptSubmit",
        prompt: "違います。戻して",
        tool_use_id: "prompt-1"
      }).trim()
    ).toBe("")

    const records = readInfections(dir, SESSION)
    expect(new Set(records.map(({ kind }) => kind))).toEqual(
      new Set(["command-failure", "retry-loop", "edit-churn", "user-rejection"])
    )
    expect(
      records.filter(({ kind }) => kind === "command-failure")
    ).toHaveLength(3)
    expect(records.filter(({ kind }) => kind === "retry-loop")).toHaveLength(1)
    expect(records.filter(({ kind }) => kind === "edit-churn")).toHaveLength(1)
    expect(
      records.find(({ kind }) => kind === "user-rejection")?.details
    ).toMatchObject({
      type: "user-rejection",
      previous_tool: { tool: "Edit" }
    })
  })
})

test("benign exit-1 は infection file を作らない", () => {
  withProject((dir) => {
    expect(
      runHook(dir, {
        hook_event_name: "PostToolUse",
        tool_name: "Bash",
        tool_input: { command: "grep missing file" },
        tool_response: { exit_code: 1 }
      }).trim()
    ).toBe("")
    expect(fs.existsSync(infectionFilePath(dir, SESSION))).toBe(false)
  })
})

test("同じ hook input の再実行は infection を重複作成しない", () => {
  withProject((dir) => {
    const fixture = {
      hook_event_name: "PostToolUseFailure",
      tool_name: "Bash",
      tool_use_id: "duplicate-1",
      tool_input: { command: "pnpm lint" },
      error: "Command failed with exit code 2"
    }
    runHook(dir, fixture)
    runHook(dir, fixture)
    expect(readInfections(dir, SESSION)).toHaveLength(1)
  })
})

test("同じ3 edit window は重複せず、直近3件が変われば再評価する", () => {
  withProject((dir) => {
    const edited = writeFile(dir, "src/file.ts", "const value = 'one'\n")
    for (const [toolUseId, replacement] of [
      ["edit-1", "one"],
      ["edit-2", "two"],
      ["edit-3", "three"]
    ]) {
      fs.writeFileSync(edited, `const value = '${replacement}'\n`)
      runHook(dir, {
        hook_event_name: "PostToolUse",
        tool_name: "Edit",
        tool_use_id: toolUseId,
        tool_input: { file_path: edited, new_string: replacement }
      })
    }

    const duplicateThird = {
      hook_event_name: "PostToolUse",
      tool_name: "Edit",
      tool_use_id: "edit-3",
      tool_input: { file_path: edited, new_string: "three" }
    }
    runHook(dir, duplicateThird)
    expect(
      readInfections(dir, SESSION).filter(({ kind }) => kind === "edit-churn")
    ).toHaveLength(1)

    fs.writeFileSync(edited, "const value = 'four'\n")
    runHook(dir, {
      hook_event_name: "PostToolUse",
      tool_name: "Edit",
      tool_use_id: "edit-4",
      tool_input: { file_path: edited, new_string: "four" }
    })
    expect(
      readInfections(dir, SESSION).filter(({ kind }) => kind === "edit-churn")
    ).toHaveLength(2)
  })
})

test("state history の上限と Write の last_tool 更新を維持する", () => {
  withProject((dir) => {
    for (let index = 0; index < 21; index += 1) {
      runHook(dir, {
        hook_event_name: "PostToolUse",
        tool_name: "Bash",
        tool_use_id: `command-${index}`,
        tool_input: { command: `echo ${index}` },
        tool_response: { exit_code: 0 }
      })
    }
    runHook(dir, {
      hook_event_name: "PostToolUse",
      tool_name: "Write",
      tool_use_id: "write-1",
      tool_input: { file_path: "note.txt", content: "PASSWORD=secret" }
    })

    const state = loadState(dir, SESSION)
    expect(state.recent_commands).toHaveLength(20)
    expect(state.last_tool).toMatchObject({
      tool: "Write",
      input_digest: expect.not.stringContaining("secret")
    })
  })
})

test("壊れた stdin でも stdout を出さず exit 0 で終わる", () => {
  expect(runTs(HOOK, [], { input: "not json" }).trim()).toBe("")
})

test("hooks.json は detect 対象イベントを scripts の hook entry に結線する", () => {
  const hooksPath = fileURLToPath(
    new URL("../../hooks/hooks.json", import.meta.url)
  )
  const hooks = JSON.parse(fs.readFileSync(hooksPath, "utf8")) as {
    hooks: Record<
      string,
      Array<{ matcher?: string; hooks: Array<{ command: string }> }>
    >
  }

  expect(hooks.hooks.PostToolUse[0].matcher).toBe("Bash|Edit|Write")
  expect(hooks.hooks.PostToolUseFailure[0].matcher).toBe("Bash")
  expect(hooks.hooks.UserPromptSubmit[0].matcher).toBeUndefined()
  for (const eventName of [
    "PostToolUse",
    "PostToolUseFailure",
    "UserPromptSubmit"
  ]) {
    expect(hooks.hooks[eventName][0].hooks[0].command).toContain(
      `\${CLAUDE_PLUGIN_ROOT}/scripts/detect-infection.mjs`
    )
  }
})
