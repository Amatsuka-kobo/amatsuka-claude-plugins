import { mkdir, rm, writeFile } from "node:fs/promises"
import { join, resolve } from "node:path"
import type { JevCall } from "./jev/client.js"
import type { Judged } from "./jev/verdict.js"
import { log } from "./log.js"

export type EvidenceMode = "always" | "on_failure" | "none"
export type RunKind = "browser" | "api"
export type RunStatus = "pass" | "fail" | "stuck" | "error"

export type RunRecord = {
  tool: "browser_check" | "browser_run_goal" | "api_check" | "api_run_goal"
  kind: RunKind
  name: string
  status: RunStatus
  reason: string | null
  goal: string | null
  startedAt: string
  finishedAt: string
  durationMs: number
  reached: Judged | null
  assertions: Array<{ assertion: string } & Judged>
  steps: BrowserStep[] | ApiStep[]
  usage: { requests: number; inputTokens: number }
  evidence: { dir: string; files: string[] } | null
  error?: { errorClass: string; message: string; kind?: "budget_exceeded" }
  spec?: { source: string; openapi: string; operations: number }
}

export type BrowserStep = {
  step: number
  action: "click" | "fill" | "select" | "none"
  target: { role: string; name: string }
  input: string | null
  url: string
  screenshot: string | null
  choice: { label: string; confidence: number }
  reached: number
  durationMs: number
  note?: string
}

export type ApiStepValue = {
  target: string
  in: "path" | "query" | "header" | "body"
  source: "input" | "spec" | "response" | "omit"
  ref: string | null
  confidence: number | null
}

export type ApiStep = {
  step: number
  request: string
  method: string
  url: string
  status: number | null
  choice: { label: string; confidence: number }
  reached: number
  durationMs: number
  note?: string
  values?: ApiStepValue[]
  undocumented?: true
}

export type LogEntry =
  | {
      at: string
      kind: "jev"
      state: unknown
      questions: unknown
      answers: unknown
    }
  | {
      at: string
      kind: "exception"
      errorClass: string
      message: string
      stack?: string
    }
  | { at: string; kind: "http"; request: unknown; response: unknown }

function slug(raw: string): string {
  return raw
    .replace(/[^A-Za-z0-9._-]/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 64)
    .replace(/-+$/g, "")
}

export function defaultName(originUrl: string, kind: RunKind): string {
  try {
    const url = new URL(originUrl)
    const raw = kind === "browser" ? `${url.host}${url.pathname}` : url.host
    return slug(raw) || "unnamed"
  } catch {
    return "unnamed"
  }
}

export function normalizeName(
  raw: string | undefined,
  originUrl: string,
  kind: RunKind
): string {
  return (raw === undefined ? "" : slug(raw)) || defaultName(originUrl, kind)
}

export function captureFlags(mode: EvidenceMode): {
  dir: boolean
  trace: boolean
  screenshots: boolean
} {
  const enabled = mode !== "none"
  return { dir: enabled, trace: enabled, screenshots: enabled }
}

export function shouldKeep(mode: EvidenceMode, status: RunStatus): boolean {
  return mode === "always" || (mode === "on_failure" && status !== "pass")
}

export async function createRunDir(
  projectDir: string,
  kind: RunKind,
  name: string,
  now: Date
): Promise<string> {
  const parent = resolve(projectDir, ".jevriel", "runs", kind, name)
  await mkdir(parent, { recursive: true })
  const timestamp = now.toISOString().replace(/[:.]/g, "-")

  for (let suffix = 1; ; suffix += 1) {
    const dir = join(
      parent,
      suffix === 1 ? timestamp : `${timestamp}-${suffix}`
    )
    try {
      await mkdir(dir)
      return dir
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error
    }
  }
}

export function recordingJev(
  jev: JevCall,
  entries: LogEntry[],
  now: () => Date
): JevCall {
  return async (request, options) => {
    try {
      const result = await jev(request, options)
      entries.push({
        at: now().toISOString(),
        kind: "jev",
        state: request.state,
        questions: request.questions,
        answers: result.answers
      })
      return result
    } catch (err) {
      const error = err instanceof Error ? err : new Error(String(err))
      entries.push({
        at: now().toISOString(),
        kind: "exception",
        errorClass: error.constructor.name,
        message: error.message,
        ...(error.stack === undefined ? {} : { stack: error.stack })
      })
      throw err
    }
  }
}

export async function finalizeEvidence<R extends RunRecord>(args: {
  dir: string | null
  mode: EvidenceMode
  record: R
  log: LogEntry[]
  files: string[]
}): Promise<R> {
  const { dir, mode, record, log: entries, files } = args
  if (dir === null || mode === "none") return { ...record, evidence: null }

  try {
    if (!shouldKeep(mode, record.status)) {
      await rm(dir, { recursive: true, force: true })
      return { ...record, evidence: null }
    }

    const evidenceFiles = [...files, "log.json", "result.json"]
    await writeFile(join(dir, "log.json"), JSON.stringify(entries, null, 2))
    const finalized = {
      ...record,
      evidence: { dir, files: evidenceFiles }
    }
    await writeFile(
      join(dir, "result.json"),
      JSON.stringify(finalized, null, 2)
    )
    return finalized
  } catch (error) {
    log.error("Failed to save evidence", {
      message: error instanceof Error ? error.message : String(error)
    })
    return { ...record, evidence: null }
  }
}
