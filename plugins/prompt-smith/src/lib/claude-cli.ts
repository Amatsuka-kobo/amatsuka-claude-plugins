/**
 * Copyright 2026 amatsuka-koubou
 * Copyright Anthropic, PBC
 *
 * Licensed under the Apache License, Version 2.0.
 *
 * Ported from the subprocess handling in scripts/run_eval.py and
 * scripts/improve_description.py of the skill-creator Claude Code plugin.
 *
 * Added: describeEnvironment records which auth path was used. Only the NAME
 * of the environment variable is recorded, never its value.
 * Added: child processes use an isolated temporary cwd and CLI isolation flags,
 * and cleanup waits for the child process close event after termination.
 */

import { type ChildProcess, spawn } from "node:child_process"
import { createIsolatedWorkspace } from "./sandbox.js"

export interface Environment {
  base_url: string
  auth_source: string
  model: string | null
}

const AUTH_VARS = ["ANTHROPIC_API_KEY", "ANTHROPIC_AUTH_TOKEN"] as const

export const ISOLATION_ARGS = [
  "--setting-sources",
  "project",
  "--strict-mcp-config",
  "--settings",
  '{"disableAllHooks":true}',
  "--no-session-persistence"
] as const

export type SpawnFn = typeof import("node:child_process").spawn

export interface ClaudeTextDeps {
  spawn?: SpawnFn
  createWorkspace?: typeof createIsolatedWorkspace
}

export function buildEnv(
  env: NodeJS.ProcessEnv = process.env
): NodeJS.ProcessEnv {
  const copy: NodeJS.ProcessEnv = {}
  for (const [key, value] of Object.entries(env)) {
    if (key === "CLAUDECODE") continue
    copy[key] = value
  }
  return copy
}

export function buildSpawnOptions(
  cwd: string,
  env: NodeJS.ProcessEnv = process.env
): { cwd: string; env: NodeJS.ProcessEnv } {
  return { cwd, env: buildEnv(env) }
}

export function buildEvalArgs(
  query: string,
  model: string | undefined
): string[] {
  const args = [
    "-p",
    query,
    "--output-format",
    "stream-json",
    "--verbose",
    "--include-partial-messages"
  ]
  if (model) args.push("--model", model)
  args.push(...ISOLATION_ARGS)
  return args
}

export function buildTextArgs(model: string | undefined): string[] {
  const args = ["-p", "--output-format", "text"]
  if (model) args.push("--model", model)
  args.push(...ISOLATION_ARGS)
  return args
}

export function killThenSettle(child: ChildProcess, settle: () => void): void {
  if (child.exitCode === null && child.signalCode === null) {
    child.once("close", settle)
    child.kill("SIGKILL")
    return
  }
  settle()
}

export function describeEnvironment(
  model: string | undefined,
  env: NodeJS.ProcessEnv = process.env
): Environment {
  const authSource = AUTH_VARS.find((name) => env[name]) ?? "(claude.ai login)"
  return {
    base_url: env.ANTHROPIC_BASE_URL ?? "(default)",
    auth_source: authSource,
    model: model ?? null
  }
}

/** `claude -p` を text 出力で 1 回呼び、標準出力を返す。プロンプトは stdin へ渡す。 */
export async function callClaudeText(
  prompt: string,
  model: string | undefined,
  timeoutSeconds = 300,
  deps?: ClaudeTextDeps
): Promise<string> {
  const spawnClaude = deps?.spawn ?? spawn
  const createWorkspace = deps?.createWorkspace ?? createIsolatedWorkspace
  const workspace = await createWorkspace()

  try {
    return await new Promise<string>((resolve, reject) => {
      const child = spawnClaude(
        "claude",
        buildTextArgs(model),
        buildSpawnOptions(workspace.dir)
      )
      let stdout = ""
      let stderr = ""
      let state: "running" | "timeout" | "settled" = "running"
      const timeoutError = new Error(
        `claude -p timed out after ${timeoutSeconds}s`
      )
      const timer = setTimeout(() => {
        if (state !== "running") return
        state = "timeout"
        killThenSettle(child, () => {
          if (state !== "timeout") return
          state = "settled"
          reject(timeoutError)
        })
      }, timeoutSeconds * 1000)

      child.stdout.on("data", (chunk) => {
        stdout += String(chunk)
      })
      child.stderr.on("data", (chunk) => {
        stderr += String(chunk)
      })
      child.on("error", (error) => {
        if (state === "settled") return
        state = "settled"
        clearTimeout(timer)
        reject(error)
      })
      child.on("close", (code) => {
        clearTimeout(timer)
        if (state !== "running") return
        state = "settled"
        if (code !== 0) {
          reject(new Error(`claude -p exited ${code}\nstderr: ${stderr}`))
          return
        }
        resolve(stdout)
      })

      child.stdin.write(prompt)
      child.stdin.end()
    })
  } finally {
    await workspace.cleanup()
  }
}
