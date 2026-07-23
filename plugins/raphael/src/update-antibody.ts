import fs from "node:fs"
import path from "node:path"
import {
  AntibodyIoError,
  AntibodyNotFoundError,
  createAntibody,
  extendAntibodyExpires,
  patchAntibody,
  readAntibody,
  recordAntibodyFire,
  setAntibodyStatus
} from "./lib/antibody-store.js"
import { loadConfig } from "./lib/config.js"
import { AntibodyValidationError, validateAntibody } from "./lib/frontmatter.js"
import {
  markInfectionsDistilled,
  parseInfectionLine
} from "./lib/infection-store.js"
import type { Antibody, AntibodyStatus } from "./lib/types.js"

interface Failure {
  code: string
  message: string
  field?: string
}

interface Options {
  dir: string
  operation: string
  operands: string[]
  dryRun: boolean
}

function main(): void {
  const options = parseArgs(process.argv.slice(2))
  const body = readRequest()
  let result: unknown

  switch (options.operation) {
    case "create":
      assertOperandCount(options, 0)
      result = { ok: true, antibody: createAntibody(options.dir, draft(body)) }
      break
    case "patch":
      assertOperandCount(options, 1)
      result = patch(options, body)
      break
    case "set-status":
      assertOperandCount(options, 2)
      result = setStatus(options)
      break
    case "extend":
      assertOperandCount(options, 1)
      result = extend(options)
      break
    case "record-fire":
      assertOperandCount(options, 1)
      result = {
        ok: true,
        antibody: recordAntibodyFire(options.dir, options.operands[0] ?? "")
      }
      break
    case "mark-distilled":
      assertOperandCount(options, 0)
      result = markDistilled(options.dir, body)
      break
    default:
      throw new AntibodyValidationError(
        `operation: unsupported operation: ${options.operation}`,
        "operation"
      )
  }
  respond(result)
}

function parseArgs(args: string[]): Options {
  let dir: string | undefined
  let dryRun = false
  const positional: string[] = []

  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index]
    if (arg === "--dir") {
      const value = args[++index]
      if (value === undefined || value.startsWith("--")) {
        throw new AntibodyValidationError("dir: is required", "dir")
      }
      dir = value
    } else if (arg === "--dry-run") {
      dryRun = true
    } else if (arg.startsWith("--")) {
      throw new AntibodyValidationError(
        `argument: unsupported option: ${arg}`,
        "argument"
      )
    } else {
      positional.push(arg)
    }
  }

  const operation = positional.shift()
  if (operation === undefined) {
    throw new AntibodyValidationError("operation: is required", "operation")
  }
  if (dryRun && operation !== "patch") {
    throw new AntibodyValidationError(
      "dry-run: is supported only by patch",
      "dry-run"
    )
  }
  return {
    dir: dir ?? process.env.CLAUDE_PROJECT_DIR ?? process.cwd(),
    operation,
    operands: positional,
    dryRun
  }
}

function readRequest(): unknown {
  let raw: string
  try {
    raw = fs.readFileSync(0, "utf8")
  } catch (error) {
    throw new AntibodyIoError("Failed to read request", error)
  }
  try {
    return JSON.parse(raw)
  } catch {
    throw new RequestError("INVALID_JSON", "request: must be valid JSON")
  }
}

function draft(value: unknown): {
  source: string
  trigger: Antibody["trigger"]
  expires: string
  body: string
} {
  if (!isRecord(value)) throw validation("request", "must be an object")
  assertKeys(value, ["source", "trigger", "expires", "body"])
  return {
    source: stringField(value, "source"),
    trigger: triggerField(value.trigger),
    expires: stringField(value, "expires"),
    body: stringField(value, "body")
  }
}

function patch(options: Options, value: unknown): unknown {
  if (!isRecord(value)) throw validation("patch", "must be an object")
  assertKeys(value, [], ["source", "trigger", "body"])
  const current = readAntibody(options.dir, options.operands[0] ?? "")
  const normalized = validateAntibody({ ...current, ...value })
  if (options.dryRun) {
    return {
      ok: true,
      dry_run: true,
      antibody: normalized,
      diff: Object.keys(value).filter(
        (key) =>
          JSON.stringify(current[key as keyof Antibody]) !==
          JSON.stringify(normalized[key as keyof Antibody])
      )
    }
  }
  return {
    ok: true,
    antibody: patchAntibody(options.dir, options.operands[0] ?? "", value)
  }
}

function setStatus(options: Options): unknown {
  const id = options.operands[0] ?? ""
  const status = statusField(options.operands[1])
  const current = readAntibody(options.dir, id)
  assertTransition(current.status, status)
  return { ok: true, antibody: setAntibodyStatus(options.dir, id, status) }
}

function extend(options: Options): unknown {
  const id = options.operands[0] ?? ""
  const current = readAntibody(options.dir, id)
  if (current.status === "confirmed") {
    return { ok: true, no_op: true, antibody: current }
  }
  if (current.stats.last_fired === null) {
    throw validation("stats.last_fired", "is required to extend")
  }
  const days = loadConfig(options.dir).defaultExpiryDays
  const expires = minDate(
    addDays(current.stats.last_fired, days),
    addDays(current.created, 90)
  )
  const antibody = extendAntibodyExpires(options.dir, id, expires)
  return {
    ok: true,
    antibody:
      antibody.status === "active"
        ? antibody
        : setAntibodyStatus(options.dir, id, "active")
  }
}

function markDistilled(projectDir: string, value: unknown): unknown {
  if (!isRecord(value)) throw validation("request", "must be an object")
  assertKeys(value, ["ids"])
  if (
    !Array.isArray(value.ids) ||
    !value.ids.every((id) => typeof id === "string")
  ) {
    throw validation("ids", "must be an array of strings")
  }
  const ids = [...new Set(value.ids)]
  const found = new Set<string>()
  let updated = 0
  const directory = path.join(projectDir, ".raphael", "infections")
  let entries: fs.Dirent[]
  try {
    entries = fs.readdirSync(directory, { withFileTypes: true })
  } catch (error) {
    if (isErrorCode(error, "ENOENT")) {
      return { ok: true, updated: 0, not_found: ids }
    }
    throw new AntibodyIoError("Failed to list infections", error)
  }

  for (const entry of entries) {
    if (!entry.isFile() || !entry.name.endsWith(".jsonl")) continue
    const filePath = path.join(directory, entry.name)
    let raw: string
    try {
      raw = fs.readFileSync(filePath, "utf8")
    } catch (error) {
      throw new AntibodyIoError(
        `Failed to read infection file: ${entry.name}`,
        error
      )
    }
    const records = raw
      .split(/\r?\n/)
      .map(parseInfectionLine)
      .filter((record) => record !== null)
    const session = records[0]?.session
    if (session === undefined) continue
    for (const record of records) {
      if (ids.includes(record.id)) found.add(record.id)
    }
    updated += markInfectionsDistilled(projectDir, session, ids)
  }
  return { ok: true, updated, not_found: ids.filter((id) => !found.has(id)) }
}

function assertOperandCount(options: Options, expected: number): void {
  if (options.operands.length !== expected) {
    throw new AntibodyValidationError(
      `operation: ${options.operation} expects ${expected} argument${expected === 1 ? "" : "s"}`,
      "operation"
    )
  }
}

function assertTransition(from: AntibodyStatus, to: AntibodyStatus): void {
  const allowed: Record<AntibodyStatus, readonly AntibodyStatus[]> = {
    active: ["expired", "confirmed"],
    expired: ["active", "confirmed"],
    confirmed: ["active", "expired"]
  }
  if (from !== to && !allowed[from].includes(to)) {
    throw validation("status", `cannot transition from ${from} to ${to}`)
  }
}

function statusField(value: string | undefined): AntibodyStatus {
  if (value === "active" || value === "expired" || value === "confirmed")
    return value
  throw validation("status", "must be active, expired, or confirmed")
}

function triggerField(value: unknown): Antibody["trigger"] {
  const candidate = validateAntibody({
    id: "ab-2026-0724-001",
    created: "2026-07-24",
    source: "request",
    trigger: value,
    status: "active",
    stats: { fired: 0, last_fired: null },
    expires: "2026-08-23",
    body: "validation"
  })
  return candidate.trigger
}

function assertKeys(
  value: Record<string, unknown>,
  required: string[],
  optional: string[] = []
): void {
  for (const key of required) {
    if (!(key in value)) throw validation(key, "is required")
  }
  const allowed = new Set([...required, ...optional])
  for (const key of Object.keys(value)) {
    if (!allowed.has(key)) throw validation(key, "is not supported")
  }
}

function stringField(value: Record<string, unknown>, field: string): string {
  if (typeof value[field] !== "string")
    throw validation(field, "must be a string")
  return value[field]
}

function validation(field: string, message: string): AntibodyValidationError {
  return new AntibodyValidationError(`${field}: ${message}`, field)
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value)
}

function addDays(date: string, days: number): string {
  const value = new Date(`${date}T00:00:00.000Z`)
  value.setUTCDate(value.getUTCDate() + days)
  return value.toISOString().slice(0, 10)
}

function minDate(left: string, right: string): string {
  return left <= right ? left : right
}

function isErrorCode(error: unknown, code: string): boolean {
  return (
    typeof error === "object" &&
    error !== null &&
    "code" in error &&
    (error as NodeJS.ErrnoException).code === code
  )
}

function respond(value: unknown): void {
  process.stdout.write(`${JSON.stringify(value)}\n`)
}

class RequestError extends Error {
  constructor(
    readonly code: string,
    message: string,
    readonly field?: string
  ) {
    super(message)
    this.name = "RequestError"
  }
}

function failure(error: unknown): Failure {
  if (error instanceof RequestError) {
    return {
      code: error.code,
      message: error.message,
      ...(error.field === undefined ? {} : { field: error.field })
    }
  }
  if (error instanceof AntibodyNotFoundError) {
    return {
      code: "NOT_FOUND",
      message: error.message,
      ...(error.field === undefined ? {} : { field: error.field })
    }
  }
  if (error instanceof AntibodyIoError)
    return { code: "IO_ERROR", message: error.message }
  if (error instanceof AntibodyValidationError) {
    return {
      code: "VALIDATION_ERROR",
      message: error.message,
      ...(error.field === undefined ? {} : { field: error.field })
    }
  }
  return {
    code: "RUNTIME_ERROR",
    message: error instanceof Error ? error.message : "Unexpected error"
  }
}

try {
  main()
} catch (error) {
  const result = failure(error)
  respond({ ok: false, error: result })
  process.exitCode =
    result.code === "IO_ERROR" || result.code === "RUNTIME_ERROR" ? 1 : 2
}
