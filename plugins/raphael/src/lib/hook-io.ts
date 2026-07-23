import fs from "node:fs"
import path from "node:path"
import type { HookInput } from "./types.js"

export function readStdinSync(): HookInput | null {
  try {
    const value: unknown = JSON.parse(fs.readFileSync(0, "utf8"))
    return typeof value === "object" && value !== null && !Array.isArray(value)
      ? (value as HookInput)
      : null
  } catch {
    return null
  }
}

export function resolveProjectDir(input: HookInput): string {
  return process.env.CLAUDE_PROJECT_DIR || input.cwd || process.cwd()
}

// Hook の失敗はセッションを止めない。ログ不能時も同様に無視する。
export function logError(
  projectDir: string,
  context: string,
  error: unknown
): void {
  try {
    const logDir = path.join(projectDir, ".raphael", "log")
    fs.mkdirSync(logDir, { recursive: true })
    const message =
      error instanceof Error ? (error.stack ?? error.message) : String(error)
    fs.appendFileSync(
      path.join(logDir, "errors.log"),
      `${new Date().toISOString()} [${context}] ${message}\n`
    )
  } catch {
    // Logging must never affect hook execution.
  }
}
