#!/usr/bin/env node
var __defProp = Object.defineProperty;
var __name = (target, value) => __defProp(target, "name", { value, configurable: true });

// src/lib/agents.ts
import fs from "node:fs";
import path from "node:path";

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

// src/lib/roles.ts
var ROLES = [
  {
    id: "complex-impl",
    label: "\u8907\u96D1\u307E\u305F\u306F\u91CD\u8981\u306A\u5B9F\u88C5",
    kind: "impl",
    model: "opus",
    effort: "medium",
    reason: "split"
  },
  {
    id: "normal-impl",
    label: "\u901A\u5E38\u306E\u5B9F\u88C5",
    kind: "impl",
    model: "sonnet",
    effort: "medium",
    reason: "split"
  },
  {
    id: "light-impl",
    label: "\u8EFD\u91CF\u306A\u5B9F\u88C5",
    kind: "impl",
    model: "haiku",
    effort: "medium",
    reason: "split"
  },
  {
    id: "general",
    label: "\u305D\u306E\u4ED6\u306E\u30BF\u30B9\u30AF",
    kind: "impl",
    model: "sonnet",
    effort: "high",
    reason: "split"
  },
  {
    id: "explore",
    label: "\u30B3\u30FC\u30C9\u30D9\u30FC\u30B9\u63A2\u7D22",
    kind: "readonly",
    model: "sonnet",
    effort: "high",
    reason: "split"
  },
  {
    id: "realtime-research",
    label: "\u30EA\u30A2\u30EB\u30BF\u30A4\u30E0\u60C5\u5831\u8ABF\u67FB",
    kind: "readonly",
    model: "sonnet",
    effort: "high",
    reason: "split"
  },
  {
    id: "e2e-verify",
    label: "E2E \u52D5\u4F5C\u691C\u8A3C\u30FB\u30D6\u30E9\u30A6\u30B6/GUI \u64CD\u4F5C",
    kind: "impl",
    model: "sonnet",
    effort: "high",
    reason: "split"
  },
  {
    id: "escalation",
    label: "\u884C\u304D\u8A70\u307E\u308A\u6642\u306E\u30A8\u30B9\u30AB\u30EC\u30FC\u30B7\u30E7\u30F3",
    kind: "impl",
    model: "fable",
    effort: "high",
    reason: "stuck"
  },
  {
    id: "design-review",
    label: "\u8A2D\u8A08\u66F8\u30FB\u5B9F\u88C5\u8A08\u753B\u66F8\u306E\u30EC\u30D3\u30E5\u30FC",
    kind: "readonly",
    model: "opus",
    effort: "high",
    reason: "review"
  },
  {
    id: "knowledge-elicitation",
    label: "\u6697\u9ED9\u77E5\u306E\u62BD\u51FA\u30FB\u7406\u89E3\u30EC\u30D3\u30E5\u30FC",
    kind: "readonly",
    model: "haiku",
    effort: "low",
    reason: "review"
  },
  {
    id: "code-review",
    label: "\u30B3\u30FC\u30C9\u30EC\u30D3\u30E5\u30FC",
    kind: "readonly",
    model: "sonnet",
    effort: "high",
    reason: "review"
  },
  {
    id: "complex-review",
    label: "\u91CD\u8981\u306A\u5B9F\u88C5\u30FB\u9AD8\u30EA\u30B9\u30AF\u8A2D\u8A08\u66F8\u306E\u6700\u7D42\u30EC\u30D3\u30E5\u30FC",
    kind: "readonly",
    model: "fable",
    effort: "high",
    reason: "review"
  },
  {
    id: "adversarial-review",
    label: "\u6575\u5BFE\u7684\u30EC\u30D3\u30E5\u30FC",
    kind: "readonly",
    model: "opus",
    effort: "high",
    reason: "review"
  }
];
function roleById(id) {
  return ROLES.find((role) => role.id === id);
}
__name(roleById, "roleById");

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
  const dir = path.join(projectDir, ".claude", "agents");
  let files;
  try {
    files = fs.readdirSync(dir).sort();
  } catch {
    return [];
  }
  const found = [];
  for (const name of files) {
    if (!name.endsWith(".md")) continue;
    let content;
    try {
      content = fs.readFileSync(path.join(dir, name), "utf8");
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
function inspect(definitions) {
  const known = [];
  const unknownRoles = [];
  for (const entry of definitions) {
    if (roleById(entry.role) === void 0) {
      unknownRoles.push({
        file: entry.file,
        name: entry.name,
        role: entry.role
      });
    } else {
      known.push(entry);
    }
  }
  const duplicates = ROLES.flatMap((role) => {
    const names = known.filter((entry) => entry.role === role.id).map((entry) => entry.name);
    return names.length >= 2 ? [{ role: role.id, names }] : [];
  });
  return { known, unknownRoles, duplicates };
}
__name(inspect, "inspect");

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

// src/hooks/session-start.ts
var INSTRUCTION = "\u6700\u521D\u306B better-agentics:orchestration \u30B9\u30AD\u30EB\u3092\u4F7F\u7528\u3059\u308B\u3002\u30B9\u30AD\u30EB\u306E\u898F\u5F8B\u306B\u5F93\u3046\u3002";
function warning(state) {
  switch (state.kind) {
    case "unknown-value":
      return `AMATSUKA_AGENT_ENABLE_ORCHESTRATION \u306E\u5024 "${state.value}" \u306F\u672A\u77E5\u306E\u305F\u3081\u3001better-agentics \u306E\u898F\u5F8B\u3092\u6CE8\u5165\u3057\u306A\u304B\u3063\u305F\u30021 / true / on \u3067\u6709\u52B9\u30010 / false / off \u3067\u7121\u52B9\u306B\u306A\u308B\u3002`;
    case "conflict-injection":
      return "AMATSUKA_AGENT_ENABLE_ORCHESTRATION \u3068 AMATSUKA_AGENT_AUTO_INJECTION \u304C\u540C\u6642\u306B\u6709\u52B9\u306A\u305F\u3081\u3001better-agentics \u306E\u898F\u5F8B\u3092\u6CE8\u5165\u3057\u306A\u304B\u3063\u305F\u3002\u3069\u3061\u3089\u304B\u4E00\u65B9\u3060\u3051\u3092\u6709\u52B9\u306B\u3059\u308B\u3002";
    case "conflict-gate":
      return "AMATSUKA_AGENT_DELEGATION_GATE \u304C\u6709\u52B9\u3067\u3001\u30AA\u30FC\u30B1\u30B9\u30C8\u30EC\u30FC\u30BF\u30FC\u306E\u76F4\u63A5\u7DE8\u96C6\u304C\u5DEE\u3057\u6B62\u3081\u3089\u308C\u308B\u305F\u3081\u3001better-agentics \u306E\u898F\u5F8B\u3092\u6CE8\u5165\u3057\u306A\u304B\u3063\u305F\u3002better-agentics \u3067\u306F\u30AA\u30FC\u30B1\u30B9\u30C8\u30EC\u30FC\u30BF\u30FC\u304C\u81EA\u5206\u3067\u7DE8\u96C6\u3059\u308B\u306E\u3067\u3001gate \u3092\u7121\u52B9\u306B\u3059\u308B\u3002";
    case "no-api-key":
      return "TYPESAFE_API_KEY \u304C\u8A2D\u5B9A\u3055\u308C\u3066\u3044\u306A\u3044\u305F\u3081\u3001better-agentics \u306E\u898F\u5F8B\u3092\u6CE8\u5165\u3057\u306A\u304B\u3063\u305F\u3002\u59D4\u8B72\u5148\u306E\u6C7A\u5B9A\u306B TypeSafe AI \u306E Jev \u3092\u4F7F\u3046\u305F\u3081\u3001\u30AD\u30FC\u304C\u5FC5\u8981\u306B\u306A\u308B\u3002";
    default:
      return void 0;
  }
}
__name(warning, "warning");
function definitionNotes(projectDir) {
  let definitions;
  try {
    definitions = scanDefinitions(projectDir);
  } catch {
    return [];
  }
  if (definitions.length === 0) {
    return [
      "better-agentics-role \u3092\u6301\u3064 Agent \u5B9A\u7FA9\u304C\u7121\u3044\u3002\u59D4\u8B72\u3092\u4F7F\u3046\u306B\u306F better-agentics:setup \u3067\u5B9A\u7FA9\u3092\u4F5C\u308B\u3002"
    ];
  }
  const { duplicates, unknownRoles } = inspect(definitions);
  const notes = [];
  if (duplicates.length > 0) {
    notes.push(
      [
        "\u6B21\u306E\u5F79\u5272\u3092 2 \u4EF6\u4EE5\u4E0A\u306E\u5B9A\u7FA9\u304C\u6301\u3064\u3002\u59D4\u8B72\u5148\u3092\u6C7A\u3081\u3089\u308C\u306A\u3044\u305F\u3081\u3001better-agentics:setup \u3067 1 \u4EF6\u306B\u7D5E\u308B\u3002",
        ...duplicates.map(
          (entry) => `- ${roleById(entry.role)?.label ?? entry.role} [${entry.role}]: ${entry.names.join(", ")}`
        )
      ].join("\n")
    );
  }
  if (unknownRoles.length > 0) {
    notes.push(
      [
        "\u6B21\u306E\u5B9A\u7FA9\u306F\u5F79\u5272\u8868\u306B\u7121\u3044 role-id \u3092\u6301\u3064\u305F\u3081\u3001\u59D4\u8B72\u5148\u306E\u5019\u88DC\u306B\u306A\u3089\u306A\u3044\u3002",
        ...unknownRoles.map((entry) => `- ${entry.name}: ${entry.role}`)
      ].join("\n")
    );
  }
  return notes;
}
__name(definitionNotes, "definitionNotes");
function build(env, cwd) {
  const state = orchestrationState(env);
  if (state.kind === "off") return void 0;
  if (state.kind !== "inject") return warning(state);
  return [INSTRUCTION, ...definitionNotes(projectDirOf(env, cwd))].join("\n\n");
}
__name(build, "build");
try {
  const input = await readStdin();
  const context = build(process.env, input.cwd ?? process.cwd());
  if (context !== void 0) {
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
} catch (error) {
  process.stderr.write(
    `better-agentics session-start: ${error instanceof Error ? error.message : "Unexpected error"}
`
  );
}
