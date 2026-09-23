#!/usr/bin/env node

// src/hooks/parallel-nudge.ts
var PARALLEL_NUDGE = "\u4E26\u5217 dispatch \u306E\u78BA\u8A8D: \u307E\u3060\u7740\u624B\u3057\u3066\u3044\u306A\u3044\u72EC\u7ACB\u30BF\u30B9\u30AF\u304C\u6B8B\u3063\u3066\u3044\u308B\u306A\u3089\u3001\u5F8C\u7D9A\u306E\u30E1\u30C3\u30BB\u30FC\u30B8\u3067\u306F\u306A\u304F\u3001\u3053\u306E dispatch \u3068\u540C\u3058\u30E1\u30C3\u30BB\u30FC\u30B8\u5185\u3067\u4E26\u5217\u306B dispatch \u3059\u308B\u3002\u9010\u6B21\u306B\u3059\u308B\u306E\u306F\u3001\u524D\u306E\u51FA\u529B\u306B\u4F9D\u5B58\u3059\u308B\u3068\u304D\u3001\u307E\u305F\u306F\u30EF\u30FC\u30AF\u30D5\u30ED\u30FC\u306E\u624B\u9806\u304C\u9010\u6B21\u3092\u5B9A\u3081\u308B\u3068\u304D\u3067\u3042\u308B\u3002";
function respond(context) {
  process.stdout.write(
    `${JSON.stringify({
      hookSpecificOutput: {
        hookEventName: "PreToolUse",
        additionalContext: context
      }
    })}
`
  );
}
try {
  const value = process.env.AMATSUKA_AGENT_PARALLEL_NUDGE?.trim().toLowerCase();
  if (value !== "0" && value !== "false" && value !== "off") {
    respond(PARALLEL_NUDGE);
  }
} catch (error) {
  process.stderr.write(
    `agent-policy parallel-nudge: ${error instanceof Error ? error.message : "Unexpected error"}
`
  );
}
