import fs from "node:fs"
import path from "node:path"
import { logError } from "./hook-io.js"

export interface CommandLogEntry {
  ts: string
  session: string
  normalized_command: string
  exit_code: number | null
  failed: boolean
}

export function commandLogPath(projectDir: string): string {
  return path.join(projectDir, ".raphael", "commands.jsonl")
}

export function appendCommandLog(
  projectDir: string,
  entry: CommandLogEntry
): void {
  try {
    if (!isCommandLogEntry(entry)) return
    const filePath = commandLogPath(projectDir)
    fs.mkdirSync(path.dirname(filePath), { recursive: true })
    fs.appendFileSync(filePath, `${JSON.stringify(entry)}\n`, "utf8")
  } catch (error) {
    logError(projectDir, "command-log", error)
  }
}

export function readCommandLog(projectDir: string): CommandLogEntry[] {
  try {
    const raw = fs.readFileSync(commandLogPath(projectDir), "utf8")
    const lines = raw.split(/\r?\n/)
    if (lines.at(-1) === "") lines.pop()

    const entries: CommandLogEntry[] = []
    for (const line of lines) {
      try {
        const parsed: unknown = JSON.parse(line)
        if (isCommandLogEntry(parsed)) entries.push(parsed)
      } catch {
        // Ignore malformed JSONL rows.
      }
    }
    return entries
  } catch {
    return []
  }
}

export function truncateCommandLog(
  projectDir: string,
  maxLines: number
): number {
  try {
    const filePath = commandLogPath(projectDir)
    const raw = fs.readFileSync(filePath, "utf8")
    const lines = raw.split(/\r?\n/)
    if (lines.at(-1) === "") lines.pop()

    const limit = Number.isFinite(maxLines)
      ? Math.max(0, Math.floor(maxLines))
      : 0
    if (lines.length <= limit) return 0

    const removed = lines.length - limit
    const retained = lines.slice(removed)
    fs.writeFileSync(
      filePath,
      retained.length === 0 ? "" : `${retained.join("\n")}\n`
    )
    return removed
  } catch (error) {
    logError(projectDir, "command-log", error)
    return 0
  }
}

function isCommandLogEntry(value: unknown): value is CommandLogEntry {
  return (
    typeof value === "object" &&
    value !== null &&
    !Array.isArray(value) &&
    typeof (value as Record<string, unknown>).ts === "string" &&
    typeof (value as Record<string, unknown>).session === "string" &&
    typeof (value as Record<string, unknown>).normalized_command === "string" &&
    ((value as Record<string, unknown>).exit_code === null ||
      (typeof (value as Record<string, unknown>).exit_code === "number" &&
        Number.isInteger((value as Record<string, unknown>).exit_code))) &&
    typeof (value as Record<string, unknown>).failed === "boolean"
  )
}
