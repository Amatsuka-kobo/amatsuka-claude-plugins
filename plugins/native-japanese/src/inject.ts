#!/usr/bin/env node
// SessionStart では references/session-start.md を、SubagentStart では
// skills/japanese-writing/SKILL.md の frontmatter を除いた本文を、UserPromptSubmit では
// references/reminder.md を、ignore-file の目印の行を除いて additionalContext として注入する。
// どの失敗でも何も書かず exit 0 で終える。
// SessionStart では、形態素解析の取得を切り離した子プロセスで起動する。

import fs from "node:fs"
import { maybeStartFetch } from "./morph-runtime.js"

const EVENTS = ["SessionStart", "SubagentStart", "UserPromptSubmit"]

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

// 形態素解析の取得は SessionStart でだけ起動する。失敗しても注入は続ける。
if (event === "SessionStart") {
  try {
    maybeStartFetch(process.env)
  } catch {}
}

const FILES: Record<string, string> = {
  SessionStart: "../references/session-start.md",
  SubagentStart: "../skills/japanese-writing/SKILL.md",
  UserPromptSubmit: "../references/reminder.md"
}
const file = FILES[event] as string
let body: string
try {
  body = fs.readFileSync(new URL(file, import.meta.url), "utf8")
} catch {
  process.exit(0)
}
// SKILL.md は先頭の frontmatter(最初の --- の行から次の --- の行まで)と直後の空行を除く
if (event === "SubagentStart") {
  body = body.replace(
    /^---[ \t]*\r?\n[\s\S]*?\r?\n---[ \t]*(?:\r?\n|$)(?:[ \t]*\r?\n)?/,
    ""
  )
}
// 検査を外すための目印は注入先に要らないので、行全体が目印である行と
// その直後の空行 1 行を取り除く。行の途中に書いた目印は残す。
body = body.replace(
  /^[ \t]*<!-- native-japanese: ignore-file -->[ \t]*(?:\r?\n|$)(?:[ \t]*\r?\n)?/gm,
  ""
)
if (body.trim() === "") process.exit(0)

process.stdout.write(
  `${JSON.stringify({
    hookSpecificOutput: {
      hookEventName: event,
      additionalContext: body
    }
  })}\n`
)
