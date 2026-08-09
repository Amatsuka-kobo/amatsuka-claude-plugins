/**
 * Copyright 2026 amatsuka-koubou
 * Copyright Anthropic, PBC
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 *     http://www.apache.org/licenses/LICENSE-2.0
 *
 * This file is a TypeScript port of the stream detection logic in
 * scripts/run_eval.py from the skill-creator Claude Code plugin.
 *
 * Changes: only the Skill tool counts as a trigger (upstream also accepted
 * Read), and matching uses a name prefix instead of the full unique name.
 */

export function judge(triggerRate: number, shouldTrigger: boolean, threshold: number): boolean {
  return shouldTrigger ? triggerRate >= threshold : triggerRate < threshold
}

export class TriggerDetector {
  private pendingSkillTool = false
  private accumulated = ""

  constructor(private readonly prefix: string) {}

  /** 判定が確定したら true/false、確定していなければ null を返す。 */
  push(line: string): boolean | null {
    const trimmed = line.trim()
    if (trimmed === "") return null

    let event: Record<string, unknown>
    try {
      event = JSON.parse(trimmed) as Record<string, unknown>
    } catch {
      return null
    }

    if (event.type === "stream_event") {
      return this.pushStreamEvent((event.event ?? {}) as Record<string, unknown>)
    }
    if (event.type === "assistant") {
      return this.pushAssistant(event)
    }
    if (event.type === "result") {
      return false
    }
    return null
  }

  private pushStreamEvent(se: Record<string, unknown>): boolean | null {
    const seType = se.type

    if (seType === "content_block_start") {
      const block = (se.content_block ?? {}) as Record<string, unknown>
      if (block.type !== "tool_use") return null
      if (block.name === "Skill") {
        this.pendingSkillTool = true
        this.accumulated = ""
        return null
      }
      return false
    }

    if (seType === "content_block_delta" && this.pendingSkillTool) {
      const delta = (se.delta ?? {}) as Record<string, unknown>
      if (delta.type === "input_json_delta") {
        this.accumulated += String(delta.partial_json ?? "")
        if (this.accumulated.includes(this.prefix)) return true
      }
      return null
    }

    if (seType === "content_block_stop" || seType === "message_stop") {
      if (this.pendingSkillTool) return this.accumulated.includes(this.prefix)
      if (seType === "message_stop") return false
      return null
    }

    return null
  }

  private pushAssistant(event: Record<string, unknown>): boolean | null {
    const message = (event.message ?? {}) as Record<string, unknown>
    const content = (message.content ?? []) as Array<Record<string, unknown>>
    for (const item of content) {
      if (item.type !== "tool_use") continue
      if (item.name !== "Skill") return false
      const input = (item.input ?? {}) as Record<string, unknown>
      return String(input.skill ?? "").includes(this.prefix)
    }
    return null
  }
}
