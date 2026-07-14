#!/usr/bin/env node

// src/inject-trigger-map.ts
import fs from "node:fs";
try {
  const content = fs.readFileSync(
    new URL("../hooks/trigger-map.md", import.meta.url),
    "utf8"
  );
  process.stdout.write(
    `${JSON.stringify({
      hookSpecificOutput: {
        hookEventName: "SessionStart",
        additionalContext: content
      }
    })}
`
  );
} catch {
}
