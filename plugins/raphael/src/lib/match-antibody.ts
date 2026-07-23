import path from "node:path"
import type { Antibody, RaphaelToolName } from "./types.js"

const MAX_PATTERN_TEXT_LENGTH = 20_000
const DEFAULT_MAX_INJECTIONS = 3
const DEFAULT_MAX_CONTEXT_LENGTH = 9_000

export interface MatchTarget {
  tool: RaphaelToolName
  text: string
  path: string | null
}

export interface MatchOptions {
  limit?: number
  now?: Date
}

export interface MatchResult {
  selected: Antibody[]
  expiredActiveIds: string[]
}

export interface RenderOptions {
  maxChars?: number
}

export interface SelectionResult extends MatchResult {
  additionalContext: string
}

export function buildMatchTarget(
  tool: RaphaelToolName,
  input: {
    command?: string
    old_string?: string
    new_string?: string
    content?: string
    file_path?: string
  },
  projectDir: string
): MatchTarget {
  const text = targetText(tool, input).slice(0, MAX_PATTERN_TEXT_LENGTH)
  return {
    tool,
    text,
    path:
      tool === "Bash"
        ? null
        : projectRelativePosixPath(input.file_path, projectDir)
  }
}

export function matchAntibodies(
  antibodies: Antibody[],
  target: MatchTarget,
  options: MatchOptions = {}
): MatchResult {
  const today = utcDate(options.now ?? new Date())
  const expiredActiveIds: string[] = []
  const matching: Antibody[] = []

  for (const antibody of antibodies) {
    if (antibody.status === "active" && antibody.expires < today) {
      expiredActiveIds.push(antibody.id)
      continue
    }
    if (antibody.status !== "active" && antibody.status !== "confirmed")
      continue
    if (antibody.trigger.event !== "PreToolUse") continue
    if (
      antibody.trigger.tool !== "*" &&
      antibody.trigger.tool !== target.tool
    ) {
      continue
    }
    if (!scopeMatches(antibody.trigger.scope, target)) continue
    if (!patternMatches(antibody.trigger.pattern, target.text)) continue
    matching.push(antibody)
  }

  matching.sort(compareAntibodies)
  return {
    selected: matching.slice(0, normalizedLimit(options.limit)),
    expiredActiveIds: expiredActiveIds.sort(codePointCompare)
  }
}

export function renderAntibodyContext(
  antibodies: Antibody[],
  options: RenderOptions = {}
): string {
  const maxChars = normalizedMaxChars(options.maxChars)
  let context = ""

  for (const antibody of antibodies) {
    const separator = context === "" ? "" : "\n\n"
    const heading = `[raphael:${antibody.id}]\n`
    const available = maxChars - context.length
    if (separator.length + heading.length > available) break

    const body = truncateToLength(
      antibody.body,
      available - separator.length - heading.length
    )
    context += `${separator}${heading}${body}`
    if (context.length === maxChars) break
  }

  return context
}

export function selectAntibodies(
  antibodies: Antibody[],
  target: MatchTarget,
  options: MatchOptions & RenderOptions = {}
): SelectionResult {
  const result = matchAntibodies(antibodies, target, options)
  return {
    ...result,
    additionalContext: renderAntibodyContext(result.selected, options)
  }
}

function targetText(
  tool: RaphaelToolName,
  input: {
    command?: string
    old_string?: string
    new_string?: string
    content?: string
  }
): string {
  if (tool === "Bash") return input.command ?? ""
  if (tool === "Edit")
    return `${input.old_string ?? ""}\n${input.new_string ?? ""}`
  return input.content ?? ""
}

function projectRelativePosixPath(
  filePath: string | undefined,
  projectDir: string
): string | null {
  if (!filePath) return null

  const relative = path.relative(
    path.resolve(projectDir),
    path.resolve(projectDir, filePath)
  )
  if (
    relative === "" ||
    relative === ".." ||
    relative.startsWith(`..${path.sep}`)
  ) {
    return null
  }
  return relative.split(path.sep).join("/")
}

function scopeMatches(scope: string | undefined, target: MatchTarget): boolean {
  if (!scope || target.tool === "Bash") return true
  if (target.path === null) return false
  return globToRegExp(scope).test(target.path)
}

function patternMatches(pattern: string, text: string): boolean {
  try {
    return new RegExp(pattern).test(text)
  } catch {
    return false
  }
}

function globToRegExp(glob: string): RegExp {
  let source = "^"
  for (let index = 0; index < glob.length; index += 1) {
    const character = glob[index]
    if (character === "*" && glob[index + 1] === "*") {
      if (glob[index + 2] === "/") {
        source += "(?:[^/]+/)*"
        index += 2
      } else {
        source += ".*"
        index += 1
      }
    } else if (character === "*") {
      source += "[^/]*"
    } else if (character === "?") {
      source += "[^/]"
    } else {
      source += escapeRegExp(character)
    }
  }
  return new RegExp(`${source}$`)
}

function escapeRegExp(value: string): string {
  return value.replace(/[\\^$.*+?()[\]{}|]/g, "\\$&")
}

function compareAntibodies(left: Antibody, right: Antibody): number {
  const lastFired = compareNullableDescending(
    left.stats.last_fired,
    right.stats.last_fired
  )
  if (lastFired !== 0) return lastFired

  const created = compareDescending(left.created, right.created)
  if (created !== 0) return created

  return codePointCompare(left.id, right.id)
}

function compareNullableDescending(
  left: string | null,
  right: string | null
): number {
  if (left === null && right === null) return 0
  if (left === null) return 1
  if (right === null) return -1
  return compareDescending(left, right)
}

function compareDescending(left: string, right: string): number {
  if (left < right) return 1
  if (left > right) return -1
  return 0
}

function normalizedLimit(value: number | undefined): number {
  if (value === undefined) return DEFAULT_MAX_INJECTIONS
  return Math.max(0, Math.floor(value))
}

function normalizedMaxChars(value: number | undefined): number {
  if (value === undefined) return DEFAULT_MAX_CONTEXT_LENGTH
  return Math.max(0, Math.floor(value))
}

function truncateToLength(value: string, maxLength: number): string {
  if (value.length <= maxLength) return value

  let result = ""
  for (const character of value) {
    if (result.length + character.length > maxLength) break
    result += character
  }
  return result
}

function utcDate(value: Date): string {
  const year = String(value.getUTCFullYear()).padStart(4, "0")
  const month = String(value.getUTCMonth() + 1).padStart(2, "0")
  const day = String(value.getUTCDate()).padStart(2, "0")
  return `${year}-${month}-${day}`
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
