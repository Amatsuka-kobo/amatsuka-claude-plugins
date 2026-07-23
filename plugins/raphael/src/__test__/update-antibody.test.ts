import { spawn } from "node:child_process"
import fs from "node:fs"
import { createRequire } from "node:module"
import os from "node:os"
import path from "node:path"
import { fileURLToPath } from "node:url"
import { expect, test } from "vitest"
import { readAntibody, writeAntibodyCreate } from "../lib/antibody-store.js"
import { appendInfection, readInfections } from "../lib/infection-store.js"
import type { Antibody, InfectionRecordV1 } from "../lib/types.js"

const CLI = fileURLToPath(new URL("../update-antibody.ts", import.meta.url))
const TSX = createRequire(import.meta.url).resolve("tsx/cli")

function project(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), "raphael-update-"))
}

function invoke(
  dir: string,
  args: string[],
  input: unknown = {}
): Promise<{ code: number | null; stdout: string; stderr: string }> {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [TSX, CLI, "--dir", dir, ...args], {
      cwd: dir
    })
    let stdout = ""
    let stderr = ""
    child.stdout.on("data", (chunk: Buffer) => {
      stdout += chunk
    })
    child.stderr.on("data", (chunk: Buffer) => {
      stderr += chunk
    })
    child.on("error", reject)
    child.on("close", (code) => resolve({ code, stdout, stderr }))
    child.stdin.end(typeof input === "string" ? input : JSON.stringify(input))
  })
}

function antibody(overrides: Partial<Antibody> = {}): Antibody {
  return {
    id: "ab-2026-0724-001",
    created: "2026-07-24",
    source: "manual",
    trigger: { event: "PreToolUse", tool: "Bash", pattern: "pnpm test" },
    status: "active",
    stats: { fired: 1, last_fired: "2026-07-24" },
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

    const extended = await invoke(dir, ["extend", id])
    expect(extended.code).toBe(0)
    expect(readAntibody(dir, id)).toMatchObject({
      status: "active",
      expires: "2026-08-23"
    })
    expect((await invoke(dir, ["record-fire", id])).code).toBe(0)
    expect(readAntibody(dir, id).stats.fired).toBe(2)
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
