#!/usr/bin/env node
// SessionStart と SubagentStart で、references/discipline.md の全文を
// additionalContext として注入する。どの失敗でも何も書かず exit 0 で終える。

import fs from "node:fs"

const EVENTS = ["SessionStart", "SubagentStart"]

let event: unknown
try {
  const input = JSON.parse(fs.readFileSync(0, "utf8")) as {
    hook_event_name?: unknown
  } | null
  event = input?.hook_event_name
} catch {
  process.exit(0)
}
if (typeof event !== "string" || !EVENTS.includes(event)) process.exit(0)

let discipline: string
try {
  discipline = fs.readFileSync(
    new URL("../references/discipline.md", import.meta.url),
    "utf8"
  )
} catch {
  process.exit(0)
}
if (discipline.trim() === "") process.exit(0)

process.stdout.write(
  `${JSON.stringify({
    hookSpecificOutput: {
      hookEventName: event,
      additionalContext: discipline
    }
  })}\n`
)
