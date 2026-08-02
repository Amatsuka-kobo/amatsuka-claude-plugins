export type ToolUseKind = "skill" | "other"

interface StreamEvent {
  type?: unknown
  event?: {
    type?: unknown
    content_block?: {
      type?: unknown
      name?: unknown
    }
  }
}

function parseLine(line: string): StreamEvent | null {
  try {
    return JSON.parse(line) as StreamEvent
  } catch {
    return null
  }
}

/**
 * stream-json の 1 行を判定する。
 * 最初のツール呼び出しだけを見るという状態は呼び出し側が持つ。この関数は状態を持たない。
 */
export function detectFirstToolUse(line: string): ToolUseKind | null {
  const e = parseLine(line)
  if (e?.type !== "stream_event" || e.event?.type !== "content_block_start")
    return null

  const cb = e.event.content_block ?? {}
  if (cb.type !== "tool_use") return null
  return cb.name === "Skill" ? "skill" : "other"
}

export function isResultEvent(line: string): boolean {
  return parseLine(line)?.type === "result"
}
