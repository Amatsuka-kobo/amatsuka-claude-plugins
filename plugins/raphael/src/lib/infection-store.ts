import crypto from "node:crypto"
import fs from "node:fs"
import path from "node:path"
import { writeFileAtomic } from "./atomic.js"
import { redactSecrets } from "./redact.js"
import type {
  InfectionDetails,
  InfectionKind,
  InfectionRecordV1,
  RaphaelToolName
} from "./types.js"

const KINDS: readonly InfectionKind[] = [
  "command-failure",
  "retry-loop",
  "user-rejection",
  "edit-churn"
]
const TOOLS: readonly RaphaelToolName[] = ["Bash", "Edit", "Write"]
const HOOK_EVENTS = [
  "PostToolUse",
  "PostToolUseFailure",
  "UserPromptSubmit"
] as const

export function sha256Hex(value: string | Uint8Array): string {
  return crypto.createHash("sha256").update(value).digest("hex")
}

export function generateInfectionId(now = new Date()): string {
  const timestamp = now
    .toISOString()
    .replace(/[-:]/g, "")
    .replace("T", "-")
    .replace(".", "")
    .replace("Z", "")
  return `infection-${timestamp}-${crypto.randomBytes(4).toString("hex")}`
}

export function sessionFileName(session: string): string {
  return `session-${sha256Hex(session).slice(0, 16)}.jsonl`
}

export function infectionFilePath(projectDir: string, session: string): string {
  return path.join(
    projectDir,
    ".raphael",
    "infections",
    sessionFileName(session)
  )
}

export function computeDistillNagDigest(ids: readonly string[]): string {
  return sha256Hex([...new Set(ids)].sort(codePointCompare).join("\0"))
}

export function readInfections(
  projectDir: string,
  session: string
): InfectionRecordV1[] {
  const records: InfectionRecordV1[] = []
  for (const line of readRawLines(infectionFilePath(projectDir, session))) {
    const record = parseInfectionLine(line)
    if (record) records.push(record)
  }
  return records
}

/**
 * Appends through atomic replacement so malformed/unknown raw lines already in
 * the JSONL remain available for diagnosis instead of being silently erased.
 */
export function appendInfection(
  projectDir: string,
  input: InfectionRecordV1
): boolean {
  const record = sanitizeRecord(input)
  if (!record || record.session !== input.session) return false

  const filePath = infectionFilePath(projectDir, record.session)
  const rawLines = readRawLines(filePath)
  if (
    record.tool_use_id !== null &&
    rawLines.some((line) => {
      const existing = parseInfectionLine(line)
      return (
        existing?.session === record.session &&
        existing.tool_use_id === record.tool_use_id &&
        existing.kind === record.kind
      )
    })
  ) {
    return false
  }

  rawLines.push(JSON.stringify(record))
  writeFileAtomic(filePath, `${rawLines.join("\n")}\n`)
  return true
}

export function markInfectionsDistilled(
  projectDir: string,
  session: string,
  ids: readonly string[],
  now = new Date()
): number {
  const filePath = infectionFilePath(projectDir, session)
  const rawLines = readRawLines(filePath)
  if (rawLines.length === 0) return 0

  const targetIds = new Set(ids)
  const distilledAt = now.toISOString()
  let updated = 0
  const rewritten = rawLines.map((line) => {
    const record = parseInfectionLine(line)
    if (!record || !targetIds.has(record.id) || record.distilled) return line
    updated += 1
    return JSON.stringify({
      ...record,
      distilled: true,
      distilled_at: distilledAt
    } satisfies InfectionRecordV1)
  })

  if (updated > 0) writeFileAtomic(filePath, `${rewritten.join("\n")}\n`)
  return updated
}

export function parseInfectionLine(line: string): InfectionRecordV1 | null {
  if (line.trim() === "") return null
  try {
    return validateRecord(JSON.parse(line))
  } catch {
    return null
  }
}

function readRawLines(filePath: string): string[] {
  try {
    const raw = fs.readFileSync(filePath, "utf8")
    const lines = raw.split(/\r?\n/)
    if (lines.at(-1) === "") lines.pop()
    return lines
  } catch {
    return []
  }
}

function sanitizeRecord(input: InfectionRecordV1): InfectionRecordV1 | null {
  const validated = validateRecord(input)
  if (!validated) return null

  const details = sanitizeDetails(validated.details)
  return {
    ...validated,
    input_digest: truncate(redactSecrets(validated.input_digest), 500),
    evidence: truncate(redactSecrets(validated.evidence), 2_000),
    details
  }
}

function sanitizeDetails(details: InfectionDetails): InfectionDetails {
  switch (details.type) {
    case "command-failure":
      return {
        ...details,
        command: truncate(redactSecrets(details.command), 1_000),
        normalized_command: redactSecrets(details.normalized_command),
        output_tail: tailLines(
          truncateFromEnd(redactSecrets(details.output_tail), 2_000),
          20
        )
      }
    case "retry-loop":
      return {
        ...details,
        command: truncate(redactSecrets(details.command), 1_000),
        normalized_command: redactSecrets(details.normalized_command),
        exit_codes: details.exit_codes.slice(-3)
      }
    case "user-rejection":
      return {
        ...details,
        prompt_excerpt: truncate(redactSecrets(details.prompt_excerpt), 1_000),
        previous_tool:
          details.previous_tool === null
            ? null
            : {
                ...details.previous_tool,
                input_digest: truncate(
                  redactSecrets(details.previous_tool.input_digest),
                  500
                )
              }
      }
    case "edit-churn":
      return details
  }
}

function validateRecord(value: unknown): InfectionRecordV1 | null {
  if (!isObject(value) || value.schema_version !== 1) return null
  if (!isString(value.id) || !isIsoDate(value.ts)) return null
  if (!isKind(value.kind) || !isString(value.session)) return null
  if (!isHookEvent(value.hook_event)) return null
  if (!(value.tool === null || isTool(value.tool))) return null
  if (!(value.tool_use_id === null || isString(value.tool_use_id))) return null
  if (!isString(value.input_digest) || !isString(value.evidence)) return null
  if (!isSha256(value.fingerprint)) return null
  if (typeof value.distilled !== "boolean") return null
  if (!(value.distilled_at === null || isIsoDate(value.distilled_at)))
    return null
  const details = validateDetails(value.details)
  if (!details || details.type !== value.kind) return null
  return { ...value, details } as InfectionRecordV1
}

function validateDetails(value: unknown): InfectionDetails | null {
  if (!isObject(value) || !isKind(value.type)) return null
  switch (value.type) {
    case "command-failure":
      if (
        !isString(value.command) ||
        !isString(value.normalized_command) ||
        !isNullableNumber(value.exit_code) ||
        !isString(value.output_tail)
      )
        return null
      return value as InfectionDetails
    case "retry-loop":
      if (
        !isString(value.command) ||
        !isString(value.normalized_command) ||
        !isIntegerAtLeast(value.consecutive_failures, 3) ||
        !Array.isArray(value.exit_codes) ||
        !value.exit_codes.every(isNullableNumber)
      )
        return null
      return value as InfectionDetails
    case "user-rejection":
      if (!isString(value.prompt_excerpt) || !isString(value.matched_pattern))
        return null
      if (
        value.previous_tool !== null &&
        (!isObject(value.previous_tool) ||
          !isTool(value.previous_tool.tool) ||
          !isString(value.previous_tool.input_digest))
      )
        return null
      return value as InfectionDetails
    case "edit-churn":
      if (
        !isString(value.file_path) ||
        !isPositiveInteger(value.line_start) ||
        !isPositiveInteger(value.line_end) ||
        value.line_end < value.line_start ||
        !isIntegerAtLeast(value.edits_in_window, 3)
      )
        return null
      return value as InfectionDetails
  }
}

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value)
}

function isString(value: unknown): value is string {
  return typeof value === "string"
}

function isKind(value: unknown): value is InfectionKind {
  return typeof value === "string" && KINDS.includes(value as InfectionKind)
}

function isTool(value: unknown): value is RaphaelToolName {
  return typeof value === "string" && TOOLS.includes(value as RaphaelToolName)
}

function isHookEvent(value: unknown): value is InfectionRecordV1["hook_event"] {
  return (
    typeof value === "string" &&
    HOOK_EVENTS.includes(value as InfectionRecordV1["hook_event"])
  )
}

function isIsoDate(value: unknown): value is string {
  return (
    typeof value === "string" &&
    !Number.isNaN(Date.parse(value)) &&
    new Date(value).toISOString() === value
  )
}

function isSha256(value: unknown): value is string {
  return typeof value === "string" && /^[0-9a-f]{64}$/.test(value)
}

function isNullableNumber(value: unknown): value is number | null {
  return value === null || (typeof value === "number" && Number.isFinite(value))
}

function isPositiveInteger(value: unknown): value is number {
  return typeof value === "number" && Number.isInteger(value) && value >= 1
}

function isIntegerAtLeast(value: unknown, minimum: number): value is number {
  return (
    typeof value === "number" && Number.isInteger(value) && value >= minimum
  )
}

function truncate(value: string, maximum: number): string {
  return value.slice(0, maximum)
}

function truncateFromEnd(value: string, maximum: number): string {
  return value.length <= maximum ? value : value.slice(-maximum)
}

function tailLines(value: string, maximum: number): string {
  return value.split(/\r?\n/).slice(-maximum).join("\n")
}

function codePointCompare(left: string, right: string): number {
  const leftPoints = Array.from(left, (value) => value.codePointAt(0) ?? 0)
  const rightPoints = Array.from(right, (value) => value.codePointAt(0) ?? 0)
  const length = Math.min(leftPoints.length, rightPoints.length)
  for (let index = 0; index < length; index += 1) {
    const difference = leftPoints[index] - rightPoints[index]
    if (difference !== 0) return difference
  }
  return leftPoints.length - rightPoints.length
}
