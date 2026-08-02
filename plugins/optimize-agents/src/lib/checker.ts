import { spawn } from "node:child_process"
import { rm, writeFile } from "node:fs/promises"
import { join } from "node:path"

export interface CheckerSpec {
  checker: string
  cwd: string
  outDir: string
  evalId: number
  runDir: string
}

export interface CheckerResult {
  ok: boolean
  error?: string
}

interface CommandResult {
  code: number | null
  stdout: string
  stderr: string
}

function executeChecker(spec: CheckerSpec): Promise<CommandResult> {
  return new Promise((resolve, reject) => {
    const child = spawn(
      "sh",
      [
        "-c",
        `${spec.checker} "$1" "$2"`,
        "checker",
        spec.outDir,
        String(spec.evalId)
      ],
      { cwd: spec.cwd, stdio: ["ignore", "pipe", "pipe"] }
    )
    let stdout = ""
    let stderr = ""
    child.stdout.on("data", (chunk) => {
      stdout += chunk.toString()
    })
    child.stderr.on("data", (chunk) => {
      stderr += chunk.toString()
    })
    child.on("error", reject)
    child.on("close", (code) => resolve({ code, stdout, stderr }))
  })
}

async function recordError(spec: CheckerSpec, error: string): Promise<void> {
  await rm(join(spec.runDir, "grading.json"), { force: true })
  await writeFile(join(spec.runDir, "checker-error.txt"), error)
}

export async function runChecker(spec: CheckerSpec): Promise<CheckerResult> {
  await rm(join(spec.runDir, "checker-error.txt"), { force: true })

  let result: CommandResult
  try {
    result = await executeChecker(spec)
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    await recordError(spec, message)
    return { ok: false, error: message }
  }

  if (result.code !== 0) {
    const message = result.stderr || `checker exited with code ${result.code}`
    await recordError(spec, message)
    return { ok: false, error: message }
  }

  try {
    JSON.parse(result.stdout)
  } catch {
    const message = result.stderr
      ? `${result.stderr}\nchecker stdout was not valid JSON:\n${result.stdout}`
      : `checker stdout was not valid JSON:\n${result.stdout}`
    await recordError(spec, message)
    return { ok: false, error: message }
  }

  await writeFile(join(spec.runDir, "grading.json"), result.stdout)
  return { ok: true }
}
