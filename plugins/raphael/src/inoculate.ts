#!/usr/bin/env node
import {
  listAntibodies,
  recordAntibodyFire,
  setAntibodyStatus
} from "./lib/antibody-store.js"
import { loadConfig } from "./lib/config.js"
import { readStdinSync, resolveProjectDir } from "./lib/hook-io.js"
import { sha256Hex } from "./lib/infection-store.js"
import {
  buildMatchTarget,
  matchAntibodies,
  renderAntibodyContext
} from "./lib/match-antibody.js"
import { loadState, saveState } from "./lib/state-store.js"
import type { HookInput, RaphaelToolName } from "./lib/types.js"

const TOOLS: readonly RaphaelToolName[] = ["Bash", "Edit", "Write"]

function isTool(value: unknown): value is RaphaelToolName {
  return typeof value === "string" && TOOLS.includes(value as RaphaelToolName)
}

function sessionFor(input: HookInput): string {
  return typeof input.session_id === "string" && input.session_id !== ""
    ? input.session_id
    : "unknown"
}

function isToolInput(
  value: unknown
): value is NonNullable<HookInput["tool_input"]> {
  return typeof value === "object" && value !== null && !Array.isArray(value)
}

function triggerFingerprint(target: {
  tool: RaphaelToolName
  path: string | null
  text: string
}): string {
  return sha256Hex(`${target.tool}\0${target.path ?? ""}\0${target.text}`)
}

function expireAntibodies(projectDir: string, ids: string[]): void {
  for (const id of ids) {
    try {
      setAntibodyStatus(projectDir, id, "expired")
    } catch {
      // Expiry cleanup is best-effort and must not block injection.
    }
  }
}

function main(): void {
  const input = readStdinSync()
  if (
    input?.hook_event_name !== "PreToolUse" ||
    !isTool(input.tool_name) ||
    !isToolInput(input.tool_input)
  ) {
    return
  }

  const projectDir = resolveProjectDir(input)
  try {
    const listed = listAntibodies(projectDir)
    if (listed.errors.length > 0) return

    const config = loadConfig(projectDir)
    const target = buildMatchTarget(
      input.tool_name,
      input.tool_input,
      projectDir
    )
    if (input.tool_name !== "Bash" && target.path === null) return

    const matched = matchAntibodies(listed.antibodies, target, {
      limit: config.maxInjections
    })
    expireAntibodies(projectDir, matched.expiredActiveIds)
    if (matched.selected.length === 0) return

    const fired = []
    for (const antibody of matched.selected) {
      try {
        fired.push(recordAntibodyFire(projectDir, antibody.id))
      } catch {
        // Do not inject an antibody whose fire statistic was not persisted.
      }
    }
    if (fired.length === 0) return

    const state = loadState(projectDir, sessionFor(input))
    const ts = new Date().toISOString()
    const fingerprint = triggerFingerprint(target)
    for (const antibody of fired) {
      state.injected.push({
        ts,
        antibody_id: antibody.id,
        trigger_fingerprint: fingerprint
      })
    }
    saveState(projectDir, state)

    const additionalContext = renderAntibodyContext(fired)
    if (additionalContext === "") return
    process.stdout.write(
      `${JSON.stringify({
        hookSpecificOutput: { hookEventName: "PreToolUse", additionalContext }
      })}\n`
    )
  } catch {
    // PreToolUse must remain fail-open and produce no stdout on errors.
  }
}

main()
