import fs from "node:fs"
import os from "node:os"
import path from "node:path"
import { fileURLToPath } from "node:url"
import { expect, test } from "vitest"
import { cleanupProject, localDateString } from "../check-distill-needed.js"
import {
  antibodyFilePath,
  readAntibody,
  writeAntibodyCreate
} from "../lib/antibody-store.js"
import { appendCommandLog, readCommandLog } from "../lib/command-log.js"
import {
  appendInfection,
  infectionFilePath,
  sha256Hex
} from "../lib/infection-store.js"
import {
  createInitialState,
  loadState,
  saveState,
  stateFilePath
} from "../lib/state-store.js"
import { loadStats, saveStats } from "../lib/stats-store.js"
import type { Antibody, InfectionRecordV1 } from "../lib/types.js"
import { runTs } from "../testing/run-ts.js"

const HERE = path.dirname(fileURLToPath(import.meta.url))
const SCRIPT = path.resolve(HERE, "..", "check-distill-needed.ts")
const PLUGIN_ROOT = path.resolve(HERE, "..", "..")

function withProject(fn: (dir: string) => void): void {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "raphael-stop-"))
  try {
    fn(dir)
  } finally {
    try {
      fs.chmodSync(path.join(dir, ".raphael"), 0o755)
    } catch {
      // The hook may exit before creating local state.
    }
    fs.rmSync(dir, { recursive: true, force: true })
  }
}

function infection(
  id: string,
  session: string,
  overrides: Partial<InfectionRecordV1> = {}
): InfectionRecordV1 {
  return {
    schema_version: 1,
    id,
    ts: "2026-07-24T01:02:03.004Z",
    kind: "command-failure",
    session,
    hook_event: "PostToolUseFailure",
    tool: "Bash",
    tool_use_id: null,
    input_digest: "input",
    evidence: "private evidence SECRET_TOKEN=do-not-print",
    fingerprint: sha256Hex(`${id}-fingerprint`),
    details: {
      type: "command-failure",
      command: "false",
      normalized_command: "false",
      exit_code: 1,
      output_tail: "private output"
    },
    distilled: false,
    distilled_at: null,
    ...overrides
  }
}

function antibody(overrides: Partial<Antibody> = {}): Antibody {
  return {
    id: "ab-2026-0724-001",
    created: "2026-07-24",
    source: "manual",
    trigger: { event: "PreToolUse", tool: "Bash", pattern: "pnpm test" },
    status: "active",
    expires: "2026-08-23",
    body: "Run the focused test first.",
    ...overrides
  }
}

function runHook(
  projectDir: string,
  input: Record<string, unknown>,
  env: NodeJS.ProcessEnv = {}
): string {
  return runTs(SCRIPT, [], {
    cwd: projectDir,
    input: JSON.stringify(input),
    env: {
      ...process.env,
      CLAUDE_PROJECT_DIR: projectDir,
      CLAUDE_PLUGIN_ROOT: PLUGIN_ROOT,
      ...env
    }
  })
}

function parseBlock(output: string): { decision: string; reason: string } {
  return JSON.parse(output) as { decision: string; reason: string }
}

test("不正 stdin と stop_hook_active は即時無出力にする", () => {
  withProject((dir) => {
    expect(
      runTs(SCRIPT, [], {
        cwd: dir,
        input: "not-json",
        env: { ...process.env, CLAUDE_PROJECT_DIR: dir }
      })
    ).toBe("")

    appendInfection(dir, infection("infection-1", "session-1"))
    appendInfection(dir, infection("infection-2", "session-1"))
    appendInfection(dir, infection("infection-3", "session-1"))
    expect(
      runHook(dir, { session_id: "session-1", stop_hook_active: true })
    ).toBe("")
    expect(fs.existsSync(stateFilePath(dir))).toBe(false)
  })
})

test("同一コマンドの 3 回失敗では種類数が閾値に届かず催促しない", () => {
  withProject((dir) => {
    for (const id of ["infection-z", "infection-a", "infection-β"]) {
      appendInfection(dir, infection(id, "session-1"))
    }

    expect(runHook(dir, { session_id: "session-1" })).toBe("")
    expect(loadStats(dir).distill.last_nag_digest).toBeNull()
  })
})

test("異なる 3 コマンドでは種類数と件数を含めて block する", () => {
  withProject((dir) => {
    for (const [id, command] of [
      ["infection-z", "false"],
      ["infection-a", "node missing-a.mjs"],
      ["infection-β", "git status --no-such-path"]
    ] as const) {
      appendInfection(
        dir,
        infection(id, "session-1", {
          details: {
            type: "command-failure",
            command,
            normalized_command: command,
            exit_code: 1,
            output_tail: "private output"
          }
        })
      )
    }

    const output = runHook(dir, { session_id: "session-1" })
    const block = parseBlock(output)
    expect(block.decision).toBe("block")
    expect(block.reason).toContain(
      'subagent_type "raphael:antibody-synthesizer"'
    )
    expect(block.reason).toContain(`対象 project: ${dir}`)
    expect(block.reason).toContain("未解決の失敗の種類数: 3")
    expect(block.reason).toContain("未蒸留 infection 件数: 3")
    expect(block.reason).toContain(
      `node "${PLUGIN_ROOT}/scripts/list-antibodies.mjs" --json --include-body`
    )
    expect(block.reason).toContain(
      `node "${PLUGIN_ROOT}/scripts/update-antibody.mjs"`
    )
    expect(block.reason).not.toContain("private evidence")
    expect(block.reason).not.toContain("do-not-print")
    expect(block.reason).not.toContain("private output")

    expect(loadStats(dir).distill.last_nag_digest).toMatch(/^[0-9a-f]{64}$/)
  })
})

test("session をまたいで同じ種類集合では再停止せず、集合変更後は再通知する", () => {
  withProject((dir) => {
    const commands = [
      "false",
      "node missing-a.mjs",
      "git status --no-such-path"
    ]
    commands.forEach((command, index) => {
      appendInfection(
        dir,
        infection(`infection-${index}`, "session-1", {
          details: {
            type: "command-failure",
            command,
            normalized_command: command,
            exit_code: 1,
            output_tail: "private output"
          }
        })
      )
    })

    const first = parseBlock(runHook(dir, { session_id: "session-1" }))
    const firstDigest = loadStats(dir).distill.last_nag_digest
    expect(first.reason).toContain("未解決の失敗の種類数: 3")
    expect(firstDigest).toMatch(/^[0-9a-f]{64}$/)

    expect(runHook(dir, { session_id: "session-2" })).toBe("")
    expect(loadStats(dir).distill.last_nag_digest).toBe(firstDigest)

    appendInfection(
      dir,
      infection("infection-new", "session-2", {
        details: {
          type: "command-failure",
          command: "node missing-new.mjs",
          normalized_command: "node missing-new.mjs",
          exit_code: 1,
          output_tail: "private output"
        }
      })
    )
    const second = parseBlock(runHook(dir, { session_id: "session-2" }))
    expect(second.reason).toContain("未解決の失敗の種類数: 4")
    expect(loadStats(dir).distill.last_nag_digest).not.toBe(firstDigest)
  })
})

test("resolved と distilled の record は未解決集合から除外する", () => {
  withProject((dir) => {
    appendInfection(dir, infection("resolved", "session-1", { resolved: true }))
    appendInfection(
      dir,
      infection("distilled", "session-1", {
        distilled: true,
        distilled_at: "2026-09-08T00:00:00.000Z"
      })
    )
    appendInfection(
      dir,
      infection("pending", "session-1", {
        details: {
          type: "command-failure",
          command: "node pending.mjs",
          normalized_command: "node pending.mjs",
          exit_code: 1,
          output_tail: "private output"
        }
      })
    )

    expect(runHook(dir, { session_id: "session-1" })).toBe("")
    appendInfection(
      dir,
      infection("pending-2", "session-1", {
        details: {
          type: "command-failure",
          command: "node pending-2.mjs",
          normalized_command: "node pending-2.mjs",
          exit_code: 1,
          output_tail: "private output"
        }
      })
    )
    appendInfection(
      dir,
      infection("pending-3", "session-1", {
        details: {
          type: "command-failure",
          command: "node pending-3.mjs",
          normalized_command: "node pending-3.mjs",
          exit_code: 1,
          output_tail: "private output"
        }
      })
    )
    const output = parseBlock(runHook(dir, { session_id: "session-1" }))
    expect(output.reason).toContain("未解決の失敗の種類数: 3")
    expect(output.reason).toContain("未蒸留 infection 件数: 4")
  })
})

test("stats.json の読み込みに失敗したときは通常どおり催促する", () => {
  withProject((dir) => {
    for (const [id, command] of [
      ["a", "false"],
      ["b", "node missing.mjs"],
      ["c", "git status --no-such-path"]
    ] as const) {
      appendInfection(
        dir,
        infection(id, "session-1", {
          details: {
            type: "command-failure",
            command,
            normalized_command: command,
            exit_code: 1,
            output_tail: ""
          }
        })
      )
    }
    fs.mkdirSync(path.join(dir, ".raphael"), { recursive: true })
    fs.writeFileSync(path.join(dir, ".raphael", "stats.json"), "{broken")
    const output = parseBlock(runHook(dir, { session_id: "session-1" }))
    expect(output.decision).toBe("block")
  })
})

test("stats.json の書き込みに失敗したときは block を出さない", () => {
  withProject((dir) => {
    for (const [id, command] of [
      ["a", "false"],
      ["b", "node missing.mjs"],
      ["c", "git status --no-such-path"]
    ] as const) {
      appendInfection(
        dir,
        infection(id, "session-1", {
          details: {
            type: "command-failure",
            command,
            normalized_command: command,
            exit_code: 1,
            output_tail: ""
          }
        })
      )
    }
    fs.mkdirSync(path.join(dir, ".raphael", "stats.json"), { recursive: true })
    fs.chmodSync(path.join(dir, ".raphael"), 0o555)
    expect(runHook(dir, { session_id: "session-1" })).toBe("")
  })
})

test("cleanup は14日超の distilled record と空 file を削除し、境界と壊れた行を保持する", () => {
  withProject((dir) => {
    const now = new Date("2026-07-24T12:00:00.000Z")
    const session = "session-cleanup"
    const file = infectionFilePath(dir, session)
    fs.mkdirSync(path.dirname(file), { recursive: true })
    const tooOld = infection("infection-old", session, {
      distilled: true,
      distilled_at: "2026-07-10T11:59:59.999Z"
    })
    const boundary = infection("infection-boundary", session, {
      distilled: true,
      distilled_at: "2026-07-10T12:00:00.000Z"
    })
    const pending = infection("infection-pending", session)
    fs.writeFileSync(
      file,
      [
        JSON.stringify(tooOld),
        "{broken-jsonl",
        JSON.stringify(boundary),
        JSON.stringify(pending),
        ""
      ].join("\n")
    )

    const removedOnly = infectionFilePath(dir, "session-removed")
    fs.writeFileSync(
      removedOnly,
      `${JSON.stringify(
        infection("infection-removed", "session-removed", {
          distilled: true,
          distilled_at: "2026-07-01T00:00:00.000Z"
        })
      )}\n`
    )
    const emptyFile = infectionFilePath(dir, "session-empty")
    fs.writeFileSync(emptyFile, "")

    const result = cleanupProject(dir, now)
    expect(result.undistilledIds).toEqual(["infection-pending"])
    expect(fs.readFileSync(file, "utf8")).toBe(
      [
        "{broken-jsonl",
        JSON.stringify(boundary),
        JSON.stringify(pending),
        ""
      ].join("\n")
    )
    expect(fs.existsSync(removedOnly)).toBe(false)
    expect(fs.existsSync(emptyFile)).toBe(false)
  })
})

test("cleanup は14日超の resolved record を削除し、日時不正は保持する", () => {
  withProject((dir) => {
    const now = new Date("2026-07-24T12:00:00.000Z")
    const session = "session-resolved-cleanup"
    const file = infectionFilePath(dir, session)
    fs.mkdirSync(path.dirname(file), { recursive: true })
    const oldResolved = infection("infection-resolved-old", session, {
      resolved: true,
      resolved_at: "2026-07-10T11:59:59.999Z"
    })
    const invalidResolved = infection("infection-resolved-invalid", session, {
      resolved: true,
      resolved_at: "not-a-date"
    })
    fs.writeFileSync(
      file,
      [JSON.stringify(oldResolved), JSON.stringify(invalidResolved), ""].join(
        "\n"
      )
    )

    const result = cleanupProject(dir, now)
    expect(result.undistilledIds).toEqual([])
    expect(fs.readFileSync(file, "utf8")).toBe(
      `${JSON.stringify(invalidResolved)}\n`
    )
  })
})

test("cleanup は expires を過ぎた active 抗体だけ expired に遷移する", () => {
  withProject((dir) => {
    writeAntibodyCreate(
      dir,
      antibody({ id: "ab-2026-0724-001", expires: "2026-07-23" })
    )
    writeAntibodyCreate(
      dir,
      antibody({ id: "ab-2026-0724-002", expires: "2026-07-24" })
    )
    writeAntibodyCreate(
      dir,
      antibody({
        id: "ab-2026-0724-003",
        expires: "2026-07-20",
        status: "confirmed"
      })
    )
    fs.writeFileSync(
      antibodyFilePath(dir, "ab-2026-0724-004"),
      "broken antibody"
    )
    saveStats(dir, {
      schema_version: 1,
      antibodies: {
        "ab-2026-0724-001": {
          fired: 1,
          last_fired: null,
          misses: 0,
          last_miss: null
        },
        "ab-2026-0724-999": {
          fired: 9,
          last_fired: null,
          misses: 0,
          last_miss: null
        }
      },
      distill: { last_nag_digest: null }
    })

    cleanupProject(dir, new Date(2026, 6, 24, 12))

    expect(readAntibody(dir, "ab-2026-0724-001").status).toBe("expired")
    expect(readAntibody(dir, "ab-2026-0724-002").status).toBe("active")
    expect(readAntibody(dir, "ab-2026-0724-003").status).toBe("confirmed")
    expect(Object.keys(loadStats(dir).antibodies)).toEqual(["ab-2026-0724-001"])
    expect(
      fs.readFileSync(antibodyFilePath(dir, "ab-2026-0724-004"), "utf8")
    ).toBe("broken antibody")
    expect(localDateString(new Date(2026, 6, 24, 23, 59, 59))).toBe(
      "2026-07-24"
    )
  })
})

test("stats pruning の読み書き失敗でも cleanup 全体を止めない", () => {
  withProject((dir) => {
    writeAntibodyCreate(
      dir,
      antibody({ id: "ab-2026-0724-001", expires: "2026-07-23" })
    )
    saveStats(dir, {
      schema_version: 1,
      antibodies: {
        "ab-2026-0724-999": {
          fired: 1,
          last_fired: null,
          misses: 0,
          last_miss: null
        }
      },
      distill: { last_nag_digest: null }
    })
    fs.chmodSync(path.join(dir, ".raphael"), 0o555)

    expect(() => cleanupProject(dir, new Date(2026, 6, 24, 12))).not.toThrow()
    expect(readAntibody(dir, "ab-2026-0724-001").status).toBe("expired")
  })
})

test("Stop hook はコマンド履歴を 2,000 行へ切り詰める", () => {
  withProject((dir) => {
    for (let index = 0; index < 2_005; index += 1) {
      appendCommandLog(dir, {
        ts: `2026-09-08T00:00:${String(index % 60).padStart(2, "0")}.000Z`,
        session: "session-1",
        normalized_command: `echo ${index}`,
        exit_code: 0,
        failed: false
      })
    }

    expect(runHook(dir, { session_id: "session-1" })).toBe("")
    const commands = readCommandLog(dir)
    expect(commands).toHaveLength(2_000)
    expect(commands[0]?.normalized_command).toBe("echo 5")
  })
})

test("コマンド履歴の切り詰め失敗でも cleanup 全体を止めない", () => {
  withProject((dir) => {
    writeAntibodyCreate(
      dir,
      antibody({ id: "ab-2026-0724-001", expires: "2026-07-23" })
    )
    fs.mkdirSync(path.join(dir, ".raphael"), { recursive: true })
    fs.mkdirSync(path.join(dir, ".raphael", "commands.jsonl"))

    expect(runHook(dir, { session_id: "session-1" })).toBe("")
    expect(readAntibody(dir, "ab-2026-0724-001").status).toBe("expired")
  })
})

test("cleanup I/O failure は hook を止めず stdout を空にする", () => {
  withProject((dir) => {
    const infectionDir = path.join(dir, ".raphael", "infections")
    fs.mkdirSync(path.dirname(infectionDir), { recursive: true })
    fs.writeFileSync(infectionDir, "not-a-directory")
    expect(runHook(dir, { session_id: "session-1" })).toBe("")
  })
})

test("nag digest を stats に保存して state の他 field を変更しない", () => {
  withProject((dir) => {
    const state = createInitialState("session-1")
    state.next_event_seq = 7
    state.injected = [
      {
        ts: "2026-07-24T00:00:00.000Z",
        antibody_id: "ab-2026-0724-001",
        trigger_fingerprint: "fingerprint"
      }
    ]
    saveState(dir, state)
    for (const [id, command] of [
      ["a", "false"],
      ["b", "node missing.mjs"],
      ["c", "git status --no-such-path"]
    ] as const) {
      appendInfection(
        dir,
        infection(id, "session-1", {
          details: {
            type: "command-failure",
            command,
            normalized_command: command,
            exit_code: 1,
            output_tail: ""
          }
        })
      )
    }

    parseBlock(runHook(dir, { session_id: "session-1" }))
    const saved = loadState(dir, "session-1")
    expect(saved.next_event_seq).toBe(7)
    expect(saved.injected).toEqual(state.injected)
    expect(loadStats(dir).distill.last_nag_digest).toMatch(/^[0-9a-f]{64}$/)
  })
})
