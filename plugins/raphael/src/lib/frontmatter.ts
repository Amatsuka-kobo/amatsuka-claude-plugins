import type {
  Antibody,
  AntibodyStatus,
  AntibodyTrigger,
  RaphaelToolName
} from "./types.js"

const ID_PATTERN = /^ab-\d{4}-\d{4}-\d{3}$/
const DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/
const TOOLS: ReadonlyArray<RaphaelToolName | "*"> = [
  "Bash",
  "Edit",
  "Write",
  "*"
]
const STATUSES: readonly AntibodyStatus[] = ["active", "expired", "confirmed"]

export class AntibodyValidationError extends Error {
  readonly field?: string

  constructor(message: string, field?: string) {
    super(message)
    this.name = "AntibodyValidationError"
    this.field = field
  }
}

export function parseAntibodyMarkdown(markdown: string): Antibody {
  const normalized = markdown.replace(/\r\n?/g, "\n")
  if (!normalized.startsWith("---\n")) {
    throw validationError("frontmatter", "must start with ---")
  }

  const closing = normalized.indexOf("\n---\n", 4)
  if (closing < 0) {
    throw validationError("frontmatter", "must end with ---")
  }

  const frontmatter = normalized.slice(4, closing)
  let body = normalized.slice(closing + 5)
  if (body.startsWith("\n")) body = body.slice(1)
  if (body.endsWith("\n")) body = body.slice(0, -1)

  const lines = frontmatter.split("\n")
  let index = 0
  const take = (indent: string, key: string): string => {
    const line = lines[index]
    if (line === undefined) {
      throw validationError(key, "is required")
    }
    const prefix = `${indent}${key}:`
    if (!line.startsWith(prefix)) {
      throw validationError(key, `expected ${prefix}`)
    }
    const next = line.slice(prefix.length)
    if (next !== "" && !/^\s/.test(next)) {
      throw validationError(key, "must be followed by whitespace")
    }
    index += 1
    return next.trimStart()
  }
  const takeGroup = (key: string): void => {
    const line = lines[index]
    if (line !== `${key}:`) {
      throw validationError(key, `expected ${key}:`)
    }
    index += 1
  }

  const id = parseString(take("", "id"), "id")
  const created = parseString(take("", "created"), "created")
  const source = parseString(take("", "source"), "source")
  takeGroup("trigger")
  const event = parseString(take("  ", "event"), "trigger.event")
  const tool = parseString(take("  ", "tool"), "trigger.tool")
  const pattern = parseString(take("  ", "pattern"), "trigger.pattern")
  let scope: string | undefined
  if (lines[index]?.startsWith("  scope:")) {
    scope = parseString(take("  ", "scope"), "trigger.scope")
  }
  const status = parseString(take("", "status"), "status")
  takeGroup("stats")
  const fired = parseInteger(take("  ", "fired"), "stats.fired")
  const lastFired = parseNullableString(
    take("  ", "last_fired"),
    "stats.last_fired"
  )
  const expires = parseString(take("", "expires"), "expires")

  if (index !== lines.length) {
    throw validationError("frontmatter", `unexpected field: ${lines[index]}`)
  }

  return validateAntibody({
    id,
    created,
    source,
    trigger: {
      event,
      tool,
      pattern,
      ...(scope === undefined ? {} : { scope })
    },
    status,
    stats: { fired, last_fired: lastFired },
    expires,
    body
  })
}

export function serializeAntibodyMarkdown(value: unknown): string {
  const antibody = validateAntibody(value)
  const lines = [
    "---",
    `id: ${antibody.id}`,
    `created: ${antibody.created}`,
    `source: ${JSON.stringify(antibody.source)}`,
    "trigger:",
    `  event: ${antibody.trigger.event}`,
    `  tool: ${antibody.trigger.tool}`,
    `  pattern: ${JSON.stringify(antibody.trigger.pattern)}`
  ]
  if (antibody.trigger.scope !== undefined) {
    lines.push(`  scope: ${JSON.stringify(antibody.trigger.scope)}`)
  }
  lines.push(
    `status: ${antibody.status}`,
    "stats:",
    `  fired: ${antibody.stats.fired}`,
    `  last_fired: ${antibody.stats.last_fired ?? "null"}`,
    `expires: ${antibody.expires}`,
    "---",
    "",
    antibody.body
  )
  return `${lines.join("\n")}\n`
}

export function validateAntibody(value: unknown): Antibody {
  if (!isRecord(value)) throw validationError("antibody", "must be an object")
  assertExactKeys(value, [
    "id",
    "created",
    "source",
    "trigger",
    "status",
    "stats",
    "expires",
    "body"
  ])

  const id = requireString(value.id, "id")
  if (!ID_PATTERN.test(id)) {
    throw validationError("id", "must match ab-YYYY-MMDD-NNN")
  }
  const created = requireDate(value.created, "created")
  const source = requireString(value.source, "source")
  if (source.length > 500) {
    throw validationError("source", "must be at most 500 characters")
  }

  const trigger = validateTrigger(value.trigger)
  const status = requireString(value.status, "status")
  if (!STATUSES.includes(status as AntibodyStatus)) {
    throw validationError("status", "must be active, expired, or confirmed")
  }

  if (!isRecord(value.stats)) {
    throw validationError("stats", "must be an object")
  }
  assertExactKeys(value.stats, ["fired", "last_fired"], "stats")
  if (
    typeof value.stats.fired !== "number" ||
    !Number.isInteger(value.stats.fired) ||
    value.stats.fired < 0
  ) {
    throw validationError("stats.fired", "must be a non-negative integer")
  }
  const lastFired =
    value.stats.last_fired === null
      ? null
      : requireDate(value.stats.last_fired, "stats.last_fired")
  const expires = requireDate(value.expires, "expires")
  const body = requireString(value.body, "body")
  if (body.trim() === "") throw validationError("body", "must not be empty")
  if (body.length > 9_000) {
    throw validationError("body", "must be at most 9000 characters")
  }

  return {
    id,
    created,
    source,
    trigger,
    status: status as AntibodyStatus,
    stats: { fired: value.stats.fired, last_fired: lastFired },
    expires,
    body
  }
}

function validateTrigger(value: unknown): AntibodyTrigger {
  if (!isRecord(value)) {
    throw validationError("trigger", "must be an object")
  }
  assertExactKeys(value, ["event", "tool", "pattern"], "trigger", ["scope"])
  if (value.event !== "PreToolUse") {
    throw validationError("trigger.event", "must be PreToolUse")
  }
  const tool = requireString(value.tool, "trigger.tool")
  if (!TOOLS.includes(tool as RaphaelToolName | "*")) {
    throw validationError("trigger.tool", "must be Bash, Edit, Write, or *")
  }
  const pattern = requireString(value.pattern, "trigger.pattern")
  if (pattern.length > 1_000) {
    throw validationError("trigger.pattern", "must be at most 1000 characters")
  }
  try {
    new RegExp(pattern)
  } catch {
    throw validationError(
      "trigger.pattern",
      "must be a valid regular expression"
    )
  }
  const scope =
    value.scope === undefined
      ? undefined
      : requireString(value.scope, "trigger.scope")
  return {
    event: "PreToolUse",
    tool: tool as RaphaelToolName | "*",
    pattern,
    ...(scope === undefined ? {} : { scope })
  }
}

function parseString(raw: string, field: string): string {
  const scalar = stripInlineComment(raw).trim()
  if (scalar.startsWith('"')) {
    try {
      const parsed: unknown = JSON.parse(scalar)
      return requireString(parsed, field)
    } catch (error) {
      if (error instanceof AntibodyValidationError) throw error
      throw validationError(field, "must be a valid JSON string")
    }
  }
  if (scalar === "") throw validationError(field, "is required")
  return scalar
}

function parseNullableString(raw: string, field: string): string | null {
  const scalar = stripInlineComment(raw).trim()
  return scalar === "null" ? null : parseString(scalar, field)
}

function parseInteger(raw: string, field: string): number {
  const scalar = stripInlineComment(raw).trim()
  if (!/^\d+$/.test(scalar)) {
    throw validationError(field, "must be a non-negative integer")
  }
  const value = Number(scalar)
  if (!Number.isSafeInteger(value)) {
    throw validationError(field, "must be a safe integer")
  }
  return value
}

function stripInlineComment(raw: string): string {
  let quoted = false
  let escaped = false
  for (let index = 0; index < raw.length; index += 1) {
    const character = raw[index]
    if (quoted) {
      if (escaped) escaped = false
      else if (character === "\\") escaped = true
      else if (character === '"') quoted = false
    } else if (character === '"') quoted = true
    else if (character === "#" && (index === 0 || /\s/.test(raw[index - 1]))) {
      return raw.slice(0, index)
    }
  }
  return raw
}

function requireString(value: unknown, field: string): string {
  if (typeof value !== "string") {
    throw validationError(field, "must be a string")
  }
  return value
}

function requireDate(value: unknown, field: string): string {
  const date = requireString(value, field)
  if (!DATE_PATTERN.test(date)) {
    throw validationError(field, "must be YYYY-MM-DD")
  }
  const [year, month, day] = date.split("-").map(Number)
  const candidate = new Date(Date.UTC(year, month - 1, day))
  if (
    candidate.getUTCFullYear() !== year ||
    candidate.getUTCMonth() !== month - 1 ||
    candidate.getUTCDate() !== day
  ) {
    throw validationError(field, "must be a valid calendar date")
  }
  return date
}

function assertExactKeys(
  value: Record<string, unknown>,
  required: readonly string[],
  field = "antibody",
  optional: readonly string[] = []
): void {
  for (const key of required) {
    if (!(key in value)) throw validationError(`${field}.${key}`, "is required")
  }
  const allowed = new Set([...required, ...optional])
  for (const key of Object.keys(value)) {
    if (!allowed.has(key)) {
      throw validationError(`${field}.${key}`, "is not supported")
    }
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value)
}

function validationError(
  field: string,
  message: string
): AntibodyValidationError {
  return new AntibodyValidationError(`${field}: ${message}`, field)
}
