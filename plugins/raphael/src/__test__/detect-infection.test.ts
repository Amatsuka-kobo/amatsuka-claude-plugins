import fs from "node:fs"
import os from "node:os"
import path from "node:path"
import { fileURLToPath } from "node:url"
import { expect, test } from "vitest"
import { readCommandLog } from "../lib/command-log.js"
import { classifyCommandOutcome } from "../lib/detect-command.js"
import { infectionFilePath, readInfections } from "../lib/infection-store.js"
import { recurrenceKey } from "../lib/recurrence.js"
import { createInitialState, loadState, saveState } from "../lib/state-store.js"
import { loadStats } from "../lib/stats-store.js"
import { runTs } from "../testing/run-ts.js"

const HOOK = fileURLToPath(new URL("../detect-infection.ts", import.meta.url))
const SESSION = "session-1"

function makeProject(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), "raphael-detect-"))
}

function runHook(
  dir: string,
  fixture: Record<string, unknown>,
  session = SESSION
): string {
  return runTs(HOOK, [], {
    input: JSON.stringify({ cwd: dir, session_id: session, ...fixture }),
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
          tool_input: { command: "pnpm build" },
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

test("拡張 benign の exit 2 は infection file を作らない", () => {
  withProject((dir) => {
    expect(
      runHook(dir, {
        hook_event_name: "PostToolUseFailure",
        tool_name: "Bash",
        tool_input: { command: "pnpm run typecheck" },
        tool_response: { exit_code: 2 }
      }).trim()
    ).toBe("")
    expect(fs.existsSync(infectionFilePath(dir, SESSION))).toBe(false)
  })
})

test("成功コマンドもコマンド履歴へ 1 行追記する", () => {
  withProject((dir) => {
    runHook(dir, {
      hook_event_name: "PostToolUse",
      tool_name: "Bash",
      tool_use_id: "success-1",
      tool_input: { command: "echo hello" },
      tool_response: { exit_code: 0 }
    })

    expect(readCommandLog(dir)).toMatchObject([
      {
        session: SESSION,
        normalized_command: "echo hello",
        exit_code: 0,
        failed: false
      }
    ])
  })
})

test("失敗コマンドも分類結果とともにコマンド履歴へ追記する", () => {
  withProject((dir) => {
    const expected = classifyCommandOutcome({
      hookEvent: "PostToolUseFailure",
      command: "pnpm run build",
      toolResponse: { exit_code: 2 }
    })
    runHook(dir, {
      hook_event_name: "PostToolUseFailure",
      tool_name: "Bash",
      tool_use_id: "failure-log-1",
      tool_input: { command: "pnpm run build" },
      tool_response: { exit_code: 2 }
    })

    expect(readCommandLog(dir)).toMatchObject([
      {
        session: SESSION,
        normalized_command: expected.normalized_command,
        exit_code: expected.exit_code,
        failed: expected.failed
      }
    ])
    expect(readInfections(dir, SESSION)).toHaveLength(1)
  })
})

test("コマンド履歴への追記失敗後も state 更新と infection 記録を続ける", () => {
  withProject((dir) => {
    fs.mkdirSync(path.join(dir, ".raphael"), { recursive: true })
    fs.mkdirSync(path.join(dir, ".raphael", "commands.jsonl"))

    expect(() =>
      runHook(dir, {
        hook_event_name: "PostToolUseFailure",
        tool_name: "Bash",
        tool_use_id: "failure-log-2",
        tool_input: { command: "pnpm run build" },
        tool_response: { exit_code: 2 }
      })
    ).not.toThrow()

    expect(loadState(dir, SESSION).recent_commands).toHaveLength(1)
    expect(readInfections(dir, SESSION)).toHaveLength(1)
  })
})

test("同じ hook input の再実行は infection を重複作成しない", () => {
  withProject((dir) => {
    const fixture = {
      hook_event_name: "PostToolUseFailure",
      tool_name: "Bash",
      tool_use_id: "duplicate-1",
      tool_input: { command: "pnpm build" },
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

test("注入後の窓内の同一 recurrence_key で miss を加算し retry-loop と重複計上しない", () => {
  withProject((dir) => {
    const state = createInitialState(SESSION)
    state.injected = [
      {
        ts: new Date(Date.now() - 1_000).toISOString(),
        antibody_id: "ab-2026-0724-001",
        trigger_fingerprint: "fingerprint",
        recurrence_key: recurrenceKey("command-failure", "false")
      }
    ]
    state.recent_commands = [
      {
        ts: new Date(Date.now() - 2_000).toISOString(),
        normalized_command: "false",
        failed: true,
        exit_code: 1,
        infection_id: null
      },
      {
        ts: new Date(Date.now() - 1_500).toISOString(),
        normalized_command: "false",
        failed: true,
        exit_code: 1,
        infection_id: null
      }
    ]
    saveState(dir, state)

    runHook(dir, {
      hook_event_name: "PostToolUseFailure",
      tool_name: "Bash",
      tool_use_id: "miss-in-window",
      tool_input: { command: "false" },
      tool_response: { exit_code: 1 }
    })

    expect(loadStats(dir).antibodies["ab-2026-0724-001"]).toMatchObject({
      misses: 1,
      last_miss: expect.any(String)
    })
    expect(readInfections(dir, SESSION)).toHaveLength(2)
  })
})

test("miss の窓外または別 recurrence_key では加算しない", () => {
  withProject((dir) => {
    const state = createInitialState(SESSION)
    state.injected = [
      {
        ts: new Date(Date.now() - 31 * 60_000).toISOString(),
        antibody_id: "ab-2026-0724-001",
        trigger_fingerprint: "old",
        recurrence_key: recurrenceKey("command-failure", "false")
      },
      {
        ts: new Date(Date.now() - 1_000).toISOString(),
        antibody_id: "ab-2026-0724-002",
        trigger_fingerprint: "other",
        recurrence_key: recurrenceKey("command-failure", "other")
      }
    ]
    saveState(dir, state)

    runHook(dir, {
      hook_event_name: "PostToolUseFailure",
      tool_name: "Bash",
      tool_use_id: "miss-outside",
      tool_input: { command: "false" },
      tool_response: { exit_code: 1 }
    })

    expect(loadStats(dir).antibodies).toEqual({})
  })
})

test("recordMiss の失敗でも infection と state の記録を止めない", () => {
  withProject((dir) => {
    const state = createInitialState(SESSION)
    state.injected = [
      {
        ts: new Date(Date.now() - 1_000).toISOString(),
        antibody_id: "ab-2026-0724-001",
        trigger_fingerprint: "fingerprint",
        recurrence_key: recurrenceKey("command-failure", "false")
      }
    ]
    saveState(dir, state)
    fs.mkdirSync(path.join(dir, ".raphael", "stats.json"), { recursive: true })

    expect(() =>
      runHook(dir, {
        hook_event_name: "PostToolUseFailure",
        tool_name: "Bash",
        tool_use_id: "miss-write-failure",
        tool_input: { command: "false" },
        tool_response: { exit_code: 1 }
      })
    ).not.toThrow()
    expect(readInfections(dir, SESSION)).toHaveLength(1)
    expect(loadState(dir, SESSION).recent_commands).toHaveLength(1)
  })
})

test("retry-loop record でも command-failure と同じ recurrence_key で miss を加算する", () => {
  withProject((dir) => {
    const state = createInitialState(SESSION)
    state.injected = [
      {
        ts: new Date(Date.now() - 1_000).toISOString(),
        antibody_id: "ab-2026-0724-001",
        trigger_fingerprint: "fingerprint",
        recurrence_key: recurrenceKey("command-failure", "false")
      }
    ]
    state.recent_commands = [
      {
        ts: new Date(Date.now() - 2_000).toISOString(),
        normalized_command: "false",
        failed: true,
        exit_code: 1,
        infection_id: null
      },
      {
        ts: new Date(Date.now() - 1_500).toISOString(),
        normalized_command: "false",
        failed: true,
        exit_code: 1,
        infection_id: null
      }
    ]
    saveState(dir, state)
    writeFile(
      dir,
      ".claude/raphael.local.md",
      "---\ndetect_command_failure: false\n---\n"
    )

    runHook(dir, {
      hook_event_name: "PostToolUseFailure",
      tool_name: "Bash",
      tool_use_id: "retry-miss",
      tool_input: { command: "false" },
      tool_response: { exit_code: 1 }
    })

    expect(loadStats(dir).antibodies["ab-2026-0724-001"]).toMatchObject({
      misses: 1
    })
    expect(readInfections(dir, SESSION)).toEqual([
      expect.objectContaining({ kind: "retry-loop" })
    ])
  })
})

test("state history の上限と Write の last_tool 更新を維持する", () => {
  withProject((dir) => {
    for (let index = 0; index < 55; index += 1) {
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
    expect(state.recent_commands).toHaveLength(50)
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
test("失敗後に同じコマンドが exit 0 で成功すると infection を resolved にする", () => {
  withProject((dir) => {
    runHook(dir, {
      hook_event_name: "PostToolUseFailure",
      tool_name: "Bash",
      tool_use_id: "resolve-failure",
      tool_input: { command: "false" },
      tool_response: { exit_code: 1 }
    })
    runHook(dir, {
      hook_event_name: "PostToolUse",
      tool_name: "Bash",
      tool_use_id: "resolve-success",
      tool_input: { command: "false" },
      tool_response: { exit_code: 0 }
    })

    expect(readInfections(dir, SESSION)).toEqual([
      expect.objectContaining({
        kind: "command-failure",
        resolved: true,
        resolved_at: expect.any(String)
      })
    ])
    expect(loadState(dir, SESSION).recent_commands).toEqual([
      expect.objectContaining({
        normalized_command: "false",
        failed: true,
        resolved: true
      }),
      expect.objectContaining({ normalized_command: "false", failed: false })
    ])
  })
})

test.each([
  ["benign exit 1", "grep missing file", 1],
  ["benign exit 2", "pnpm run typecheck", 2]
])("%s は同じコマンドでも resolved にしない", (_name, command, benignExit) => {
  withProject((dir) => {
    const initialExit = benignExit === 1 ? 2 : 3
    runHook(dir, {
      hook_event_name: "PostToolUseFailure",
      tool_name: "Bash",
      tool_use_id: "real-failure",
      tool_input: { command },
      tool_response: { exit_code: initialExit }
    })
    runHook(dir, {
      hook_event_name: "PostToolUse",
      tool_name: "Bash",
      tool_use_id: "benign-success",
      tool_input: { command },
      tool_response: { exit_code: benignExit }
    })

    expect(readInfections(dir, SESSION)[0]).not.toHaveProperty("resolved")
    expect(loadState(dir, SESSION).recent_commands[0]).not.toHaveProperty(
      "resolved"
    )
  })
})

test("exit_code が null の成功判定では resolved にしない", () => {
  withProject((dir) => {
    runHook(dir, {
      hook_event_name: "PostToolUseFailure",
      tool_name: "Bash",
      tool_use_id: "null-failure",
      tool_input: { command: "false" },
      tool_response: { exit_code: 1 }
    })
    runHook(dir, {
      hook_event_name: "PostToolUse",
      tool_name: "Bash",
      tool_use_id: "null-success",
      tool_input: { command: "false" },
      tool_response: {}
    })

    expect(readInfections(dir, SESSION)[0].resolved).toBeUndefined()
  })
})

test("二度目の成功、別コマンド、別 session は失敗を解決しない", () => {
  withProject((dir) => {
    runHook(dir, {
      hook_event_name: "PostToolUseFailure",
      tool_name: "Bash",
      tool_use_id: "repeat-failure",
      tool_input: { command: "false" },
      tool_response: { exit_code: 1 }
    })
    runHook(dir, {
      hook_event_name: "PostToolUse",
      tool_name: "Bash",
      tool_use_id: "other-success",
      tool_input: { command: "true" },
      tool_response: { exit_code: 0 }
    })
    runHook(dir, {
      hook_event_name: "PostToolUse",
      tool_name: "Bash",
      tool_use_id: "first-success",
      tool_input: { command: "false" },
      tool_response: { exit_code: 0 }
    })
    runHook(dir, {
      hook_event_name: "PostToolUse",
      tool_name: "Bash",
      tool_use_id: "second-success",
      tool_input: { command: "false" },
      tool_response: { exit_code: 0 }
    })
    expect(readInfections(dir, SESSION)).toEqual([
      expect.objectContaining({
        resolved: true,
        resolved_at: expect.any(String)
      })
    ])
    expect(
      loadState(dir, SESSION).recent_commands.filter((entry) => entry.resolved)
    ).toHaveLength(1)

    runHook(
      dir,
      {
        hook_event_name: "PostToolUse",
        tool_name: "Bash",
        tool_use_id: "new-session-success",
        tool_input: { command: "false" },
        tool_response: { exit_code: 0 }
      },
      "session-2"
    )

    expect(readInfections(dir, SESSION)).toEqual([
      expect.objectContaining({ resolved: true })
    ])
  })
})

test("解決処理が失敗しても成功コマンドの state 記録は続く", () => {
  withProject((dir) => {
    runHook(dir, {
      hook_event_name: "PostToolUseFailure",
      tool_name: "Bash",
      tool_use_id: "broken-mark-failure",
      tool_input: { command: "false" },
      tool_response: { exit_code: 1 }
    })
    const file = infectionFilePath(dir, SESSION)
    fs.rmSync(file)
    fs.mkdirSync(file)

    expect(() =>
      runHook(dir, {
        hook_event_name: "PostToolUse",
        tool_name: "Bash",
        tool_use_id: "broken-mark-success",
        tool_input: { command: "false" },
        tool_response: { exit_code: 0 }
      })
    ).not.toThrow()
    expect(loadState(dir, SESSION).recent_commands).toHaveLength(2)
  })
})
