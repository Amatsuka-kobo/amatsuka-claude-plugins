import type { HookInput, InfectionDetails, RaphaelStateV1 } from "./types.js"

const BUILTIN_BENIGN_EXIT1_COMMANDS = [
  "grep",
  "rg",
  "git grep",
  "diff",
  "git diff --quiet",
  "cmp",
  "test",
  "["
] as const

export interface CommandOutcomeInput {
  hookEvent: "PostToolUse" | "PostToolUseFailure"
  command: string
  toolResponse?: unknown
  error?: string
  benignExit1Commands?: readonly string[]
}

export interface CommandOutcome {
  command: string
  normalized_command: string
  exit_code: number | null
  failed: boolean
  output_tail: string
}

type CommandFailureDetails = Extract<
  InfectionDetails,
  { type: "command-failure" }
>
type RetryLoopDetails = Extract<InfectionDetails, { type: "retry-loop" }>
type RecentCommand = RaphaelStateV1["recent_commands"][number]

export function normalizeCommand(command: string): string {
  return command.trim().replace(/\s+/g, " ")
}

export function extractExitCode(
  toolResponse: unknown,
  error?: string
): number | null {
  if (isRecord(toolResponse)) {
    for (const key of ["exit_code", "exitCode", "code"] as const) {
      const parsed = parseExitCode(toolResponse[key])
      if (parsed !== null) return parsed
    }
  }

  if (typeof error === "string") {
    const match = error.match(/(?:status code|exit code)\s+(-?\d+)/i)
    if (match) return parseExitCode(match[1])
  }
  return null
}

export function isBenignExit1Command(
  command: string,
  exitCode: number | null,
  additionalCommands: readonly string[] = []
): boolean {
  if (exitCode !== 1) return false
  const normalized = normalizeCommand(command)
  return [...BUILTIN_BENIGN_EXIT1_COMMANDS, ...additionalCommands].some(
    (candidate) => commandStartsWith(normalized, normalizeCommand(candidate))
  )
}

export function classifyCommandOutcome(
  input: CommandOutcomeInput
): CommandOutcome {
  const exitCode = extractExitCode(input.toolResponse, input.error)
  const failedByEvent = input.hookEvent === "PostToolUseFailure"
  const failedByCode =
    input.hookEvent === "PostToolUse" && exitCode !== null && exitCode !== 0
  const benign = isBenignExit1Command(
    input.command,
    exitCode,
    input.benignExit1Commands
  )
  return {
    command: input.command,
    normalized_command: normalizeCommand(input.command),
    exit_code: exitCode,
    failed: (failedByEvent || failedByCode) && !benign,
    output_tail: commandOutput(input.toolResponse, input.error)
  }
}

export function detectCommandFailure(
  input: CommandOutcomeInput
): CommandFailureDetails | null {
  const outcome = classifyCommandOutcome(input)
  if (!outcome.failed) return null
  return {
    type: "command-failure",
    command: outcome.command,
    normalized_command: outcome.normalized_command,
    exit_code: outcome.exit_code,
    output_tail: outcome.output_tail
  }
}

export function detectRetryLoop(
  command: string,
  recentCommands: readonly RecentCommand[],
  threshold = 3
): RetryLoopDetails | null {
  if (!Number.isInteger(threshold) || threshold < 2) return null
  const normalized = normalizeCommand(command)
  const trailing = recentCommands.slice(-threshold)
  if (
    trailing.length !== threshold ||
    trailing.some(
      (entry) => !entry.failed || entry.normalized_command !== normalized
    )
  ) {
    return null
  }
  return {
    type: "retry-loop",
    command,
    normalized_command: normalized,
    consecutive_failures: threshold,
    exit_codes: trailing.map((entry) => entry.exit_code)
  }
}

export function commandOutcomeFromHookInput(
  input: HookInput,
  benignExit1Commands: readonly string[] = []
): CommandOutcome | null {
  if (
    (input.hook_event_name !== "PostToolUse" &&
      input.hook_event_name !== "PostToolUseFailure") ||
    input.tool_name !== "Bash" ||
    typeof input.tool_input?.command !== "string"
  ) {
    return null
  }
  return classifyCommandOutcome({
    hookEvent: input.hook_event_name,
    command: input.tool_input.command,
    toolResponse: input.tool_response,
    error: input.error,
    benignExit1Commands
  })
}

function parseExitCode(value: unknown): number | null {
  if (typeof value === "number")
    return Number.isFinite(value) && Number.isInteger(value) ? value : null
  if (typeof value !== "string" || !/^-?\d+$/.test(value)) return null
  const parsed = Number(value)
  return Number.isFinite(parsed) && Number.isInteger(parsed) ? parsed : null
}

function commandStartsWith(command: string, candidate: string): boolean {
  if (candidate === "" || !command.startsWith(candidate)) return false
  return (
    command.length === candidate.length || /\s/.test(command[candidate.length])
  )
}

function commandOutput(toolResponse: unknown, error?: string): string {
  const parts: string[] = []
  if (typeof toolResponse === "string") parts.push(toolResponse)
  else if (isRecord(toolResponse)) {
    if (typeof toolResponse.stdout === "string") parts.push(toolResponse.stdout)
    if (typeof toolResponse.stderr === "string") parts.push(toolResponse.stderr)
  }
  if (typeof error === "string" && error !== "") parts.push(error)
  return parts.filter((part) => part !== "").join("\n")
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value)
}
