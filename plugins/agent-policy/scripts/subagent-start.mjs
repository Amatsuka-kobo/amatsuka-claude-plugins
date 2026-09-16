#!/usr/bin/env node

// src/hooks/subagent-start.ts
import path2 from "node:path";

// src/agents/roles.ts
var ROLES = [
  {
    id: "complex-impl",
    label: "\u8907\u96D1\u307E\u305F\u306F\u91CD\u8981\u306A\u5B9F\u88C5",
    kind: "impl",
    tools: ["Read", "Grep", "Glob", "Write", "Edit", "Bash", "Skill"]
  },
  {
    id: "normal-impl",
    label: "\u901A\u5E38\u306E\u5B9F\u88C5",
    kind: "impl",
    tools: ["Read", "Grep", "Glob", "Write", "Edit", "Bash", "Skill"]
  },
  {
    id: "light-impl",
    label: "\u8EFD\u91CF\u306A\u5B9F\u88C5",
    kind: "impl",
    tools: ["Read", "Grep", "Glob", "Write", "Edit", "Bash"]
  },
  {
    id: "escalation",
    label: "\u884C\u304D\u8A70\u307E\u308A\u6642\u306E\u30A8\u30B9\u30AB\u30EC\u30FC\u30B7\u30E7\u30F3",
    kind: "impl",
    tools: ["Read", "Grep", "Glob", "Write", "Edit", "Bash", "Skill"]
  },
  {
    id: "general",
    label: "\u305D\u306E\u4ED6\u306E\u30BF\u30B9\u30AF",
    kind: "impl",
    tools: ["Read", "Grep", "Glob", "Write", "Edit", "Bash", "Skill"]
  },
  {
    id: "design-plan",
    label: "\u8A2D\u8A08\u66F8\u30FB\u5B9F\u88C5\u8A08\u753B\u66F8(WBS)\u306E\u4F5C\u6210",
    kind: "impl",
    tools: ["Read", "Grep", "Glob", "Write", "Edit", "Bash", "Skill"]
  },
  {
    id: "doc-writing",
    label: "\u6587\u66F8\u4F5C\u6210",
    kind: "impl",
    tools: ["Read", "Grep", "Glob", "Write", "Edit", "Bash", "Skill"]
  },
  {
    id: "explore-lead",
    label: "\u30B3\u30FC\u30C9\u30D9\u30FC\u30B9\u63A2\u7D22\u7D71\u62EC",
    kind: "impl",
    tools: ["Read", "Grep", "Glob", "Write", "Edit", "Bash", "Skill"]
  },
  {
    id: "explore",
    label: "\u30B3\u30FC\u30C9\u30D9\u30FC\u30B9\u63A2\u7D22\u5B9F\u50CD",
    kind: "readonly",
    tools: ["Read", "Grep", "Glob", "Bash"]
  },
  {
    id: "realtime-research",
    label: "\u30EA\u30A2\u30EB\u30BF\u30A4\u30E0\u60C5\u5831\u8ABF\u67FB",
    kind: "readonly",
    tools: ["Read", "Grep", "Glob", "Bash", "WebSearch", "WebFetch"]
  },
  {
    id: "e2e-verify",
    label: "E2E \u52D5\u4F5C\u691C\u8A3C\u30FB\u30D6\u30E9\u30A6\u30B6/GUI \u64CD\u4F5C",
    kind: "readonly",
    tools: ["Read", "Grep", "Glob", "Bash"]
  },
  {
    id: "independent-review",
    label: "\u8A2D\u8A08\u66F8\u30FB\u5B9F\u88C5\u8A08\u753B\u66F8\u306E\u72EC\u7ACB\u30EC\u30D3\u30E5\u30FC",
    kind: "readonly",
    tools: ["Read", "Grep", "Glob", "Bash"]
  },
  {
    id: "doc-review",
    label: "\u8A2D\u8A08\u66F8\u30FB\u5B9F\u88C5\u8A08\u753B\u66F8\u306E\u30EC\u30D3\u30E5\u30FC",
    kind: "readonly",
    tools: ["Read", "Grep", "Glob"]
  },
  {
    id: "code-review",
    label: "\u30B3\u30FC\u30C9\u30EC\u30D3\u30E5\u30FC",
    kind: "readonly",
    tools: ["Read", "Grep", "Glob", "Bash"]
  },
  {
    id: "final-review",
    label: "\u91CD\u8981\u306A\u5B9F\u88C5\u306E\u6700\u7D42\u30EC\u30D3\u30E5\u30FC",
    kind: "readonly",
    tools: ["Read", "Grep", "Glob", "Bash"]
  },
  {
    id: "gate-review",
    label: "\u8A2D\u8A08\u66F8\u306E\u6700\u7D42\u30B2\u30FC\u30C8\u30EC\u30D3\u30E5\u30FC",
    kind: "readonly",
    tools: ["Read", "Grep", "Glob"]
  },
  {
    id: "advisor",
    label: "\u8A2D\u8A08\u30FB\u8A08\u753B\u30FB\u5B9F\u88C5\u306E\u30A2\u30C9\u30D0\u30A4\u30B6\u30FC",
    kind: "readonly",
    tools: ["Read", "Grep", "Glob"]
  }
];
function roleById(id) {
  return ROLES.find((role) => role.id === id);
}
function roleOrder(id) {
  const index = ROLES.findIndex((role) => role.id === id);
  return index === -1 ? ROLES.length : index;
}
function sortRoleIds(ids) {
  return [...ids].sort(
    (left, right) => roleOrder(left) - roleOrder(right) || left.localeCompare(right)
  );
}

// src/agents/policies.ts
var CUSTOM_INJECTION_VALUES = [
  "custom",
  "with-codex",
  "with-grok",
  "with-codex-grok"
];
function isCustomInjection(value) {
  if (value === void 0) return false;
  return CUSTOM_INJECTION_VALUES.includes(value.trim().toLowerCase());
}
var CLAUDE_ENUM_MODELS = [
  "sonnet",
  "opus",
  "haiku",
  "fable"
];
var CLAUDE_RESOLVED = /* @__PURE__ */ new Set([...CLAUDE_ENUM_MODELS, "inherit"]);
function runsOnClaude(model) {
  return model === void 0 || CLAUDE_RESOLVED.has(model);
}
function candidateScopeFor(value) {
  if (isCustomInjection(value)) return "with-external";
  if (value?.trim().toLowerCase() === "claude") return "claude-only";
  return void 0;
}

// src/hooks/marker-scan.ts
import fs from "node:fs";
import path from "node:path";
function frontmatter(file) {
  const lines = fs.readFileSync(file, "utf8").split("\n");
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
function unquote(value) {
  const trimmed = value.trim();
  const quote = trimmed[0];
  if (trimmed.length >= 2 && (quote === '"' || quote === "'") && trimmed.at(-1) === quote) {
    return trimmed.slice(1, -1);
  }
  return trimmed;
}
function parseToolItems(items) {
  return items.map(unquote).filter((item) => item !== "");
}
function parseToolsField(raw) {
  if (raw === void 0) return void 0;
  if (Array.isArray(raw)) {
    const parsed2 = parseToolItems(raw);
    return parsed2.length === 0 ? void 0 : parsed2;
  }
  const value = raw.trim();
  if (value === "") return void 0;
  if (value.startsWith("[")) {
    if (!value.endsWith("]")) return void 0;
    const inner = value.slice(1, -1).trim();
    if (inner === "") return [];
    return parseToolItems(inner.split(","));
  }
  if (value.startsWith("{") || value.startsWith("|") || value.startsWith(">")) {
    return void 0;
  }
  const parsed = parseToolItems(value.split(","));
  return parsed.length === 0 ? void 0 : parsed;
}
function projectAgentsDir(env) {
  const projectDir = env.CLAUDE_PROJECT_DIR;
  if (projectDir === void 0 || projectDir === "") return void 0;
  return path.join(projectDir, ".claude", "agents");
}
function scanAgents(dir) {
  if (dir === void 0) return [];
  let files;
  try {
    files = fs.readdirSync(dir).sort();
  } catch {
    return [];
  }
  const found = [];
  for (const file of files) {
    if (!file.endsWith(".md")) continue;
    let meta;
    try {
      meta = frontmatter(path.join(dir, file));
    } catch {
      continue;
    }
    const name = meta.get("name");
    const model = meta.get("model");
    const marker = meta.get("agent-policy-role");
    const vendor = meta.get("agent-policy-vendor");
    found.push({
      name: typeof name === "string" ? name : file.replace(/\.md$/, ""),
      model: typeof model === "string" ? model : void 0,
      roles: typeof marker === "string" ? marker.split(",").map((role) => role.trim()).filter((role) => role !== "") : [],
      tools: parseToolsField(meta.get("tools")),
      vendor: typeof vendor === "string" ? vendor : void 0
    });
  }
  return found;
}
function roleLabel(env, role) {
  const known = roleById(role);
  if (known !== void 0) return known.label;
  const projectDir = env.CLAUDE_PROJECT_DIR;
  if (projectDir === void 0 || projectDir === "") return void 0;
  const base = path.join(projectDir, ".claude", "agent-policy", "roles");
  const candidates = [path.join(base, `${role}.md`)];
  try {
    if (fs.existsSync(base)) {
      for (const entry of fs.readdirSync(base, { withFileTypes: true })) {
        if (entry.isDirectory()) {
          candidates.push(path.join(base, entry.name, `${role}.md`));
        }
      }
    }
  } catch {
  }
  for (const file of candidates) {
    try {
      if (!fs.existsSync(file)) continue;
      const value = frontmatter(file).get("label");
      return typeof value === "string" && value !== "" ? value : void 0;
    } catch {
    }
  }
  return void 0;
}
function roleLabels(env) {
  const labels = /* @__PURE__ */ new Map();
  return (role) => {
    if (labels.has(role)) return labels.get(role);
    const label = roleLabel(env, role);
    labels.set(role, label);
    return label;
  };
}
var CLAUDE_VENDORS = /* @__PURE__ */ new Set(["claude", "none"]);
function runsOnClaudeAgent(entry) {
  return runsOnClaude(entry.model) && (entry.vendor === void 0 || CLAUDE_VENDORS.has(entry.vendor));
}
function candidateAgents(marked, scope) {
  if (scope === "with-external") return marked;
  return marked.filter(runsOnClaudeAgent);
}
var SCOPE_LINES = {
  "claude-only": "\u8868\u306B\u7121\u3044\u5F79\u5272\u306E\u59D4\u8B72\u5148\u3082\u3001`model` \u304C `sonnet` / `opus` / `haiku` / `fable` / `inherit` \u306E\u3044\u305A\u308C\u304B\u307E\u305F\u306F\u672A\u5BA3\u8A00\u3067\u3001\u304B\u3064 `agent-policy-vendor` \u304C `claude` / `none` \u306E\u3044\u305A\u308C\u304B\u307E\u305F\u306F\u672A\u5BA3\u8A00\u3067\u3042\u308B\u5B9A\u7FA9\u304B\u3089\u9078\u3076\u3002\u305D\u308C\u4EE5\u5916\u306E\u5B9A\u7FA9\u306F\u59D4\u8B72\u5148\u306B\u3057\u306A\u3044\u3002",
  "with-external": "\u8868\u306B\u7121\u3044\u5F79\u5272\u306E\u59D4\u8B72\u5148\u306F\u3001\u5916\u90E8\u30D9\u30F3\u30C0\u30FC\u306E\u30E2\u30C7\u30EB\u3092\u6307\u5B9A\u3057\u305F\u5B9A\u7FA9\u3082\u542B\u3081\u3066\u9078\u3093\u3067\u3088\u3044\u3002"
};
function markerTable(env, marked, scope) {
  const labelOf = roleLabels(env);
  const byRole = /* @__PURE__ */ new Map();
  for (const entry of marked) {
    for (const role of entry.roles) {
      if (labelOf(role) === void 0) continue;
      const name = entry.vendor === void 0 ? entry.name : `${entry.name} (${entry.vendor})`;
      byRole.set(role, [...byRole.get(role) ?? [], name]);
    }
  }
  if (byRole.size === 0) return void 0;
  const lines = [
    "\u6B21\u306E Agent \u306F\u5F79\u5272\u30DE\u30FC\u30AB\u30FC\u3092\u5BA3\u8A00\u3057\u3066\u3044\u308B\u3002\u62C5\u5F53\u8868\u306E\u8A72\u5F53\u3059\u308B\u5F79\u5272\u306F\u3001\u3053\u308C\u3089\u3092\u512A\u5148\u3057\u3066\u4F7F\u3046\u3002\u540C\u3058\u5F79\u5272\u306B\u8907\u6570\u3042\u308B\u3068\u304D\u306F\u4F9D\u983C\u5185\u5BB9\u306B\u8FD1\u3044\u3082\u306E\u3092\u9078\u3076\u3002",
    SCOPE_LINES[scope]
  ];
  for (const role of sortRoleIds([...byRole.keys()])) {
    const names = byRole.get(role);
    if (names !== void 0) {
      lines.push(`- ${labelOf(role)} [${role}]: ${names.join(" / ")}`);
    }
  }
  return lines.join("\n");
}

// src/hooks/subagent-start.ts
var STDIN_TIMEOUT_MS = 2e3;
var MAX_CONTEXT_CHARS = 9500;
var NO_MARKERS = "\u5BFE\u5FDC\u8868\u306A\u3057(\u3053\u306E\u30D7\u30ED\u30B8\u30A7\u30AF\u30C8\u306B\u5F79\u5272\u30DE\u30FC\u30AB\u30FC\u4ED8\u304D\u5B9A\u7FA9\u306F\u7121\u3044)";
function report(reason) {
  process.stderr.write(`agent-policy subagent-start: ${reason}
`);
}
function debug(env, message) {
  if (env.AMATSUKA_AGENT_SUBSTART_DEBUG === "1") {
    process.stderr.write(`agent-policy subagent-start debug: ${message}
`);
  }
}
function readHookInput() {
  return new Promise((resolve) => {
    let data = "";
    let settled = false;
    let timer;
    const finish = (value) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      resolve(value);
    };
    timer = setTimeout(() => {
      process.stdin.destroy();
      finish({ ok: false, reason: "stdin timeout" });
    }, STDIN_TIMEOUT_MS);
    process.stdin.setEncoding("utf8");
    process.stdin.on("data", (chunk) => {
      data += chunk;
    });
    process.stdin.on("end", () => {
      try {
        const parsed = JSON.parse(data);
        if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
          finish({ ok: false, reason: "stdin parse failed" });
          return;
        }
        finish({ ok: true, input: parsed });
      } catch {
        finish({ ok: false, reason: "stdin parse failed" });
      }
    });
    process.stdin.on(
      "error",
      () => finish({ ok: false, reason: "stdin read failed" })
    );
  });
}
function exactMatches(agentType, projectAgents, bundledAgents) {
  const matches = [];
  for (const agent of projectAgents) {
    if (agent.name === agentType) {
      matches.push({ kind: "definition", source: "project", agent });
    }
  }
  for (const agent of bundledAgents) {
    if (agent.name === agentType || `agent-policy:${agent.name}` === agentType) {
      matches.push({ kind: "definition", source: "bundled", agent });
    }
  }
  if (agentType === "Explore" || agentType === "Plan") {
    matches.push({ kind: "builtin", name: agentType });
  }
  return matches;
}
function suffixMatches(agentType, projectAgents, bundledAgents) {
  const suffix = agentType.slice(agentType.lastIndexOf(":") + 1);
  const matches = [];
  for (const agent of projectAgents) {
    if (agent.name === suffix) {
      matches.push({ kind: "definition", source: "project", agent });
    }
  }
  for (const agent of bundledAgents) {
    if (agent.name === suffix) {
      matches.push({ kind: "definition", source: "bundled", agent });
    }
  }
  return matches;
}
function resolveAgent(value, projectAgents, bundledAgents) {
  if (typeof value !== "string" || value === "") {
    return { phase: "unknown", matches: [], target: void 0 };
  }
  const exact = exactMatches(value, projectAgents, bundledAgents);
  if (exact.length > 0) {
    return {
      phase: "exact",
      matches: exact,
      target: exact.length === 1 ? exact[0] : void 0
    };
  }
  const suffix = suffixMatches(value, projectAgents, bundledAgents);
  return {
    phase: suffix.length > 0 ? "suffix" : "unknown",
    matches: suffix,
    target: suffix.length === 1 ? suffix[0] : void 0
  };
}
function matchDescription(resolution) {
  const names = resolution.matches.map(
    (match) => match.kind === "builtin" ? `builtin:${match.name}` : `${match.source}:${match.agent.name}`
  );
  return `${resolution.phase}:${names.length === 0 ? "none" : names.join(",")}`;
}
function deniedBy(target) {
  if (target === void 0) return void 0;
  if (target.kind === "builtin") return `builtin:${target.name}`;
  if (target.agent.tools === void 0 || target.agent.tools.includes("Agent")) {
    return void 0;
  }
  return `${target.source}:${target.agent.name}:without-Agent`;
}
function truncateTable(table) {
  if (table.length <= MAX_CONTEXT_CHARS) {
    return { context: table, truncated: false };
  }
  const lines = table.split("\n");
  let context = lines.join("\n");
  while (lines.length > 2 && context.length > MAX_CONTEXT_CHARS) {
    lines.pop();
    context = lines.join("\n");
  }
  if (context.length > MAX_CONTEXT_CHARS) {
    context = context.slice(0, MAX_CONTEXT_CHARS);
  }
  return { context, truncated: true };
}
function bundledAgentsDir(env) {
  const pluginRoot = env.CLAUDE_PLUGIN_ROOT;
  if (pluginRoot === void 0 || pluginRoot === "") return void 0;
  return path2.join(pluginRoot, "agents");
}
function tableFor(env, projectAgents) {
  const scope = candidateScopeFor(env.AMATSUKA_AGENT_AUTO_INJECTION);
  if (scope === void 0) return NO_MARKERS;
  return markerTable(env, candidateAgents(projectAgents, scope), scope) ?? NO_MARKERS;
}
function buildContext(env, input) {
  const projectAgents = scanAgents(projectAgentsDir(env));
  const bundledAgents = scanAgents(bundledAgentsDir(env));
  const resolution = resolveAgent(
    input.agent_type,
    projectAgents,
    bundledAgents
  );
  const denyReason = deniedBy(resolution.target);
  debug(env, `match=${matchDescription(resolution)}`);
  debug(env, `deny=${denyReason ?? "no"}`);
  if (denyReason !== void 0) {
    debug(env, "table-size=skipped context-size=0");
    return void 0;
  }
  const table = tableFor(env, projectAgents);
  const result = truncateTable(table);
  if (result.truncated) report("truncated");
  debug(env, `table-size=${table.length} context-size=${result.context.length}`);
  return result.context;
}
function respond(context) {
  process.stdout.write(
    `${JSON.stringify({
      hookSpecificOutput: {
        hookEventName: "SubagentStart",
        additionalContext: context
      }
    })}
`
  );
}
async function main() {
  try {
    const result = await readHookInput();
    if (!result.ok) {
      report(result.reason);
      return;
    }
    const context = buildContext(process.env, result.input);
    if (context !== void 0) respond(context);
  } catch {
    report("unexpected failure");
  }
}
void main();
