import { z } from "zod"
import { createJevCall, describeJevError, type JevCall } from "../jev/client.js"

export type ErrorKind =
  | "not_configured"
  | "api_error"
  | "budget_exceeded"
  | "invalid_input"
  | "playwright_missing"
  | "browser_failed"
  | "setup_failed"
  | "request_failed"

export type ErrorBody = {
  error: {
    kind: ErrorKind
    message: string
    errorClass?: string
    status?: number
    requestId?: string
  }
}

export type ToolResponse = {
  [key: string]: unknown
  content: Array<{ type: "text"; text: string }>
  isError?: boolean
}

export function toResponse(result: unknown): ToolResponse {
  return { content: [{ type: "text", text: JSON.stringify(result, null, 2) }] }
}

export function errorResponse(
  kind: ErrorKind,
  message: string,
  extra?: { errorClass?: string; status?: number; requestId?: string }
): ToolResponse {
  return {
    ...toResponse({ error: { kind, message, ...extra } }),
    isError: true
  }
}

export function jevErrorResponse(err: unknown): ToolResponse {
  const error = describeJevError(err)
  return errorResponse("api_error", error.message, error)
}

export function notConfiguredResponse(): ToolResponse {
  return errorResponse(
    "not_configured",
    "Set TYPESAFE_API_KEY in the environment and restart the server."
  )
}

export const thresholdsSchema = z
  .object({
    satisfied: z.number().gt(0).lt(1).default(0.8),
    unsatisfied: z.number().gt(0).lt(1).default(0.2)
  })
  .default({ satisfied: 0.8, unsatisfied: 0.2 })

export const evidenceSchema = z
  .enum(["always", "on_failure", "none"])
  .default("always")
export const nameSchema = z.string().optional()

export function resolveProjectDir(
  env: NodeJS.ProcessEnv,
  cwd: () => string
): string {
  return env.CLAUDE_PROJECT_DIR ?? cwd()
}

export type ToolDeps = {
  jev: JevCall
  env: NodeJS.ProcessEnv
  projectDir: string
  now: () => Date
  httpFetch: typeof fetch
}

export function createToolDeps(env: NodeJS.ProcessEnv): ToolDeps {
  return {
    jev: createJevCall({ apiKey: env.TYPESAFE_API_KEY }),
    env,
    projectDir: resolveProjectDir(env, () => process.cwd()),
    now: () => new Date(),
    httpFetch: fetch
  }
}
