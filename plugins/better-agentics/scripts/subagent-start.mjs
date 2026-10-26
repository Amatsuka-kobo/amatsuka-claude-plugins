#!/usr/bin/env node
var __defProp = Object.defineProperty;
var __name = (target, value) => __defProp(target, "name", { value, configurable: true });

// src/hooks/subagent-start.ts
import fs3 from "node:fs";
import path3 from "node:path";

// src/lib/agents.ts
import fs2 from "node:fs";
import path2 from "node:path";

// src/lib/document.ts
function frontmatterClose(lines) {
  if (lines[0]?.trim() !== "---") return -1;
  return lines.indexOf("---", 1);
}
__name(frontmatterClose, "frontmatterClose");
function bodyLines(content) {
  const lines = content.split("\n");
  const close = frontmatterClose(lines);
  return close === -1 ? lines : lines.slice(close + 1);
}
__name(bodyLines, "bodyLines");
function sectionBody(body, heading) {
  const lines = bodyLines(body);
  const start = lines.findIndex((line) => line.trim() === heading);
  if (start === -1) return void 0;
  const rest = lines.slice(start + 1);
  const end = rest.findIndex((line) => line.startsWith("## "));
  return (end === -1 ? rest : rest.slice(0, end)).join("\n").trim();
}
__name(sectionBody, "sectionBody");

// src/lib/fragments.ts
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
function pluginRoot() {
  const fromEnv = process.env.CLAUDE_PLUGIN_ROOT;
  if (fromEnv !== void 0 && fromEnv !== "") return fromEnv;
  let dir = path.dirname(fileURLToPath(import.meta.url));
  while (!fs.existsSync(path.join(dir, ".claude-plugin", "plugin.json"))) {
    const parent = path.dirname(dir);
    if (parent === dir) throw new Error("plugin root not found");
    dir = parent;
  }
  return dir;
}
__name(pluginRoot, "pluginRoot");

// src/lib/compose.ts
var ROLE_KEY = "better-agentics-role";

// src/lib/agents.ts
function projectDirOf(env, fallback) {
  const dir = env.CLAUDE_PROJECT_DIR;
  return dir === void 0 || dir === "" ? fallback : dir;
}
__name(projectDirOf, "projectDirOf");
function frontmatter(lines) {
  const meta = /* @__PURE__ */ new Map();
  if (lines[0]?.trim() !== "---") return meta;
  const close = lines.indexOf("---", 1);
  if (close === -1) return meta;
  const metadataLines = lines.slice(1, close);
  for (const [index, line] of metadataLines.entries()) {
    const at = line.indexOf(":");
    if (at <= 0) continue;
    const key = line.slice(0, at).trim();
    const value = line.slice(at + 1).trim();
    if (key === "tools" && value === "") {
      const items = [];
      for (const candidate of metadataLines.slice(index + 1)) {
        const item = candidate.match(/^\s*-\s+(.+)$/)?.[1];
        if (item === void 0) break;
        items.push(item);
      }
      meta.set(key, items.length === 0 ? value : items);
      continue;
    }
    meta.set(key, value);
  }
  return meta;
}
__name(frontmatter, "frontmatter");
function unquote(value) {
  const trimmed = value.trim();
  const quote = trimmed[0];
  if (trimmed.length >= 2 && (quote === '"' || quote === "'") && trimmed.at(-1) === quote) {
    return trimmed.slice(1, -1);
  }
  return trimmed;
}
__name(unquote, "unquote");
function parseToolsField(raw) {
  if (raw === void 0) return void 0;
  if (Array.isArray(raw)) {
    const parsed2 = raw.map(unquote).filter((item) => item !== "");
    return parsed2.length === 0 ? void 0 : parsed2;
  }
  const value = raw.trim();
  if (value === "") return void 0;
  if (value.startsWith("[")) {
    if (!value.endsWith("]")) return void 0;
    const inner = value.slice(1, -1).trim();
    if (inner === "") return [];
    return inner.split(",").map(unquote).filter((item) => item !== "");
  }
  if (value.startsWith("{") || value.startsWith("|") || value.startsWith(">")) {
    return void 0;
  }
  const parsed = value.split(",").map(unquote).filter((item) => item !== "");
  return parsed.length === 0 ? void 0 : parsed;
}
__name(parseToolsField, "parseToolsField");
function toolsFormatOf(raw) {
  if (raw === void 0) return "none";
  if (Array.isArray(raw)) return "other";
  const value = raw.trim();
  if (value === "" || /^[[{|>]/.test(value) || /["'()#]/.test(value)) {
    return "other";
  }
  return "csv";
}
__name(toolsFormatOf, "toolsFormatOf");
function keyLinesOf(lines, close, key) {
  const pattern = new RegExp(`^\\s*${key}\\s*:`);
  return lines.slice(1, Math.max(close, 1)).flatMap((line, index) => pattern.test(line) ? [index + 1] : []);
}
__name(keyLinesOf, "keyLinesOf");
function keyLineAmbiguous(lines, close, key) {
  const found = keyLinesOf(lines, close, key);
  return found.length > 1 || /^\s/.test(lines[found[0] ?? -1] ?? "");
}
__name(keyLineAmbiguous, "keyLineAmbiguous");
function stringOf(value) {
  return typeof value === "string" && value !== "" ? value : void 0;
}
__name(stringOf, "stringOf");
function scanDefinitions(projectDir) {
  const dir = path2.join(projectDir, ".claude", "agents");
  let files;
  try {
    files = fs2.readdirSync(dir).sort();
  } catch {
    return [];
  }
  const found = [];
  for (const name of files) {
    if (!name.endsWith(".md")) continue;
    let content;
    try {
      content = fs2.readFileSync(path2.join(dir, name), "utf8");
    } catch {
      continue;
    }
    const lines = content.split("\n");
    const meta = frontmatter(lines);
    const role = stringOf(meta.get(ROLE_KEY));
    if (role === void 0) continue;
    const close = lines.indexOf("---", 1);
    const raw = meta.get("tools");
    const file = name.replace(/\.md$/, "");
    found.push({
      file,
      name: unquote(stringOf(meta.get("name")) ?? file),
      role,
      model: stringOf(meta.get("model")),
      effort: stringOf(meta.get("effort")),
      tools: parseToolsField(raw),
      toolsFormat: keyLineAmbiguous(lines, close, "tools") || keyLineAmbiguous(lines, close, ROLE_KEY) ? "other" : toolsFormatOf(raw),
      whenToInvoke: sectionBody(content, "## When to invoke") ?? ""
    });
  }
  return found;
}
__name(scanDefinitions, "scanDefinitions");

// src/lib/state.ts
var ON = /* @__PURE__ */ new Set(["1", "true", "on"]);
var OFF = /* @__PURE__ */ new Set(["", "0", "false", "off"]);
function hasApiKey(env) {
  return (env.TYPESAFE_API_KEY?.trim() ?? "") !== "";
}
__name(hasApiKey, "hasApiKey");
function orchestrationState(env) {
  const value = env.AMATSUKA_AGENT_ENABLE_ORCHESTRATION?.trim().toLowerCase() ?? "";
  if (OFF.has(value)) return { kind: "off" };
  if (!ON.has(value)) return { kind: "unknown-value", value };
  const injection = env.AMATSUKA_AGENT_AUTO_INJECTION?.trim().toLowerCase() ?? "";
  if (injection !== "" && injection !== "none") {
    return { kind: "conflict-injection" };
  }
  const gate = env.AMATSUKA_AGENT_DELEGATION_GATE?.trim().toLowerCase() ?? "";
  if (ON.has(gate)) return { kind: "conflict-gate" };
  if (!hasApiKey(env)) return { kind: "no-api-key" };
  return { kind: "inject" };
}
__name(orchestrationState, "orchestrationState");
function subagentPolicyApplies(state) {
  return state.kind === "inject" || state.kind === "no-api-key";
}
__name(subagentPolicyApplies, "subagentPolicyApplies");

// src/hooks/stdin.ts
async function readStdin() {
  const chunks = [];
  for await (const chunk of process.stdin) chunks.push(chunk);
  const raw = Buffer.concat(chunks).toString("utf8").trim();
  if (raw === "") return {};
  const parsed = JSON.parse(raw);
  if (typeof parsed !== "object" || parsed === null) {
    throw new Error("hook input is not a JSON object");
  }
  return parsed;
}
__name(readStdin, "readStdin");

// src/hooks/subagent-start.ts
try {
  const input = await readStdin();
  const agentType = input.agent_type;
  if (agentType !== void 0 && subagentPolicyApplies(orchestrationState(process.env))) {
    const projectDir = projectDirOf(process.env, input.cwd ?? process.cwd());
    const matched = scanDefinitions(projectDir).some(
      (entry) => entry.name === agentType
    );
    if (matched) {
      const policy = fs3.readFileSync(
        path3.join(pluginRoot(), "references", "subagent-policy.md"),
        "utf8"
      );
      process.stdout.write(
        `${JSON.stringify({
          hookSpecificOutput: {
            hookEventName: "SubagentStart",
            additionalContext: policy
          }
        })}
`
      );
    }
  }
} catch (error) {
  process.stderr.write(
    `better-agentics subagent-start: ${error instanceof Error ? error.message : "Unexpected error"}
`
  );
}
