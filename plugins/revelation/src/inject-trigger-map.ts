#!/usr/bin/env node
// SessionStart フック: トリガー表(trigger-map.md)を additionalContext として注入する。
// 読めない場合は何も出力せず正常終了(フェイルオープン)。
import fs from "node:fs"

try {
  const content = fs.readFileSync(
    new URL("../hooks/trigger-map.md", import.meta.url),
    "utf8"
  )
  process.stdout.write(
    JSON.stringify({
      hookSpecificOutput: {
        hookEventName: "SessionStart",
        additionalContext: content
      }
    }) + "\n"
  )
} catch {}
