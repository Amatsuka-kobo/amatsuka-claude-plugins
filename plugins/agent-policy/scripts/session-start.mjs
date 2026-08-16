#!/usr/bin/env node

// src/hooks/session-start.ts
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
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
var AGENTS = [
  {
    name: "gpt-sol",
    variable: "AMATSUKA_AGENT_GPT_SOL_ALIAS",
    fallback: "claude-gpt-5-6-sol"
  },
  {
    name: "gpt-terra",
    variable: "AMATSUKA_AGENT_GPT_TERRA_ALIAS",
    fallback: "claude-gpt-5-6-terra"
  },
  {
    name: "gpt-researcher",
    variable: "AMATSUKA_AGENT_GPT_TERRA_ALIAS",
    fallback: "claude-gpt-5-6-terra"
  },
  {
    name: "gpt-luna",
    variable: "AMATSUKA_AGENT_GPT_LUNA_ALIAS",
    fallback: "claude-gpt-5-6-luna"
  },
  {
    name: "grok-researcher",
    variable: "AMATSUKA_AGENT_GROK_ALIAS",
    fallback: "claude-grok-4-5"
  },
  {
    name: "grok-implementer",
    variable: "AMATSUKA_AGENT_GROK_ALIAS",
    fallback: "claude-grok-4-5"
  }
];
function reason(error) {
  return error instanceof Error ? error.message : "Unexpected error";
}
function pluginRoot(env) {
  return env.CLAUDE_PLUGIN_ROOT ?? path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
}
function replaceModel(content, alias) {
  const lines = content.split("\n");
  const open = lines.findIndex((line) => line.trim() === "---");
  const close = lines.findIndex(
    (line, at) => at > open && line.trim() === "---"
  );
  if (open === -1 || close === -1) {
    throw new Error("Bundled agent has no frontmatter");
  }
  const index = lines.findIndex(
    (line, at) => at > open && at < close && line.startsWith("model: ")
  );
  if (index === -1) {
    throw new Error("Bundled agent has no model line");
  }
  lines[index] = `model: ${alias}`;
  return lines.join("\n");
}
function sync(env) {
  const result = {
    overridden: [],
    written: [],
    stale: [],
    failed: []
  };
  const projectDir = env.CLAUDE_PROJECT_DIR;
  if (projectDir === void 0 || projectDir === "") return result;
  if (!fs.existsSync(projectDir)) return result;
  const outDir = path.join(projectDir, ".claude", "agents");
  for (const spec of AGENTS) {
    const alias = env[spec.variable]?.trim();
    const target = path.join(outDir, `${spec.name}.md`);
    if (alias === void 0 || alias === "" || alias === spec.fallback) {
      if (fs.existsSync(target)) result.stale.push(spec.name);
      continue;
    }
    try {
      const source = fs.readFileSync(
        path.join(pluginRoot(env), "agents", `${spec.name}.md`),
        "utf8"
      );
      const content = replaceModel(source, alias);
      if (fs.existsSync(target) && fs.readFileSync(target, "utf8") === content) {
        result.overridden.push(spec.name);
        continue;
      }
      fs.mkdirSync(outDir, { recursive: true });
      fs.writeFileSync(target, content);
      result.overridden.push(spec.name);
      result.written.push(spec.name);
    } catch (error) {
      result.failed.push(`${spec.name}: ${reason(error)}`);
    }
  }
  return result;
}
function build(env) {
  const policy = policyBlock(env.AMATSUKA_AGENT_AUTO_INJECTION);
  let result;
  try {
    result = sync(env);
  } catch (error) {
    result = { overridden: [], written: [], stale: [], failed: [reason(error)] };
  }
  for (const failure2 of result.failed) {
    process.stderr.write(`agent-policy session-start: ${failure2}
`);
  }
  const blocks = [
    policy,
    overrideBlock(result.overridden),
    restartBlock(result.written),
    staleBlock(result.stale)
  ].filter((block) => block !== void 0);
  if (blocks.length === 0) return void 0;
  const failure = failureBlock(result.failed);
  if (failure !== void 0) blocks.push(failure);
  return blocks.join("\n\n");
}
function overrideBlock(names) {
  if (names.length === 0) return void 0;
  return `\u6B21\u306E Agent \u306F\u30D7\u30ED\u30B8\u30A7\u30AF\u30C8\u5B9A\u7FA9(.claude/agents/)\u3092\u4F7F\u3046\u3002agent-policy: \u30D7\u30EC\u30D5\u30A3\u30C3\u30AF\u30B9\u4ED8\u304D\u306E\u540C\u68B1\u5B9A\u7FA9\u306F\u4F7F\u308F\u306A\u3044: ${names.join(", ")}`;
}
function restartBlock(names) {
  if (names.length === 0) return void 0;
  return `\u4E0A\u8A18\u306E\u3046\u3061 ${names.join(", ")} \u306E\u5B9A\u7FA9\u3092\u4ECA\u306E\u30BB\u30C3\u30B7\u30E7\u30F3\u3067\u751F\u6210\u3057\u305F\u3002\u751F\u6210\u3057\u305F\u5B9A\u7FA9\u306F\u73FE\u30BB\u30C3\u30B7\u30E7\u30F3\u306B\u306F\u53CD\u6620\u3055\u308C\u306A\u3044\u305F\u3081\u3001\u30A8\u30A4\u30EA\u30A2\u30B9\u306B\u4F9D\u5B58\u3059\u308B\u59D4\u8B72\u3092\u884C\u3046\u524D\u306B Claude Code \u3092\u518D\u8D77\u52D5\u3059\u308B\u3002`;
}
function staleBlock(names) {
  if (names.length === 0) return void 0;
  return `\u6B21\u306E Agent \u5B9A\u7FA9\u304C .claude/agents/ \u306B\u6B8B\u3063\u3066\u3044\u308B\u3002\u30D7\u30ED\u30B8\u30A7\u30AF\u30C8\u5B9A\u7FA9\u306F\u540C\u68B1\u5B9A\u7FA9\u3088\u308A\u512A\u5148\u3055\u308C\u308B\u305F\u3081\u3001\u65E7\u30BB\u30C3\u30C8\u30A2\u30C3\u30D7\u306E\u751F\u6210\u7269\u3067\u3042\u308C\u3070\u524A\u9664\u3059\u308B: ${names.join(", ")}`;
}
function failureBlock(failures) {
  if (failures.length === 0) return void 0;
  return `\u6B21\u306E Agent \u5B9A\u7FA9\u306F .claude/agents/ \u3078\u306E\u751F\u6210\u306B\u5931\u6557\u3057\u305F\u305F\u3081\u3001\u540C\u68B1\u5B9A\u7FA9\u306E\u307E\u307E(\u65E2\u5B9A\u30A8\u30A4\u30EA\u30A2\u30B9)\u3067\u3042\u308B\u3002\u30A8\u30A4\u30EA\u30A2\u30B9\u306B\u4F9D\u5B58\u3059\u308B\u59D4\u8B72\u3092\u884C\u3046\u524D\u306B\u3001\u751F\u6210\u5148\u306E\u66F8\u304D\u8FBC\u307F\u6A29\u9650\u3092\u78BA\u8A8D\u3059\u308B: ${failures.join(" / ")}`;
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
  process.stderr.write(`agent-policy session-start: ${reason(error)}
`);
}
