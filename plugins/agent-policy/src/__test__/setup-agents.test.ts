import { spawn } from "node:child_process"
import fs from "node:fs"
import { createRequire } from "node:module"
import os from "node:os"
import path from "node:path"
import { fileURLToPath } from "node:url"
import { expect, test } from "vitest"
import { runTs } from "../testing/run-ts.js"

const CLI = fileURLToPath(new URL("../setup-agents.ts", import.meta.url))
const PLUGIN_ROOT = fileURLToPath(new URL("../../", import.meta.url))
const TSX = createRequire(import.meta.url).resolve("tsx/cli")

const DEFAULT_ALIASES = {
  gpt: {
    "gpt-sol": "claude-gpt-5-6-sol",
    "gpt-terra": "claude-gpt-5-6-terra",
    "gpt-luna": "claude-gpt-5-6-luna"
  },
  grok: {
    "grok-researcher": "claude-grok-4-5",
    "grok-implementer": "claude-grok-4-5"
  }
} as const

function project(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), "agent-policy-setup-"))
}

function environment(): NodeJS.ProcessEnv {
  return { ...process.env, CLAUDE_PLUGIN_ROOT: PLUGIN_ROOT }
}

function command(dir: string, args: string[]): Record<string, unknown> {
  const stdout = runTs(CLI, args, { cwd: dir, env: environment() })
  expect(stdout.endsWith("\n")).toBe(true)
  return JSON.parse(stdout) as Record<string, unknown>
}

function template(profile: "gpt" | "grok", name: string): string {
  return fs.readFileSync(
    path.join(
      PLUGIN_ROOT,
      "skills",
      `setup-${profile}`,
      "assets",
      `${name}.template.md`
    ),
    "utf8"
  )
}

function invoke(
  dir: string,
  args: string[]
): Promise<{ code: number | null; stdout: string; stderr: string }> {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [TSX, CLI, ...args], {
      cwd: dir,
      env: environment()
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

test("gpt / grok の全テンプレートを既定エイリアスで逐語的に生成する", () => {
  const dir = project()
  try {
    for (const profile of ["gpt", "grok"] as const) {
      const result = command(dir, ["--profile", profile, "--dir", dir])
      const agents = result.agents as Array<Record<string, unknown>>
      expect(result).toMatchObject({
        ok: true,
        profile,
        outDir: path.join(dir, ".claude", "agents")
      })
      expect(agents).toHaveLength(Object.keys(DEFAULT_ALIASES[profile]).length)

      for (const agent of agents) {
        const name =
          agent.name as keyof (typeof DEFAULT_ALIASES)[typeof profile]
        const alias = DEFAULT_ALIASES[profile][name]
        expect(agent).toMatchObject({
          alias,
          exists: false,
          upToDate: false,
          action: "written",
          path: `.claude/agents/${name}.md`
        })
        expect(
          fs.readFileSync(
            path.join(dir, ".claude", "agents", `${name}.md`),
            "utf8"
          )
        ).toBe(template(profile, name).replace("{{MODEL_ALIAS}}", alias))
      }
    }
  } finally {
    fs.rmSync(dir, { recursive: true, force: true })
  }
})

test("既存ファイルは --overwrite がなければ skipped になり、--check は書き込まない", () => {
  const dir = project()
  const target = path.join(dir, ".claude", "agents", "gpt-sol.md")
  try {
    command(dir, ["--profile", "gpt", "--agents", "gpt-sol", "--dir", dir])
    const current = fs.readFileSync(target, "utf8")

    const checked = command(dir, [
      "--profile",
      "gpt",
      "--agents",
      "gpt-sol",
      "--check",
      "--dir",
      dir
    ])
    expect(checked.agents).toEqual([
      expect.objectContaining({ action: "checked", upToDate: true })
    ])

    fs.writeFileSync(target, "outdated")
    const changed = command(dir, [
      "--profile",
      "gpt",
      "--agents",
      "gpt-sol",
      "--check",
      "--dir",
      dir
    ])
    expect(changed.agents).toEqual([
      expect.objectContaining({ action: "checked", upToDate: false })
    ])
    expect(fs.readFileSync(target, "utf8")).toBe("outdated")

    const skipped = command(dir, [
      "--profile",
      "gpt",
      "--agents",
      "gpt-sol",
      "--dir",
      dir
    ])
    expect(skipped.agents).toEqual([
      expect.objectContaining({ action: "skipped", upToDate: false })
    ])

    const overwritten = command(dir, [
      "--profile",
      "gpt",
      "--agents",
      "gpt-sol",
      "--overwrite",
      "--dir",
      dir
    ])
    expect(overwritten.agents).toEqual([
      expect.objectContaining({ action: "written", upToDate: false })
    ])
    expect(fs.readFileSync(target, "utf8")).toBe(current)
  } finally {
    fs.rmSync(dir, { recursive: true, force: true })
  }
})

test("--agents と --alias は対象とモデルエイリアスを絞り込む", () => {
  const dir = project()
  try {
    const result = command(dir, [
      "--profile",
      "gpt",
      "--agents",
      "gpt-luna",
      "--alias",
      "gpt-luna=custom-model",
      "--dir",
      dir
    ])
    expect(result.agents).toEqual([
      expect.objectContaining({
        name: "gpt-luna",
        alias: "custom-model",
        action: "written"
      })
    ])
    expect(
      fs.readFileSync(
        path.join(dir, ".claude", "agents", "gpt-luna.md"),
        "utf8"
      )
    ).toBe(
      template("gpt", "gpt-luna").replace("{{MODEL_ALIAS}}", "custom-model")
    )
    expect(
      fs.existsSync(path.join(dir, ".claude", "agents", "gpt-sol.md"))
    ).toBe(false)
  } finally {
    fs.rmSync(dir, { recursive: true, force: true })
  }
})

test("不正な profile と agents は JSON エラーと exit 1 を返す", async () => {
  const dir = project()
  try {
    for (const args of [
      ["--profile", "unknown", "--dir", dir],
      ["--profile", "gpt", "--agents", "unknown", "--dir", dir]
    ]) {
      const result = await invoke(dir, args)
      expect(result).toMatchObject({ code: 1, stderr: "" })
      expect(JSON.parse(result.stdout)).toMatchObject({ ok: false })
    }
  } finally {
    fs.rmSync(dir, { recursive: true, force: true })
  }
})
