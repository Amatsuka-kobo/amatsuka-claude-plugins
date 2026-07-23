import { spawn } from "node:child_process"
import fs from "node:fs"
import { createRequire } from "node:module"
import os from "node:os"
import path from "node:path"
import { fileURLToPath } from "node:url"
import { expect, test } from "vitest"
import { serializeAntibodyMarkdown } from "../lib/frontmatter.js"
import type { Antibody } from "../lib/types.js"

const CLI = fileURLToPath(new URL("../list-antibodies.ts", import.meta.url))
const TSX = createRequire(import.meta.url).resolve("tsx/cli")

function project(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), "raphael-list-"))
}

function writeAntibody(dir: string, value: Antibody): void {
  const target = path.join(dir, ".raphael", "antibodies")
  fs.mkdirSync(target, { recursive: true })
  fs.writeFileSync(
    path.join(target, `${value.id}.md`),
    serializeAntibodyMarkdown(value)
  )
}

function antibody(overrides: Partial<Antibody> = {}): Antibody {
  return {
    id: "ab-2026-0724-001",
    created: "2026-07-24",
    source: "manual",
    trigger: { event: "PreToolUse", tool: "Bash", pattern: "pnpm test" },
    status: "active",
    stats: { fired: 2, last_fired: "2026-07-24" },
    expires: "2026-08-23",
    body: "Run focused tests.",
    ...overrides
  }
}

function invoke(
  dir: string,
  args: string[],
  env = process.env
): Promise<{ code: number | null; stdout: string; stderr: string }> {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [TSX, CLI, ...args], {
      cwd: dir,
      env
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
  })
}

test("JSON list は filter、sort、body inclusion が安定し、--dir が環境と cwd より優先する", async () => {
  const dir = project()
  const wrong = project()
  try {
    writeAntibody(dir, antibody())
    writeAntibody(
      dir,
      antibody({
        id: "ab-2026-0723-001",
        status: "confirmed",
        stats: { fired: 0, last_fired: null },
        body: "Confirmed guidance."
      })
    )

    const filtered = await invoke(
      dir,
      ["--dir", dir, "--json", "--status", "active"],
      {
        ...process.env,
        CLAUDE_PROJECT_DIR: wrong
      }
    )
    expect(filtered).toMatchObject({ code: 0, stderr: "" })
    expect(JSON.parse(filtered.stdout)).toEqual({
      ok: true,
      antibodies: [
        expect.objectContaining({ id: "ab-2026-0724-001", status: "active" })
      ],
      errors: []
    })
    expect(JSON.parse(filtered.stdout).antibodies[0]).not.toHaveProperty("body")

    const included = await invoke(
      dir,
      ["--json", "--include-body", "--id", "ab-2026-0723-001"],
      {
        ...process.env,
        CLAUDE_PROJECT_DIR: dir
      }
    )
    expect(included.code).toBe(0)
    expect(JSON.parse(included.stdout).antibodies).toEqual([
      expect.objectContaining({
        id: "ab-2026-0723-001",
        body: "Confirmed guidance."
      })
    ])
  } finally {
    fs.rmSync(dir, { recursive: true, force: true })
    fs.rmSync(wrong, { recursive: true, force: true })
  }
})

test("既定 human list、引数エラー(2)、I/Oエラー(1) を分類する", async () => {
  const dir = project()
  const notDirectory = path.join(dir, "not-directory")
  fs.writeFileSync(notDirectory, "x")
  try {
    writeAntibody(dir, antibody())
    const human = await invoke(dir, [])
    expect(human).toMatchObject({ code: 0, stderr: "" })
    expect(human.stdout).toContain("ID")
    expect(human.stdout).toContain("ab-2026-0724-001")

    const invalid = await invoke(dir, ["--json", "--status", "unknown"])
    expect(invalid).toMatchObject({ code: 2, stderr: "" })
    expect(JSON.parse(invalid.stdout)).toMatchObject({
      ok: false,
      error: { code: "VALIDATION_ERROR", field: "status" }
    })

    const io = await invoke(dir, ["--json", "--dir", notDirectory])
    expect(io).toMatchObject({ code: 1, stderr: "" })
    expect(JSON.parse(io.stdout)).toMatchObject({
      ok: false,
      error: { code: "IO_ERROR" }
    })
  } finally {
    fs.rmSync(dir, { recursive: true, force: true })
  }
})
