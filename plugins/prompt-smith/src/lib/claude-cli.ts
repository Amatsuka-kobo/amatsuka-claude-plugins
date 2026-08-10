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
 */

import { spawn } from "node:child_process"

export interface Environment {
  base_url: string
  auth_source: string
  model: string | null
}

const AUTH_VARS = ["ANTHROPIC_API_KEY", "ANTHROPIC_AUTH_TOKEN"] as const

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
  timeoutSeconds = 300
): Promise<string> {
  const args = ["-p", "--output-format", "text"]
  if (model) args.push("--model", model)

  return await new Promise<string>((resolve, reject) => {
    const child = spawn("claude", args, { env: buildEnv() })
    let stdout = ""
    let stderr = ""
    const timer = setTimeout(() => {
      child.kill("SIGKILL")
      reject(new Error(`claude -p timed out after ${timeoutSeconds}s`))
    }, timeoutSeconds * 1000)

    child.stdout.on("data", (chunk) => {
      stdout += String(chunk)
    })
    child.stderr.on("data", (chunk) => {
      stderr += String(chunk)
    })
    child.on("error", (error) => {
      clearTimeout(timer)
      reject(error)
    })
    child.on("close", (code) => {
      clearTimeout(timer)
      if (code !== 0) {
        reject(new Error(`claude -p exited ${code}\nstderr: ${stderr}`))
        return
      }
      resolve(stdout)
    })

    child.stdin.write(prompt)
    child.stdin.end()
  })
}
