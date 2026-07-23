#!/usr/bin/env node
import { loadConfig } from "./lib/config.js"
import {
  commandOutcomeFromHookInput,
  detectCommandFailure,
  detectRetryLoop
} from "./lib/detect-command.js"
import { detectEditChurn } from "./lib/detect-edit-churn.js"
import { detectUserRejection } from "./lib/detect-rejection.js"
import { logError, readStdinSync, resolveProjectDir } from "./lib/hook-io.js"
import {
  appendInfection,
  generateInfectionId,
  readInfections,
  sha256Hex
} from "./lib/infection-store.js"
import { applyEditToState, loadState, saveState } from "./lib/state-store.js"
import type {
  HookInput,
  InfectionDetails,
  InfectionKind,
  InfectionRecordV1,
  RaphaelStateV1,
  RaphaelToolName
} from "./lib/types.js"

const TOOLS: readonly RaphaelToolName[] = ["Bash", "Edit", "Write"]
const EVENTS = [
  "PostToolUse",
  "PostToolUseFailure",
  "UserPromptSubmit"
] as const

type HookEvent = (typeof EVENTS)[number]

function isHookEvent(value: unknown): value is HookEvent {
  return typeof value === "string" && EVENTS.includes(value as HookEvent)
}

function isTool(value: unknown): value is RaphaelToolName {
  return typeof value === "string" && TOOLS.includes(value as RaphaelToolName)
}

function sessionFor(input: HookInput): string {
  return typeof input.session_id === "string" && input.session_id !== ""
    ? input.session_id
    : "unknown"
}

function digest(value: unknown): string {
  try {
    return JSON.stringify(value) ?? ""
  } catch {
    return ""
  }
}

function recordFingerprint(
  kind: InfectionKind,
  normalizedTarget: string,
  eventSeq: number | null
): string {
  return sha256Hex(
    eventSeq === null
      ? `${kind}\0${normalizedTarget}`
      : `${kind}\0${normalizedTarget}\0${eventSeq}`
  )
}

function evidence(kind: InfectionKind, details: InfectionDetails): string {
  if (kind !== details.type) return "Infection detected"
  switch (details.type) {
    case "command-failure":
      return `Bash command failed: ${details.normalized_command}`
    case "retry-loop":
      return `${details.consecutive_failures} consecutive failures: ${details.normalized_command}`
    case "user-rejection":
      return `User rejection matched ${details.matched_pattern}: ${details.prompt_excerpt}`
    case "edit-churn":
      return `${details.edits_in_window} overlapping edits in ${details.file_path}:${details.line_start}-${details.line_end}`
  }
}

function appendRecord(
  projectDir: string,
  session: string,
  input: HookInput,
  event: HookEvent,
  tool: RaphaelToolName | null,
  kind: InfectionKind,
  details: InfectionDetails,
  inputDigest: string,
  normalizedTarget: string,
  eventSeq: number | null
): string | null {
  const record: InfectionRecordV1 = {
    schema_version: 1,
    id: generateInfectionId(),
    ts: new Date().toISOString(),
    kind,
    session,
    hook_event: event,
    tool,
    tool_use_id:
      typeof input.tool_use_id === "string" ? input.tool_use_id : null,
    input_digest: inputDigest,
    evidence: evidence(kind, details),
    fingerprint: recordFingerprint(kind, normalizedTarget, eventSeq),
    details,
    distilled: false,
    distilled_at: null
  }
  return appendInfection(projectDir, record) ? record.id : null
}

function setLastTool(
  state: RaphaelStateV1,
  tool: RaphaelToolName,
  inputDigest: string,
  now: string
): void {
  state.last_tool = { ts: now, tool, input_digest: inputDigest }
}

function processBash(
  projectDir: string,
  session: string,
  input: HookInput,
  event: Extract<HookEvent, "PostToolUse" | "PostToolUseFailure">,
  state: RaphaelStateV1,
  eventSeq: number | null
): void {
  const config = loadConfig(projectDir)
  const now = new Date().toISOString()
  const inputDigest = digest(input.tool_input)
  setLastTool(state, "Bash", inputDigest, now)

  const outcome = commandOutcomeFromHookInput(input, config.benignExit1Commands)
  if (!outcome) return

  const commandFailure = config.detectCommandFailure
    ? detectCommandFailure({
        hookEvent: event,
        command: outcome.command,
        toolResponse: input.tool_response,
        error: input.error,
        benignExit1Commands: config.benignExit1Commands
      })
    : null
  const infectionId =
    commandFailure === null
      ? null
      : appendRecord(
          projectDir,
          session,
          input,
          event,
          "Bash",
          "command-failure",
          commandFailure,
          inputDigest,
          outcome.normalized_command,
          eventSeq
        )

  state.recent_commands.push({
    ts: now,
    normalized_command: outcome.normalized_command,
    failed: outcome.failed,
    exit_code: outcome.exit_code,
    infection_id: infectionId
  })
  state.recent_commands = state.recent_commands.slice(-20)

  const retryLoop = config.detectRetryLoop
    ? detectRetryLoop(
        outcome.command,
        state.recent_commands,
        config.retryThreshold
      )
    : null
  if (retryLoop) {
    appendRecord(
      projectDir,
      session,
      input,
      event,
      "Bash",
      "retry-loop",
      retryLoop,
      inputDigest,
      `${retryLoop.normalized_command}\0${retryLoop.exit_codes.join(",")}`,
      eventSeq
    )
  }
}

function churnWindowTarget(
  state: RaphaelStateV1,
  filePath: string,
  threshold: number
): string {
  return state.recent_edits
    .filter((edit) => edit.file_path === filePath)
    .slice(-threshold)
    .map(
      (edit) =>
        `${edit.ts}:${edit.file_path}:${edit.line_start}-${edit.line_end}`
    )
    .sort()
    .join("\0")
}

function processEditOrWrite(
  projectDir: string,
  session: string,
  input: HookInput,
  tool: Extract<RaphaelToolName, "Edit" | "Write">,
  state: RaphaelStateV1,
  eventSeq: number | null
): void {
  const now = new Date().toISOString()
  const inputDigest = digest(input.tool_input)
  if (tool === "Write") {
    setLastTool(state, tool, inputDigest, now)
    return
  }

  const filePath = input.tool_input?.file_path
  const newString = input.tool_input?.new_string
  const result = applyEditToState(projectDir, state, {
    ts: now,
    filePath: typeof filePath === "string" ? filePath : "",
    newString: typeof newString === "string" ? newString : "",
    inputDigest
  })
  Object.assign(state, result.state)

  const config = loadConfig(projectDir)
  if (!config.detectEditChurn || !result.footprint) return
  const churn = detectEditChurn(state.recent_edits, config.editChurnThreshold)
  if (!churn) return

  const target = churnWindowTarget(
    state,
    churn.file_path,
    config.editChurnThreshold
  )
  const fingerprint = recordFingerprint("edit-churn", target, eventSeq)
  const alreadyRecorded = readInfections(projectDir, session).some(
    (record) =>
      record.kind === "edit-churn" && record.fingerprint === fingerprint
  )
  if (alreadyRecorded) return

  appendRecord(
    projectDir,
    session,
    input,
    "PostToolUse",
    "Edit",
    "edit-churn",
    churn,
    inputDigest,
    target,
    eventSeq
  )
}

function processPrompt(
  projectDir: string,
  session: string,
  input: HookInput,
  state: RaphaelStateV1,
  eventSeq: number | null
): void {
  const prompt =
    typeof input.prompt === "string"
      ? input.prompt
      : typeof input.user_prompt === "string"
        ? input.user_prompt
        : null
  if (prompt === null) return

  const config = loadConfig(projectDir)
  if (!config.detectUserRejection) return
  const rejection = detectUserRejection(
    prompt,
    config.rejectionPatterns,
    state.last_tool === null
      ? null
      : {
          tool: state.last_tool.tool,
          input_digest: state.last_tool.input_digest
        }
  )
  if (!rejection) return

  appendRecord(
    projectDir,
    session,
    input,
    "UserPromptSubmit",
    null,
    "user-rejection",
    rejection,
    prompt,
    rejection.prompt_excerpt,
    eventSeq
  )
}

function main(): void {
  const input = readStdinSync()
  if (!input || !isHookEvent(input.hook_event_name)) return
  const projectDir = resolveProjectDir(input)
  const session = sessionFor(input)

  try {
    const state = loadState(projectDir, session)
    const eventSeq =
      typeof input.tool_use_id === "string" ? null : state.next_event_seq++
    if (
      (input.hook_event_name === "PostToolUse" ||
        input.hook_event_name === "PostToolUseFailure") &&
      input.tool_name === "Bash"
    ) {
      processBash(
        projectDir,
        session,
        input,
        input.hook_event_name,
        state,
        eventSeq
      )
    } else if (
      input.hook_event_name === "PostToolUse" &&
      isTool(input.tool_name) &&
      (input.tool_name === "Edit" || input.tool_name === "Write")
    ) {
      processEditOrWrite(
        projectDir,
        session,
        input,
        input.tool_name,
        state,
        eventSeq
      )
    } else if (input.hook_event_name === "UserPromptSubmit") {
      processPrompt(projectDir, session, input, state, eventSeq)
    } else {
      return
    }
    saveState(projectDir, state)
  } catch (error) {
    logError(projectDir, "detect-infection", error)
  }
}

main()
