import fs from "node:fs"
import path from "node:path"
import { writeFileAtomic } from "./atomic.js"
import {
  type EditFootprint,
  findUniqueEditFootprint
} from "./detect-edit-churn.js"
import { redactSecrets } from "./redact.js"
import type { RaphaelStateV1, RaphaelToolName } from "./types.js"

const TOOLS: readonly RaphaelToolName[] = ["Bash", "Edit", "Write"]

export interface EditStateInput {
  ts: string
  filePath: string
  newString: string
  inputDigest: string
}

export type { EditFootprint } from "./detect-edit-churn.js"

export interface EditStateResult {
  state: RaphaelStateV1
  footprint: EditFootprint | null
}

export function stateFilePath(projectDir: string): string {
  return path.join(projectDir, ".raphael", "state.json")
}

export function createInitialState(session: string): RaphaelStateV1 {
  return {
    schema_version: 1,
    session,
    next_event_seq: 1,
    recent_commands: [],
    recent_edits: [],
    last_tool: null,
    injected: [],
    last_distill_nag_digest: null
  }
}

export function loadState(
  projectDir: string,
  currentSession: string
): RaphaelStateV1 {
  try {
    const parsed: unknown = JSON.parse(
      fs.readFileSync(stateFilePath(projectDir), "utf8")
    )
    const state = validateState(parsed)
    if (!state || state.session !== currentSession)
      return createInitialState(currentSession)
    return normalizeState(state)
  } catch {
    return createInitialState(currentSession)
  }
}

export function saveState(projectDir: string, state: RaphaelStateV1): void {
  const validated = validateState(state)
  if (!validated) throw new TypeError("Invalid Raphael state")
  const normalized = normalizeState(validated)
  writeFileAtomic(stateFilePath(projectDir), `${JSON.stringify(normalized)}\n`)
}

/** Returns the allocated sequence and persists the increment before returning. */
export function allocateEventSeq(
  projectDir: string,
  currentSession: string
): number {
  const state = loadState(projectDir, currentSession)
  const eventSeq = state.next_event_seq
  state.next_event_seq += 1
  saveState(projectDir, state)
  return eventSeq
}

/**
 * Reconstructs an Edit footprint from the post-edit file. Failure is deliberately
 * represented as a null footprint: last_tool may advance, but recent_edits does
 * not, so callers cannot accidentally include this event in churn counts.
 */
export function applyEditToState(
  projectDir: string,
  state: RaphaelStateV1,
  input: EditStateInput
): EditStateResult {
  const nextState: RaphaelStateV1 = {
    ...state,
    recent_commands: [...state.recent_commands],
    recent_edits: [...state.recent_edits],
    injected: [...state.injected],
    last_tool: {
      ts: input.ts,
      tool: "Edit",
      input_digest: truncate(redactSecrets(input.inputDigest), 500)
    }
  }
  const footprint = restoreEditFootprint(
    projectDir,
    input.filePath,
    input.newString
  )
  if (footprint) {
    nextState.recent_edits.push({ ts: input.ts, ...footprint })
    nextState.recent_edits = nextState.recent_edits.slice(-50)
  }
  return { state: nextState, footprint }
}

export function restoreEditFootprint(
  projectDir: string,
  filePath: string,
  newString: string
): EditFootprint | null {
  if (newString === "") return null

  const projectRoot = path.resolve(projectDir)
  const resolvedFile = path.resolve(projectRoot, filePath)
  const relative = path.relative(projectRoot, resolvedFile)
  if (
    relative === "" ||
    relative === ".." ||
    relative.startsWith(`..${path.sep}`) ||
    path.isAbsolute(relative)
  ) {
    return null
  }

  let content: string
  try {
    content = fs.readFileSync(resolvedFile, "utf8")
  } catch {
    return null
  }

  return findUniqueEditFootprint(
    relative.split(path.sep).join("/"),
    content,
    newString
  )
}

function normalizeState(state: RaphaelStateV1): RaphaelStateV1 {
  const injected = new Map<string, RaphaelStateV1["injected"][number]>()
  for (const entry of state.injected) {
    const previous = injected.get(entry.antibody_id)
    if (!previous || entry.ts >= previous.ts)
      injected.set(entry.antibody_id, entry)
  }

  return {
    ...state,
    recent_commands: state.recent_commands.slice(-20).map((command) => ({
      ...command,
      normalized_command: redactSecrets(command.normalized_command)
    })),
    recent_edits: state.recent_edits.slice(-50),
    last_tool:
      state.last_tool === null
        ? null
        : {
            ...state.last_tool,
            input_digest: truncate(
              redactSecrets(state.last_tool.input_digest),
              500
            )
          },
    injected: [...injected.values()]
  }
}

function validateState(value: unknown): RaphaelStateV1 | null {
  if (!isObject(value) || value.schema_version !== 1) return null
  if (!isString(value.session) || !isPositiveInteger(value.next_event_seq))
    return null
  if (
    !Array.isArray(value.recent_commands) ||
    !value.recent_commands.every(isRecentCommand) ||
    !Array.isArray(value.recent_edits) ||
    !value.recent_edits.every(isRecentEdit) ||
    !Array.isArray(value.injected) ||
    !value.injected.every(isInjected)
  )
    return null
  if (!(value.last_tool === null || isLastTool(value.last_tool))) return null
  if (
    !(
      value.last_distill_nag_digest === null ||
      (isString(value.last_distill_nag_digest) &&
        /^[0-9a-f]{64}$/.test(value.last_distill_nag_digest))
    )
  )
    return null
  return value as unknown as RaphaelStateV1
}

function isRecentCommand(value: unknown): boolean {
  return (
    isObject(value) &&
    isIsoDate(value.ts) &&
    isString(value.normalized_command) &&
    typeof value.failed === "boolean" &&
    isNullableFiniteNumber(value.exit_code) &&
    (value.infection_id === null || isString(value.infection_id))
  )
}

function isRecentEdit(value: unknown): boolean {
  return (
    isObject(value) &&
    isIsoDate(value.ts) &&
    isString(value.file_path) &&
    isPositiveInteger(value.line_start) &&
    isPositiveInteger(value.line_end) &&
    value.line_end >= value.line_start
  )
}

function isLastTool(value: unknown): boolean {
  return (
    isObject(value) &&
    isIsoDate(value.ts) &&
    isTool(value.tool) &&
    isString(value.input_digest)
  )
}

function isInjected(value: unknown): boolean {
  return (
    isObject(value) &&
    isIsoDate(value.ts) &&
    isString(value.antibody_id) &&
    isString(value.trigger_fingerprint)
  )
}

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value)
}

function isString(value: unknown): value is string {
  return typeof value === "string"
}

function isPositiveInteger(value: unknown): value is number {
  return typeof value === "number" && Number.isInteger(value) && value >= 1
}

function isNullableFiniteNumber(value: unknown): boolean {
  return value === null || (typeof value === "number" && Number.isFinite(value))
}

function isTool(value: unknown): value is RaphaelToolName {
  return typeof value === "string" && TOOLS.includes(value as RaphaelToolName)
}

function isIsoDate(value: unknown): value is string {
  return (
    typeof value === "string" &&
    !Number.isNaN(Date.parse(value)) &&
    new Date(value).toISOString() === value
  )
}

function truncate(value: string, maximum: number): string {
  return value.slice(0, maximum)
}
