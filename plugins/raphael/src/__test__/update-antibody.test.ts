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
import { commandLogPath } from "../lib/command-log.js"
import { configPath } from "../lib/config.js"
import { appendInfection, readInfections } from "../lib/infection-store.js"
import { loadStats, saveStats, statsFilePath } from "../lib/stats-store.js"
import type { Antibody, InfectionRecordV1 } from "../lib/types.js"
import { runTs } from "../testing/run-ts.js"

const CLI = fileURLToPath(new URL("../update-antibody.ts", import.meta.url))

function project(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), "raphael-update-"))
}

function invoke(
  dir: string,
  args: string[],
  input: unknown = {}
): Promise<{ code: number | null; stdout: string; stderr: string }> {
  const options = {
    cwd: dir,
    env: { ...process.env, CLAUDE_PROJECT_DIR: dir },
    input: typeof input === "string" ? input : JSON.stringify(input)
  }
  try {
    return Promise.resolve({
      code: 0,
      stdout: runTs(CLI, args, options),
      stderr: ""
    })
  } catch (error) {
    if (typeof error !== "object" || error === null)
      return Promise.reject(error)
    const failed = error as {
      status?: unknown
      stdout?: unknown
      stderr?: unknown
    }
    return Promise.resolve({
      code: typeof failed.status === "number" ? failed.status : null,
      stdout: outputText(failed.stdout),
      stderr: outputText(failed.stderr)
    })
  }
}

function outputText(value: unknown): string {
  if (typeof value === "string") return value
  if (Buffer.isBuffer(value)) return value.toString("utf8")
  return ""
}

function antibody(overrides: Partial<Antibody> = {}): Antibody {
  return {
    id: "ab-2026-0724-001",
    created: "2026-07-24",
    source: "manual",
    trigger: { event: "PreToolUse", tool: "Bash", pattern: "pnpm test" },
    status: "active",
    expires: "2026-08-01",
    body: "Run focused tests.",
    ...overrides
  }
}

function infection(): InfectionRecordV1 {
  return {
    schema_version: 1,
    id: "infection-20260724-000000-0000-aaaaaaaa",
    ts: "2026-07-24T00:00:00.000Z",
    kind: "command-failure",
    session: "session-1",
    hook_event: "PostToolUse",
    tool: "Bash",
    tool_use_id: "tool-1",
    input_digest: "digest",
    evidence: "failure",
    fingerprint: "a".repeat(64),
    details: {
      type: "command-failure",
      command: "pnpm test",
      normalized_command: "pnpm test",
      exit_code: 1,
      output_tail: "failure"
    },
    distilled: false,
    distilled_at: null
  }
}

function json(result: { stdout: string }): Record<string, unknown> {
  return JSON.parse(result.stdout) as Record<string, unknown>
}

function seedCommands(dir: string, commands: string[]): void {
  const file = commandLogPath(dir)
  fs.mkdirSync(path.dirname(file), { recursive: true })
  fs.writeFileSync(
    file,
    `${commands
      .map((normalized_command, index) =>
        JSON.stringify({
          ts: `2026-09-08T00:00:${String(index % 60).padStart(2, "0")}.000Z`,
          session: "session-1",
          normalized_command,
          exit_code: 0,
          failed: false
        })
      )
      .join("\n")}\n`
  )
}

function createRequest(
  trigger: Antibody["trigger"] = {
    event: "PreToolUse",
    tool: "Bash",
    pattern: "pnpm test"
  }
): Record<string, unknown> {
  return {
    source: "infection-1",
    trigger,
    expires: "2026-10-20",
    body: "Run focused tests."
  }
}

function writeConfig(dir: string, frontmatter: string): void {
  const file = configPath(dir)
  fs.mkdirSync(path.dirname(file), { recursive: true })
  fs.writeFileSync(file, `---\n${frontmatter}\n---\n`)
}

// extend の期待値は実行日に依存する(record-fire が last_fired に当日を書くため)。
// 日付を固定値で書くと日付が変わった瞬間に落ちるので、実装と同じ式で導出する。
function addDays(date: string, days: number): string {
  const value = new Date(`${date}T00:00:00.000Z`)
  value.setUTCDate(value.getUTCDate() + days)
  return value.toISOString().slice(0, 10)
}

const DEFAULT_EXPIRY_DAYS = 30
const MAX_LIFETIME_DAYS = 90

test("create/patch dry-run/patch/status transition/extend/fire が exit 0 で store 経由更新する", async () => {
  const dir = project()
  try {
    const created = await invoke(dir, ["create"], {
      source: "infection-1",
      trigger: { event: "PreToolUse", tool: "Bash", pattern: "pnpm test" },
      expires: "2026-08-20",
      body: "Run focused tests."
    })
    expect(created).toMatchObject({ code: 0, stderr: "" })
    const id = (json(created).antibody as Antibody).id

    const dryRun = await invoke(dir, ["patch", "--dry-run", id], {
      source: "changed",
      body: "Changed guidance."
    })
    expect(dryRun).toMatchObject({ code: 0, stderr: "" })
    expect(json(dryRun)).toMatchObject({
      ok: true,
      dry_run: true,
      antibody: { id, source: "changed", body: "Changed guidance." },
      diff: ["source", "body"]
    })
    expect(readAntibody(dir, id).source).toBe("infection-1")

    expect((await invoke(dir, ["patch", id], { source: "changed" })).code).toBe(
      0
    )
    expect(readAntibody(dir, id).source).toBe("changed")
    expect((await invoke(dir, ["record-fire", id])).code).toBe(0)
    expect((await invoke(dir, ["set-status", id, "confirmed"])).code).toBe(0)
    expect((await invoke(dir, ["set-status", id, "expired"])).code).toBe(0)
    expect(readAntibody(dir, id).status).toBe("expired")

    const firedStats = loadStats(dir).antibodies[id]
    const extended = await invoke(dir, ["extend", id])
    expect(extended.code).toBe(0)
    const after = readAntibody(dir, id)
    const lastFired = firedStats?.last_fired as string
    expect(after).toMatchObject({
      status: "active",
      expires: [
        addDays(lastFired, DEFAULT_EXPIRY_DAYS),
        addDays(after.created, MAX_LIFETIME_DAYS)
      ].sort()[0]
    })
    const recordedAgain = await invoke(dir, ["record-fire", id])
    expect(recordedAgain.code).toBe(0)
    expect(json(recordedAgain)).toMatchObject({
      ok: true,
      antibody: { id },
      stats: {
        fired: 2,
        last_fired: expect.any(String),
        misses: 0,
        last_miss: null
      }
    })
    expect(loadStats(dir).antibodies[id]?.fired).toBe(2)
    expect(readAntibody(dir, id)).not.toHaveProperty("stats")
  } finally {
    fs.rmSync(dir, { recursive: true, force: true })
  }
})

test("confirmed extend と全 not-found mark-distilled は no-op exit 0、mark は全 session を更新する", async () => {
  const dir = project()
  try {
    writeAntibodyCreate(dir, antibody({ status: "confirmed" }))
    const extended = await invoke(dir, ["extend", "ab-2026-0724-001"])
    expect(extended).toMatchObject({ code: 0, stderr: "" })
    expect(json(extended)).toMatchObject({ ok: true, no_op: true })

    appendInfection(dir, infection())
    const marked = await invoke(dir, ["mark-distilled"], {
      ids: [infection().id, "missing"]
    })
    expect(marked).toMatchObject({ code: 0, stderr: "" })
    expect(json(marked)).toMatchObject({
      ok: true,
      updated: 1,
      not_found: ["missing"]
    })
    expect(readInfections(dir, "session-1")[0]).toMatchObject({
      distilled: true
    })

    const noOp = await invoke(dir, ["mark-distilled"], { ids: ["not-present"] })
    expect(noOp.code).toBe(0)
    expect(json(noOp)).toMatchObject({
      ok: true,
      updated: 0,
      not_found: ["not-present"]
    })
  } finally {
    fs.rmSync(dir, { recursive: true, force: true })
  }
})

function legacyAntibodyMarkdown(
  id: string,
  fired: number,
  lastFired: string | null,
  body = `Guidance for ${id}`
): string {
  return `---
id: ${id}
created: 2026-07-24
source: legacy
trigger:
  event: PreToolUse
  tool: Bash
  pattern: "pnpm test"
status: active
stats:
  fired: ${fired}
  last_fired: ${lastFired ?? "null"}
expires: 2026-08-23
---

${body}
`
}

function writeLegacy(
  dir: string,
  id: string,
  fired: number,
  lastFired: string | null
): string {
  const file = path.join(dir, ".raphael", "antibodies", `${id}.md`)
  fs.mkdirSync(path.dirname(file), { recursive: true })
  fs.writeFileSync(file, legacyAntibodyMarkdown(id, fired, lastFired))
  return file
}

test("migrate-stats は旧形式 3 件を stats.json へ移し md から stats を除去して冪等", async () => {
  const dir = project()
  try {
    const files = [
      writeLegacy(dir, "ab-2026-0724-001", 3, "2026-07-24"),
      writeLegacy(dir, "ab-2026-0724-002", 0, null),
      writeLegacy(dir, "ab-2026-0724-003", 8, "2026-07-25")
    ]

    const first = await invoke(dir, ["migrate-stats"])
    expect(first).toMatchObject({ code: 0, stderr: "" })
    expect(json(first)).toEqual({
      ok: true,
      dry_run: false,
      migrated: 3,
      skipped: 0,
      ids: ["ab-2026-0724-001", "ab-2026-0724-002", "ab-2026-0724-003"],
      errors: []
    })
    expect(loadStats(dir).antibodies).toEqual({
      "ab-2026-0724-001": {
        fired: 3,
        last_fired: "2026-07-24",
        misses: 0,
        last_miss: null
      },
      "ab-2026-0724-002": {
        fired: 0,
        last_fired: null,
        misses: 0,
        last_miss: null
      },
      "ab-2026-0724-003": {
        fired: 8,
        last_fired: "2026-07-25",
        misses: 0,
        last_miss: null
      }
    })
    for (const file of files) {
      expect(fs.readFileSync(file, "utf8")).not.toContain("\nstats:\n")
    }

    const statsBefore = fs.readFileSync(statsFilePath(dir), "utf8")
    const filesBefore = files.map((file) => fs.readFileSync(file, "utf8"))
    const second = await invoke(dir, ["migrate-stats"])
    expect(json(second)).toEqual({
      ok: true,
      dry_run: false,
      migrated: 0,
      skipped: 3,
      ids: [],
      errors: []
    })
    expect(fs.readFileSync(statsFilePath(dir), "utf8")).toBe(statsBefore)
    expect(files.map((file) => fs.readFileSync(file, "utf8"))).toEqual(
      filesBefore
    )
  } finally {
    fs.rmSync(dir, { recursive: true, force: true })
  }
})

test("migrate-stats --dry-run はファイルも stats.json も書かない", async () => {
  const dir = project()
  try {
    const file = writeLegacy(dir, "ab-2026-0724-001", 4, "2026-07-24")
    const before = fs.readFileSync(file, "utf8")

    const result = await invoke(dir, ["--dry-run", "migrate-stats"])
    expect(result).toMatchObject({ code: 0, stderr: "" })
    expect(json(result)).toMatchObject({
      ok: true,
      dry_run: true,
      migrated: 1,
      skipped: 0,
      ids: ["ab-2026-0724-001"],
      errors: []
    })
    expect(fs.readFileSync(file, "utf8")).toBe(before)
    expect(fs.existsSync(statsFilePath(dir))).toBe(false)
  } finally {
    fs.rmSync(dir, { recursive: true, force: true })
  }
})

test("migrate-stats は既存 stats と fired/date を max merge し misses を保持する", async () => {
  const dir = project()
  try {
    writeLegacy(dir, "ab-2026-0724-001", 4, "2026-07-24")
    writeLegacy(dir, "ab-2026-0724-002", 9, "2026-07-26")
    saveStats(dir, {
      schema_version: 1,
      antibodies: {
        "ab-2026-0724-001": {
          fired: 7,
          last_fired: "2026-07-25",
          misses: 2,
          last_miss: "2026-07-23"
        },
        "ab-2026-0724-002": {
          fired: 3,
          last_fired: "2026-07-25",
          misses: 1,
          last_miss: null
        }
      },
      distill: { last_nag_digest: "d".repeat(64) }
    })

    expect((await invoke(dir, ["migrate-stats"])).code).toBe(0)
    expect(loadStats(dir)).toEqual({
      schema_version: 1,
      antibodies: {
        "ab-2026-0724-001": {
          fired: 7,
          last_fired: "2026-07-25",
          misses: 2,
          last_miss: "2026-07-23"
        },
        "ab-2026-0724-002": {
          fired: 9,
          last_fired: "2026-07-26",
          misses: 1,
          last_miss: null
        }
      },
      distill: { last_nag_digest: "d".repeat(64) }
    })
  } finally {
    fs.rmSync(dir, { recursive: true, force: true })
  }
})

test("migrate-stats は壊れた md を errors に載せて触らず、正常分だけ移行する", async () => {
  const dir = project()
  try {
    writeLegacy(dir, "ab-2026-0724-001", 1, null)
    const broken = path.join(
      dir,
      ".raphael",
      "antibodies",
      "ab-2026-0724-002.md"
    )
    fs.writeFileSync(broken, "broken antibody")
    const before = fs.readFileSync(broken, "utf8")

    const result = await invoke(dir, ["migrate-stats"])
    expect(json(result)).toEqual({
      ok: true,
      dry_run: false,
      migrated: 1,
      skipped: 0,
      ids: ["ab-2026-0724-001"],
      errors: [
        {
          file: "ab-2026-0724-002.md",
          message: "frontmatter: must start with ---"
        }
      ]
    })
    expect(fs.readFileSync(broken, "utf8")).toBe(before)
  } finally {
    fs.rmSync(dir, { recursive: true, force: true })
  }
})

test("migrate-stats は抗体 0 件で migrated:0 を返す", async () => {
  const dir = project()
  try {
    expect(json(await invoke(dir, ["migrate-stats"]))).toEqual({
      ok: true,
      dry_run: false,
      migrated: 0,
      skipped: 0,
      ids: [],
      errors: []
    })
    expect(fs.existsSync(statsFilePath(dir))).toBe(false)
  } finally {
    fs.rmSync(dir, { recursive: true, force: true })
  }
})

test("validation/not found/duplicate/malformed JSON は exit 2 かつ invalid request で bytes を保持する", async () => {
  const dir = project()
  const value = antibody()
  try {
    writeAntibodyCreate(dir, value)
    const file = path.join(dir, ".raphael", "antibodies", `${value.id}.md`)
    const before = fs.readFileSync(file)

    const invalid = await invoke(dir, ["patch", value.id], {
      unsupported: true
    })
    expect(invalid).toMatchObject({ code: 2, stderr: "" })
    expect(json(invalid)).toMatchObject({
      ok: false,
      error: { code: "VALIDATION_ERROR" }
    })
    expect(fs.readFileSync(file)).toEqual(before)

    const missing = await invoke(dir, ["record-fire", "ab-2026-0724-999"])
    expect(missing).toMatchObject({ code: 2, stderr: "" })
    expect(json(missing)).toMatchObject({
      ok: false,
      error: { code: "NOT_FOUND" }
    })

    const duplicate = await invoke(dir, ["create"], value)
    expect(duplicate).toMatchObject({ code: 2, stderr: "" })
    expect(json(duplicate)).toMatchObject({
      ok: false,
      error: { code: "VALIDATION_ERROR" }
    })

    const malformed = await invoke(dir, ["create"], "{not json")
    expect(malformed).toMatchObject({ code: 2, stderr: "" })
    expect(json(malformed)).toMatchObject({
      ok: false,
      error: { code: "INVALID_JSON" }
    })
  } finally {
    fs.rmSync(dir, { recursive: true, force: true })
  }
})

test("母集団 49 件では skipped、50 件では検査し成功結果に breadth が付く", async () => {
  const dir = project()
  try {
    seedCommands(
      dir,
      Array.from({ length: 49 }, (_, index) => `other-${index}`)
    )
    const created = await invoke(
      dir,
      ["create"],
      createRequest({
        event: "PreToolUse",
        tool: "Bash",
        pattern: "^match-"
      })
    )
    expect(created).toMatchObject({ code: 0, stderr: "" })
    expect(json(created)).toMatchObject({
      ok: true,
      breadth: {
        checked: false,
        reason: "corpus_too_small",
        corpus_size: 49
      }
    })

    const id = (json(created).antibody as Antibody).id
    seedCommands(
      dir,
      Array.from({ length: 50 }, (_, index) => `other-${index}`)
    )
    const patched = await invoke(dir, ["patch", id], {
      trigger: { event: "PreToolUse", tool: "Bash", pattern: "^match-" }
    })
    expect(patched).toMatchObject({ code: 0, stderr: "" })
    expect(json(patched)).toMatchObject({
      ok: true,
      breadth: {
        checked: true,
        corpus_size: 50,
        matched: 0,
        ratio: 0
      }
    })
  } finally {
    fs.rmSync(dir, { recursive: true, force: true })
  }
})

test("広い pattern の create は exit 2 で拒否し抗体ファイルを作らない", async () => {
  const dir = project()
  try {
    seedCommands(
      dir,
      Array.from({ length: 50 }, (_, index) => `command-${index}`)
    )
    const result = await invoke(
      dir,
      ["create"],
      createRequest({ event: "PreToolUse", tool: "Bash", pattern: ".*" })
    )

    expect(result).toMatchObject({ code: 2, stderr: "" })
    expect(json(result)).toMatchObject({
      ok: false,
      error: {
        code: "PATTERN_TOO_BROAD",
        message:
          "trigger.pattern: matches 100.0% of 50 known commands (limit 10%)",
        field: "trigger.pattern"
      },
      breadth: {
        checked: true,
        corpus_size: 50,
        matched: 50,
        ratio: 1,
        samples: [
          "command-0",
          "command-1",
          "command-10",
          "command-11",
          "command-12"
        ]
      }
    })
    expect(fs.existsSync(antibodiesDirectory(dir))).toBe(false)
  } finally {
    fs.rmSync(dir, { recursive: true, force: true })
  }
})

test("trigger を含む patch は dry-run と本実行の両方で拒否し抗体を更新しない", async () => {
  const dir = project()
  try {
    const original = antibody()
    writeAntibodyCreate(dir, original)
    seedCommands(
      dir,
      Array.from({ length: 50 }, (_, index) => `command-${index}`)
    )

    const result = await invoke(dir, ["patch", "--dry-run", original.id], {
      trigger: { event: "PreToolUse", tool: "*", pattern: ".*" }
    })
    expect(result.code).toBe(2)
    expect(json(result)).toMatchObject({
      ok: false,
      error: { code: "PATTERN_TOO_BROAD", field: "trigger.pattern" },
      breadth: { checked: true, corpus_size: 50, matched: 50, ratio: 1 }
    })
    expect(readAntibody(dir, original.id)).toEqual(original)

    const actual = await invoke(dir, ["patch", original.id], {
      trigger: { event: "PreToolUse", tool: "*", pattern: ".*" }
    })
    expect(actual.code).toBe(2)
    expect(json(actual)).toMatchObject({
      ok: false,
      error: { code: "PATTERN_TOO_BROAD", field: "trigger.pattern" }
    })
    expect(readAntibody(dir, original.id)).toEqual(original)
  } finally {
    fs.rmSync(dir, { recursive: true, force: true })
  }
})

test("trigger を含まない patch は広さ検査をせず更新する", async () => {
  const dir = project()
  try {
    const original = antibody()
    writeAntibodyCreate(dir, original)
    seedCommands(
      dir,
      Array.from({ length: 50 }, (_, index) => `pnpm test ${index}`)
    )

    const result = await invoke(dir, ["patch", original.id], {
      source: "changed-without-trigger"
    })
    expect(result.code).toBe(0)
    expect(json(result)).not.toHaveProperty("breadth")
    expect(readAntibody(dir, original.id).source).toBe(
      "changed-without-trigger"
    )
  } finally {
    fs.rmSync(dir, { recursive: true, force: true })
  }
})

test("Edit trigger は tool_not_applicable として通す", async () => {
  const dir = project()
  try {
    seedCommands(
      dir,
      Array.from({ length: 50 }, (_, index) => `command-${index}`)
    )
    const result = await invoke(
      dir,
      ["create"],
      createRequest({
        event: "PreToolUse",
        tool: "Edit",
        pattern: ".*"
      })
    )

    expect(result.code).toBe(0)
    expect(json(result)).toMatchObject({
      ok: true,
      breadth: { checked: false, reason: "tool_not_applicable" }
    })
  } finally {
    fs.rmSync(dir, { recursive: true, force: true })
  }
})

test("config の breadth_max_ratio で拒否閾値を変更できる", async () => {
  const dir = project()
  try {
    seedCommands(
      dir,
      Array.from(
        { length: 50 },
        (_, index) => `${index < 6 ? "match" : "other"}-${index}`
      )
    )
    writeConfig(dir, "breadth_max_ratio: 20\nbreadth_min_corpus: 50")

    const result = await invoke(
      dir,
      ["create"],
      createRequest({
        event: "PreToolUse",
        tool: "Bash",
        pattern: "^match-"
      })
    )
    expect(result.code).toBe(0)
    expect(json(result)).toMatchObject({
      ok: true,
      breadth: {
        checked: true,
        corpus_size: 50,
        matched: 6,
        ratio: 0.12
      }
    })
  } finally {
    fs.rmSync(dir, { recursive: true, force: true })
  }
})
