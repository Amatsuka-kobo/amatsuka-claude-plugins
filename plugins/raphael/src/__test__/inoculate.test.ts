import fs from "node:fs"
import os from "node:os"
import path from "node:path"
import { fileURLToPath } from "node:url"
import { expect, test } from "vitest"
import {
  antibodiesDirectory,
  readAntibody,
  writeAntibodyCreate
} from "../lib/antibody-store.js"
import { sha256Hex } from "../lib/infection-store.js"
import { loadState } from "../lib/state-store.js"
import type { Antibody } from "../lib/types.js"
import { runTs } from "../testing/run-ts.js"

const HOOK = fileURLToPath(new URL("../inoculate.ts", import.meta.url))
const SESSION = "session-1"

function makeProject(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), "raphael-inoculate-"))
}

function withProject(fn: (dir: string) => void): void {
  const dir = makeProject()
  try {
    fn(dir)
  } finally {
    fs.rmSync(dir, { recursive: true, force: true })
  }
}

function antibody(overrides: Partial<Antibody> = {}): Antibody {
  return {
    id: "ab-2026-0724-001",
    created: "2026-07-24",
    source: "manual",
    trigger: { event: "PreToolUse", tool: "Bash", pattern: "pnpm test" },
    status: "active",
    stats: { fired: 0, last_fired: null },
    expires: "2099-08-23",
    body: "Run the focused test first.",
    ...overrides
  }
}

function runHook(dir: string, fixture: Record<string, unknown>): string {
  return runTs(HOOK, [], {
    input: JSON.stringify({
      cwd: dir,
      session_id: SESSION,
      hook_event_name: "PreToolUse",
      ...fixture
    }),
    env: { ...process.env, CLAUDE_PROJECT_DIR: dir }
  })
}

function output(stdout: string): {
  hookSpecificOutput: { hookEventName: string; additionalContext: string }
} {
  return JSON.parse(stdout) as {
    hookSpecificOutput: { hookEventName: string; additionalContext: string }
  }
}

test("fixture stdin の単一 match を additionalContext に注入して発火状態を保存する", () => {
  withProject((dir) => {
    const value = antibody()
    writeAntibodyCreate(dir, value)

    const result = output(
      runHook(dir, {
        tool_name: "Bash",
        tool_input: { command: "pnpm test -- --run" }
      })
    )

    expect(result).toEqual({
      hookSpecificOutput: {
        hookEventName: "PreToolUse",
        additionalContext:
          "[raphael:ab-2026-0724-001]\nRun the focused test first."
      }
    })
    expect(readAntibody(dir, value.id).stats).toEqual({
      fired: 1,
      last_fired: expect.any(String)
    })
    expect(loadState(dir, SESSION).injected).toEqual([
      {
        ts: expect.any(String),
        antibody_id: value.id,
        trigger_fingerprint: sha256Hex("Bash\0\0pnpm test -- --run")
      }
    ])
  })
})

test("複数 match を matcher 順序で注入し max_injections を守る", () => {
  withProject((dir) => {
    writeAntibodyCreate(
      dir,
      antibody({
        id: "ab-2026-0724-001",
        created: "2026-07-20",
        body: "old",
        stats: { fired: 1, last_fired: "2026-07-20" }
      })
    )
    writeAntibodyCreate(
      dir,
      antibody({
        id: "ab-2026-0724-002",
        created: "2026-07-24",
        body: "new"
      })
    )
    writeAntibodyCreate(
      dir,
      antibody({
        id: "ab-2026-0724-003",
        created: "2026-07-23",
        body: "limited"
      })
    )
    fs.mkdirSync(path.join(dir, ".claude"), { recursive: true })
    fs.writeFileSync(
      path.join(dir, ".claude", "raphael.local.md"),
      "---\nmax_injections: 2\n---\n"
    )

    const result = output(
      runHook(dir, {
        tool_name: "Bash",
        tool_input: { command: "pnpm test" }
      })
    )

    expect(result.hookSpecificOutput.additionalContext).toBe(
      "[raphael:ab-2026-0724-001]\nold\n\n[raphael:ab-2026-0724-002]\nnew"
    )
    expect(readAntibody(dir, "ab-2026-0724-001").stats.fired).toBe(2)
    expect(readAntibody(dir, "ab-2026-0724-002").stats.fired).toBe(1)
    expect(readAntibody(dir, "ab-2026-0724-003").stats.fired).toBe(0)
  })
})

test("沈黙の正しさ: non-match、抗体なし、不正 stdin、不正抗体、project 外 Edit/Write は完全無出力", () => {
  withProject((dir) => {
    writeAntibodyCreate(dir, antibody())
    expect(
      runHook(dir, {
        tool_name: "Bash",
        tool_input: { command: "pnpm lint" }
      })
    ).toBe("")
    expect(
      runHook(dir, {
        tool_name: "Edit",
        tool_input: {
          file_path: path.join(path.dirname(dir), "outside.ts"),
          old_string: "pnpm",
          new_string: "test"
        }
      })
    ).toBe("")
    expect(
      runHook(dir, {
        tool_name: "Write",
        tool_input: {
          file_path: path.join(path.dirname(dir), "outside.ts"),
          content: "pnpm test"
        }
      })
    ).toBe("")
  })

  withProject((dir) => {
    expect(
      runHook(dir, {
        tool_name: "Bash",
        tool_input: { command: "pnpm test" }
      })
    ).toBe("")
  })

  withProject((dir) => {
    fs.mkdirSync(path.join(dir, ".raphael", "antibodies"), { recursive: true })
    fs.writeFileSync(
      path.join(dir, ".raphael", "antibodies", "ab-2026-0724-001.md"),
      "invalid"
    )
    expect(
      runHook(dir, {
        tool_name: "Bash",
        tool_input: { command: "pnpm test" }
      })
    ).toBe("")
  })

  expect(runTs(HOOK, [], { input: "not json" })).toBe("")
})

test("stats 更新に失敗した抗体を注入も state 記録もしない", () => {
  withProject((dir) => {
    writeAntibodyCreate(dir, antibody())
    const directory = antibodiesDirectory(dir)
    fs.chmodSync(directory, 0o555)
    try {
      expect(
        runHook(dir, {
          tool_name: "Bash",
          tool_input: { command: "pnpm test" }
        })
      ).toBe("")
      expect(loadState(dir, SESSION).injected).toEqual([])
      expect(readAntibody(dir, "ab-2026-0724-001").stats).toEqual({
        fired: 0,
        last_fired: null
      })
    } finally {
      fs.chmodSync(directory, 0o755)
    }
  })
})

test("expired active を best-effort で expired にし、confirmed の expiry は無視する", () => {
  withProject((dir) => {
    const expired = antibody({
      id: "ab-2026-0724-001",
      expires: "2000-01-01"
    })
    const confirmed = antibody({
      id: "ab-2026-0724-002",
      status: "confirmed",
      expires: "2000-01-01",
      body: "confirmed context"
    })
    writeAntibodyCreate(dir, expired)
    writeAntibodyCreate(dir, confirmed)

    const result = output(
      runHook(dir, {
        tool_name: "Bash",
        tool_input: { command: "pnpm test" }
      })
    )

    expect(readAntibody(dir, expired.id).status).toBe("expired")
    expect(result.hookSpecificOutput.additionalContext).toBe(
      "[raphael:ab-2026-0724-002]\nconfirmed context"
    )
  })
})

test("hooks.json は PreToolUse を inoculate script に結線する", () => {
  const hooksPath = fileURLToPath(
    new URL("../../hooks/hooks.json", import.meta.url)
  )
  const hooks = JSON.parse(fs.readFileSync(hooksPath, "utf8")) as {
    hooks: Record<
      string,
      Array<{ matcher?: string; hooks: Array<{ command: string }> }>
    >
  }

  expect(hooks.hooks.PreToolUse).toEqual([
    {
      matcher: "Bash|Edit|Write",
      hooks: [
        {
          type: "command",
          command: `node "\${CLAUDE_PLUGIN_ROOT}/scripts/inoculate.mjs"`,
          timeout: 15
        }
      ]
    }
  ])
})
