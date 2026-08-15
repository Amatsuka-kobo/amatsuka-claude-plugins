#!/usr/bin/env node

// src/hooks/session-start.ts
var POLICIES = {
  claude: "claude-model-policy",
  "with-codex": "with-codex-policy",
  "with-grok": "with-grok-policy",
  "with-codex-grok": "codex-grok-policy"
};
function policyBlock(value) {
  if (value === void 0 || value === "" || value === "none") return void 0;
  const policy = POLICIES[value];
  if (policy === void 0) {
    return `AMATSUKA_AGENT_AUTO_INJECTION \u306E\u5024 "${value}" \u306F\u672A\u77E5\u306E\u305F\u3081\u3001agent-policy \u306E\u65B9\u91DD\u6CE8\u5165\u3092\u30B9\u30AD\u30C3\u30D7\u3057\u305F\u3002`;
  }
  return `\u6700\u521D\u306B\u5FC5\u305A agent-policy:${policy} \u30B9\u30AD\u30EB\u3092\u4F7F\u7528\u3057\u3001\u3053\u306E\u898F\u5F8B\u306B\u5F93\u3046`;
}
function build(env) {
  const blocks = [policyBlock(env.AMATSUKA_AGENT_AUTO_INJECTION)].filter(
    (block) => block !== void 0
  );
  return blocks.length === 0 ? void 0 : blocks.join("\n\n");
}
function respond(context) {
  process.stdout.write(
    `${JSON.stringify({
      hookSpecificOutput: {
        hookEventName: "SessionStart",
        additionalContext: context
      }
    })}
`
  );
}
try {
  const context = build(process.env);
  if (context !== void 0) respond(context);
} catch (error) {
  const message = error instanceof Error ? error.message : "Unexpected error";
  process.stderr.write(`agent-policy session-start: ${message}
`);
}
