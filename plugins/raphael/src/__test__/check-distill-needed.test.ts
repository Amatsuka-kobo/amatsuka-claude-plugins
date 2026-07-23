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
import {
  appendInfection,
  computeDistillNagDigest,
  infectionFilePath,
  sha256Hex
} from "../lib/infection-store.js"
import {
  createInitialState,
  loadState,
  saveState,
  stateFilePath
} from "../lib/state-store.js"
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
    stats: { fired: 0, last_fired: null },
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

test("threshold 未満は無出力、到達時だけ全 session の件数と絶対 path を含めて block する", () => {
  withProject((dir) => {
    appendInfection(dir, infection("infection-z", "session-1"))
    appendInfection(dir, infection("infection-a", "session-2"))
    expect(runHook(dir, { session_id: "session-1" })).toBe("")

    appendInfection(dir, infection("infection-β", "session-2"))
    const output = runHook(dir, { session_id: "session-1" })
    const block = parseBlock(output)
    expect(block.decision).toBe("block")
    expect(block.reason).toContain(
      'subagent_type "raphael:antibody-synthesizer"'
    )
    expect(block.reason).toContain(`対象 project: ${dir}`)
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

    expect(loadState(dir, "session-1").last_distill_nag_digest).toBe(
      computeDistillNagDigest(["infection-z", "infection-a", "infection-β"])
    )
  })
})

test("同じ SHA-256 digest では再停止せず、新規 infection 追加後は再通知する", () => {
  withProject((dir) => {
    for (const id of ["infection-c", "infection-a", "infection-b"]) {
      appendInfection(dir, infection(id, "session-1"))
    }

    const first = parseBlock(runHook(dir, { session_id: "session-1" }))
    const firstDigest = loadState(dir, "session-1").last_distill_nag_digest
    expect(first.reason).toContain("未蒸留 infection 件数: 3")
    expect(firstDigest).toBe(
      computeDistillNagDigest(["infection-c", "infection-a", "infection-b"])
    )
    expect(firstDigest).toMatch(/^[0-9a-f]{64}$/)

    expect(runHook(dir, { session_id: "session-1" })).toBe("")
    expect(loadState(dir, "session-1").last_distill_nag_digest).toBe(
      firstDigest
    )

    appendInfection(dir, infection("infection-d", "session-2"))
    const second = parseBlock(runHook(dir, { session_id: "session-1" }))
    expect(second.reason).toContain("未蒸留 infection 件数: 4")
    expect(loadState(dir, "session-1").last_distill_nag_digest).toBe(
      computeDistillNagDigest([
        "infection-c",
        "infection-a",
        "infection-b",
        "infection-d"
      ])
    )
  })
})

test("state atomic 保存失敗時は完全無出力で旧 digest を維持し、次回再試行する", () => {
  withProject((dir) => {
    for (const id of ["infection-1", "infection-2", "infection-3"]) {
      appendInfection(dir, infection(id, "session-1"))
    }
    expect(parseBlock(runHook(dir, { session_id: "session-1" })).decision).toBe(
      "block"
    )
    const oldDigest = loadState(dir, "session-1").last_distill_nag_digest

    appendInfection(dir, infection("infection-4", "session-1"))
    fs.chmodSync(path.join(dir, ".raphael"), 0o555)
    expect(runHook(dir, { session_id: "session-1" })).toBe("")
    expect(loadState(dir, "session-1").last_distill_nag_digest).toBe(oldDigest)

    fs.chmodSync(path.join(dir, ".raphael"), 0o755)
    const retried = parseBlock(runHook(dir, { session_id: "session-1" }))
    expect(retried.reason).toContain("未蒸留 infection 件数: 4")
    expect(loadState(dir, "session-1").last_distill_nag_digest).not.toBe(
      oldDigest
    )
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

    cleanupProject(dir, new Date(2026, 6, 24, 12))

    expect(readAntibody(dir, "ab-2026-0724-001").status).toBe("expired")
    expect(readAntibody(dir, "ab-2026-0724-002").status).toBe("active")
    expect(readAntibody(dir, "ab-2026-0724-003").status).toBe("confirmed")
    expect(
      fs.readFileSync(antibodyFilePath(dir, "ab-2026-0724-004"), "utf8")
    ).toBe("broken antibody")
    expect(localDateString(new Date(2026, 6, 24, 23, 59, 59))).toBe(
      "2026-07-24"
    )
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

test("既存 state の他 field を保ったまま digest だけ更新する", () => {
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
    for (const id of ["infection-1", "infection-2", "infection-3"]) {
      appendInfection(dir, infection(id, "session-1"))
    }

    parseBlock(runHook(dir, { session_id: "session-1" }))
    const saved = loadState(dir, "session-1")
    expect(saved.next_event_seq).toBe(7)
    expect(saved.injected).toEqual(state.injected)
  })
})
