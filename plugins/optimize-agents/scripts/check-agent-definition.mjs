// src/check-agent-definition.ts
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

// src/lib/frontmatter.ts
var FIELD_LINE = /^([^:\s][^:]*):(?:\s*(.*))?$/;
function parseFrontmatter(source) {
  const lines = source.split(/\r?\n/);
  const errors = [];
  if (lines[0] !== "---") {
    return {
      fields: {},
      body: source.trim(),
      errors: ["frontmatter \u304C --- \u3067\u59CB\u307E\u3063\u3066\u3044\u306A\u3044"]
    };
  }
  const end = lines.findIndex((line, index) => index > 0 && line === "---");
  if (end === -1) {
    return {
      fields: {},
      body: "",
      errors: ["frontmatter \u306E\u7D42\u7AEF --- \u304C\u306A\u3044"]
    };
  }
  const fields = {};
  for (let index = 1; index < end; index += 1) {
    const match = lines[index].match(FIELD_LINE);
    if (!match) continue;
    const [, key, value = ""] = match;
    const hasIndentedValue = value === "|" || value === ">" || value === "" && /^\s/.test(lines[index + 1] ?? "");
    if (!hasIndentedValue) {
      fields[key] = value;
      continue;
    }
    const values = [];
    index += 1;
    while (index < end && (/^\s/.test(lines[index]) || lines[index] === "")) {
      values.push(lines[index]);
      index += 1;
    }
    index -= 1;
    fields[key] = values.join("\n").trim();
  }
  return {
    fields,
    body: lines.slice(end + 1).join("\n").trim(),
    errors
  };
}

// src/lib/known-tools.ts
var KNOWN_TOOLS = [
  "Read",
  "Write",
  "Edit",
  "Bash",
  "Grep",
  "Glob",
  "Agent",
  "Skill",
  "LSP",
  "WebFetch",
  "WebSearch",
  "NotebookEdit",
  "TaskCreate",
  "TaskGet",
  "TaskList",
  "TaskUpdate",
  "TaskOutput",
  "TaskStop",
  "AskUserQuestion",
  "ExitPlanMode",
  "EnterPlanMode",
  "Workflow",
  "Monitor",
  "SendMessage",
  "PushNotification",
  "ListMcpResourcesTool",
  "ReadMcpResourceTool"
];

// src/check-agent-definition.ts
var KNOWN_FIELDS = /* @__PURE__ */ new Set([
  "name",
  "description",
  "tools",
  "disallowedTools",
  "model",
  "permissionMode",
  "maxTurns",
  "skills",
  "mcpServers",
  "hooks",
  "memory",
  "background",
  "effort",
  "isolation",
  "color",
  "initialPrompt"
]);
function usage() {
  console.error(
    "usage: node scripts/check-agent-definition.mjs <agent-definition.md> [--scope project|user|plugin]"
  );
}
function parseArgs(args2) {
  if (args2.length === 0) return null;
  const [file, ...options] = args2;
  let scope;
  for (let index = 0; index < options.length; index += 1) {
    if (options[index] !== "--scope") return null;
    const value = options[index + 1];
    if (value !== "project" && value !== "user" && value !== "plugin")
      return null;
    scope = value;
    index += 1;
  }
  return { file, scope };
}
function inferScope(file) {
  const normalized = path.resolve(file).split(path.sep).join("/");
  const userAgents = path.join(os.homedir(), ".claude", "agents");
  const normalizedUserAgents = userAgents.split(path.sep).join("/");
  if (normalized.includes("/plugins/") && normalized.includes("/agents/"))
    return "plugin";
  if (normalized === normalizedUserAgents || normalized.startsWith(`${normalizedUserAgents}/`))
    return "user";
  return "project";
}
function parseTools(value) {
  const trimmed = value.trim();
  if (trimmed.startsWith("[") && trimmed.endsWith("]")) {
    return trimmed.slice(1, -1).split(",").map((tool) => tool.trim().replace(/^(?:"|')|(?:"|')$/g, "")).filter(Boolean);
  }
  return trimmed.split(",").map((tool) => tool.trim()).filter(Boolean);
}
function isKnownTool(tool) {
  return KNOWN_TOOLS.includes(tool) || tool === "*" || tool.startsWith("mcp__");
}
function checkDefinition(file, scope, source) {
  const { fields, body, errors } = parseFrontmatter(source);
  const warnings = [];
  if (!fields.name) errors.push("name \u304C\u672A\u6307\u5B9A");
  if (!fields.description) errors.push("description \u304C\u672A\u6307\u5B9A");
  if (fields.name && !/^[a-z0-9-]+$/.test(fields.name))
    errors.push("name \u306F\u82F1\u5C0F\u6587\u5B57\u30FB\u6570\u5B57\u30FB\u30CF\u30A4\u30D5\u30F3\u306E\u307F\u3067\u6307\u5B9A\u3059\u308B");
  const filename = path.basename(file, path.extname(file));
  if (fields.name && fields.name !== filename)
    warnings.push("name \u304C\u30D5\u30A1\u30A4\u30EB\u540D\u3068\u4E00\u81F4\u3057\u306A\u3044");
  if ("model" in fields && fields.model.trim() === "")
    errors.push("model \u304C\u7A7A\u6587\u5B57\u5217");
  if (fields.tools) {
    for (const tool of parseTools(fields.tools)) {
      if (!isKnownTool(tool)) warnings.push(`\u672A\u77E5\u306E\u30C4\u30FC\u30EB\u540D: ${tool}`);
    }
  }
  if (scope === "plugin") {
    if ("hooks" in fields) errors.push("plugin \u914D\u4E0B\u3067\u306F hooks \u3092\u4F7F\u3048\u306A\u3044");
    if ("mcpServers" in fields)
      errors.push("plugin \u914D\u4E0B\u3067\u306F mcpServers \u3092\u4F7F\u3048\u306A\u3044");
    if ("permissionMode" in fields)
      errors.push("plugin \u914D\u4E0B\u3067\u306F permissionMode \u3092\u4F7F\u3048\u306A\u3044");
    if ("isolation" in fields && fields.isolation !== "worktree")
      errors.push("plugin \u914D\u4E0B\u306E isolation \u306F worktree \u306E\u307F\u6307\u5B9A\u3067\u304D\u308B");
  }
  if (!body) errors.push("\u672C\u6587\u304C\u7A7A");
  if (!fields.color) warnings.push("color \u304C\u672A\u6307\u5B9A");
  for (const key of Object.keys(fields)) {
    if (!KNOWN_FIELDS.has(key))
      warnings.push(`\u672A\u77E5\u306E frontmatter \u30D5\u30A3\u30FC\u30EB\u30C9: ${key}`);
  }
  return { path: file, scope, errors, warnings };
}
var args = parseArgs(process.argv.slice(2));
if (!args) {
  usage();
  process.exitCode = 2;
} else {
  const scope = args.scope ?? inferScope(args.file);
  let source;
  try {
    source = fs.readFileSync(args.file, "utf8");
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.error(`\u5B9A\u7FA9\u30D5\u30A1\u30A4\u30EB\u3092\u8AAD\u3081\u306A\u3044: ${args.file}: ${message}`);
    process.exitCode = 2;
    process.exit();
  }
  const result = checkDefinition(args.file, scope, source);
  console.log(JSON.stringify(result, null, 2));
  process.exitCode = result.errors.length === 0 ? 0 : 1;
}
