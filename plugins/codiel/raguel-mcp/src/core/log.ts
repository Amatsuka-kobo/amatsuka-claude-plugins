/**
 * stderr 専用ロガー。stdout は MCP の JSON-RPC 専用線であり、
 * console.log 1 行で transport が壊れるため、全ログはここを通す。
 */

type Level = "debug" | "info" | "warn" | "error"

const LEVEL_ORDER: Record<Level, number> = {
  debug: 0,
  info: 1,
  warn: 2,
  error: 3
}

function minLevel(): Level {
  const env = process.env.RAGUEL_LOG_LEVEL
  return env && env in LEVEL_ORDER ? (env as Level) : "info"
}

function write(level: Level, message: string, data?: unknown): void {
  if (LEVEL_ORDER[level] < LEVEL_ORDER[minLevel()]) return
  const suffix = data === undefined ? "" : ` ${safeStringify(data)}`
  process.stderr.write(`[raguel:${level}] ${message}${suffix}\n`)
}

function safeStringify(data: unknown): string {
  try {
    return JSON.stringify(data)
  } catch {
    return String(data)
  }
}

export const log = {
  debug: (message: string, data?: unknown) => write("debug", message, data),
  info: (message: string, data?: unknown) => write("info", message, data),
  warn: (message: string, data?: unknown) => write("warn", message, data),
  error: (message: string, data?: unknown) => write("error", message, data)
}
