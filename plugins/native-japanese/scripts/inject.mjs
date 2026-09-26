#!/usr/bin/env node

// src/inject.ts
import fs from "node:fs";
var EVENTS = ["SessionStart", "SubagentStart"];
var event;
try {
  const input = JSON.parse(fs.readFileSync(0, "utf8"));
  event = input?.hook_event_name;
} catch {
  process.exit(0);
}
if (typeof event !== "string" || !EVENTS.includes(event)) process.exit(0);
var discipline;
try {
  discipline = fs.readFileSync(
    new URL("../references/discipline.md", import.meta.url),
    "utf8"
  );
} catch {
  process.exit(0);
}
if (discipline.trim() === "") process.exit(0);
process.stdout.write(
  `${JSON.stringify({
    hookSpecificOutput: {
      hookEventName: event,
      additionalContext: discipline
    }
  })}
`
);
