#!/usr/bin/env node

// src/agents/live-models.ts
var TIMEOUT_MS = 3e3;
function failure(baseUrl, reason) {
  return { ok: false, baseUrl, ids: [], vendors: {}, reason };
}
function vendorFor(ownedBy) {
  if (typeof ownedBy !== "string") {
    return "unknown";
  }
  switch (ownedBy.toLowerCase()) {
    case "openai":
      return "gpt";
    case "xai":
      return "grok";
    case "anthropic":
      return "claude";
    case "antigravity":
      return "gemini";
    default:
      return "unknown";
  }
}
async function fetchLiveModels(env) {
  const baseUrl = env.ANTHROPIC_BASE_URL?.trim();
  if (!baseUrl) {
    return { ok: false, ids: [], vendors: {}, reason: "no-base-url" };
  }
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), TIMEOUT_MS);
  const headers = {};
  const authToken = env.ANTHROPIC_AUTH_TOKEN;
  if (authToken) {
    headers.Authorization = `Bearer ${authToken}`;
  } else {
    const apiKey = env.ANTHROPIC_API_KEY;
    if (apiKey) {
      headers["x-api-key"] = apiKey;
    }
  }
  try {
    const response = await fetch(`${baseUrl}/v1/models`, {
      method: "GET",
      headers,
      signal: controller.signal
    });
    if (!response.ok) {
      return failure(baseUrl, `http-${response.status}`);
    }
    let body;
    try {
      body = await response.json();
    } catch {
      return failure(
        baseUrl,
        controller.signal.aborted ? "timeout" : "parse-error"
      );
    }
    const data = typeof body === "object" && body !== null ? body.data : void 0;
    if (!Array.isArray(data)) {
      return failure(baseUrl, "parse-error");
    }
    const ids = [];
    const vendors = {};
    for (const item of data) {
      if (typeof item !== "object" || item === null) {
        continue;
      }
      const entry = item;
      const id = entry.id;
      if (typeof id !== "string") {
        continue;
      }
      ids.push(id);
      vendors[id] = vendorFor(entry.owned_by);
    }
    return { ok: true, baseUrl, ids, vendors };
  } catch {
    return failure(
      baseUrl,
      controller.signal.aborted ? "timeout" : "fetch-failed"
    );
  } finally {
    clearTimeout(timeout);
  }
}

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
    kind: "impl",
    tools: ["Read", "Grep", "Glob", "Write", "Edit", "Bash", "Skill"]
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

// src/hooks/session-start.ts
var RETIRED = [
  "claude-researcher",
  "gpt-researcher",
  "grok-researcher",
  "grok-implementer"
];
var DEPRECATED_ALIAS_VARIABLES = [
  "AMATSUKA_AGENT_GPT_SOL_ALIAS",
  "AMATSUKA_AGENT_GPT_TERRA_ALIAS",
  "AMATSUKA_AGENT_GPT_LUNA_ALIAS",
  "AMATSUKA_AGENT_GROK_ALIAS"
];
var REPAIR_BLOCK = "\u4FEE\u5FA9\u3059\u308B\u306B\u306F\u3001agent-policy:setup-agents \u3092\u518D\u5B9F\u884C\u3059\u308B\u304B\u3001\u5B9A\u7FA9\u306E `model` \u3092\u4FEE\u6B63\u3059\u308B\u304B\u3001\u30D7\u30ED\u30AD\u30B7\u3092\u8D77\u52D5\u3057\u3066\u304B\u3089\u30BB\u30C3\u30B7\u30E7\u30F3\u3092\u518D\u8D77\u52D5\u3059\u308B\u3002";
function policyBlock(policy, legacyValue) {
  const instruction = `\u6700\u521D\u306B\u5FC5\u305A agent-policy:${policy} \u30B9\u30AD\u30EB\u3092\u4F7F\u7528\u3057\u3001\u3053\u306E\u898F\u5F8B\u306B\u5F93\u3046`;
  if (legacyValue === void 0) return instruction;
  return `${instruction}
\u65E7\u4E92\u63DB\u5024 \`${legacyValue}\` \u3092\u4F7F\u7528\u3057\u3066\u3044\u308B\u3002\`AMATSUKA_AGENT_AUTO_INJECTION\` \u3092 \`custom\` \u3078\u5909\u66F4\u3059\u308B\u3002`;
}
function unknownInjectionBlock(value) {
  return `AMATSUKA_AGENT_AUTO_INJECTION \u306E\u5024 "${value}" \u306F\u672A\u77E5\u306E\u305F\u3081\u3001agent-policy \u306E\u65B9\u91DD\u6CE8\u5165\u3092\u30B9\u30AD\u30C3\u30D7\u3057\u305F\u3002`;
}
function unknownRoleBlock(env, marked) {
  const labelOf = roleLabels(env);
  const lines = [];
  for (const entry of marked) {
    for (const role of entry.roles) {
      if (labelOf(role) === void 0) {
        lines.push(`- ${entry.name}: ${role}`);
      }
    }
  }
  if (lines.length === 0) return void 0;
  return [
    "\u6B21\u306E Agent \u5B9A\u7FA9\u306F\u672A\u77E5\u306E\u5F79\u5272 ID \u3092\u5BA3\u8A00\u3057\u3066\u3044\u308B\u3002\u7121\u8996\u3057\u305F\u3002\u5F79\u5272 ID \u306E\u8AA4\u8A18\u3067\u3042\u308C\u3070\u4FEE\u6B63\u3059\u308B:",
    ...lines
  ].join("\n");
}
function retiredBlock(marked) {
  const found = marked.map((entry) => entry.name).filter((name) => RETIRED.includes(name));
  if (found.length === 0) return void 0;
  return `\u6B21\u306E Agent \u5B9A\u7FA9\u306F\u5EC3\u6B62\u6E08\u307F\u3067\u3042\u308B\u3002\u30D7\u30ED\u30B8\u30A7\u30AF\u30C8\u5B9A\u7FA9\u306F\u540C\u68B1\u5B9A\u7FA9\u3088\u308A\u512A\u5148\u3055\u308C\u308B\u305F\u3081\u524A\u9664\u3059\u308B: ${found.join(", ")}`;
}
function deprecatedAliasesBlock(env) {
  if (!DEPRECATED_ALIAS_VARIABLES.some((variable) => env[variable] !== void 0)) {
    return void 0;
  }
  return "AMATSUKA_AGENT_GPT_SOL_ALIAS / AMATSUKA_AGENT_GPT_TERRA_ALIAS / AMATSUKA_AGENT_GPT_LUNA_ALIAS / AMATSUKA_AGENT_GROK_ALIAS \u306E\u30A8\u30A4\u30EA\u30A2\u30B9\u5909\u6570\u306F\u53C2\u7167\u3055\u308C\u306A\u304F\u306A\u3063\u305F\u3002\u30E2\u30C7\u30EB\u306F agent-policy:setup-agents \u304C /v1/models \u304B\u3089\u9078\u3076\u3002\u5B9A\u7FA9\u306E `model` \u5024\u3092\u5909\u3048\u305F\u3044\u3068\u304D\u306F setup \u3092\u518D\u5B9F\u884C\u3059\u308B\u3002";
}
function markerlessFallbackBlock() {
  return "\u5F79\u5272\u30DE\u30FC\u30AB\u30FC\u4ED8\u304D\u5B9A\u7FA9\u304C\u898B\u3064\u304B\u3089\u306A\u3044(\u672A\u4F5C\u6210\u3001\u307E\u305F\u306F\u8AAD\u307F\u53D6\u308C\u306A\u3044)\u305F\u3081\u3001claude \u30D7\u30ED\u30D5\u30A1\u30A4\u30EB\u3067\u52D5\u4F5C\u3059\u308B\u3002agent-policy:setup-agents \u3067\u69CB\u6210\u3092\u4F5C\u308B\u3002";
}
function missingModelsBlock(missing) {
  const limit = 10;
  const lines = missing.slice(0, limit).map(
    (entry) => `- \u5B9A\u7FA9 \`${entry.name}\` \u306E model \`${entry.model}\` \u304C\u30D7\u30ED\u30AD\u30B7\u306E /v1/models \u306B\u5B58\u5728\u3057\u306A\u3044`
  );
  const remaining = missing.length - limit;
  if (remaining > 0) lines.push(`- \u4ED6 ${remaining} \u4EF6`);
  return [
    "\u5B9A\u7FA9\u3055\u308C\u305F model \u304C\u30D7\u30ED\u30AD\u30B7\u306E /v1/models \u306B 1 \u4EF6\u4EE5\u4E0A\u5B58\u5728\u3057\u306A\u3044\u305F\u3081\u3001\u30BB\u30C3\u30B7\u30E7\u30F3\u5168\u4F53\u3092 claude \u30D7\u30ED\u30D5\u30A1\u30A4\u30EB\u3078\u30D5\u30A9\u30FC\u30EB\u30D0\u30C3\u30AF\u3057\u305F\u3002",
    ...lines
  ].join("\n");
}
function queryFailureBlock(reason) {
  const actualReason = reason ?? "fetch-failed";
  const detail = actualReason === "no-base-url" ? `ANTHROPIC_BASE_URL \u304C\u672A\u8A2D\u5B9A(${actualReason})` : actualReason === "timeout" ? `\u30D7\u30ED\u30AD\u30B7\u3078\u63A5\u7D9A\u3067\u304D\u306A\u3044(${actualReason})` : `\u30D7\u30ED\u30AD\u30B7\u306E /v1/models \u3092\u7167\u4F1A\u3067\u304D\u306A\u3044(${actualReason})`;
  return `${detail}\u306E\u305F\u3081 custom \u69CB\u6210\u306E\u30E2\u30C7\u30EB\u5B9F\u5728\u3092\u78BA\u8A8D\u3067\u304D\u305A\u3001\u30BB\u30C3\u30B7\u30E7\u30F3\u5168\u4F53\u3092 claude \u30D7\u30ED\u30D5\u30A1\u30A4\u30EB\u3078\u30D5\u30A9\u30FC\u30EB\u30D0\u30C3\u30AF\u3057\u305F\u3002`;
}
function claudeBlocks(env, marked, legacyValue, ...extra) {
  const candidates = candidateAgents(marked, "claude-only");
  return [
    policyBlock("claude-model-policy", legacyValue),
    ...extra,
    markerTable(env, candidates, "claude-only"),
    unknownRoleBlock(env, candidates)
  ];
}
function successBlocks(env, marked, legacyValue) {
  return [
    policyBlock("custom-policy", legacyValue),
    markerTable(env, candidateAgents(marked, "with-external"), "with-external"),
    unknownRoleBlock(env, marked)
  ];
}
async function customBlocks(env, marked, injection) {
  const legacyValue = injection === "custom" ? void 0 : injection;
  const targets = marked.filter((entry) => entry.roles.length > 0);
  if (targets.length === 0) {
    return claudeBlocks(
      env,
      marked,
      legacyValue,
      markerlessFallbackBlock(),
      REPAIR_BLOCK
    );
  }
  const external = targets.filter(
    (entry) => entry.model !== void 0 && !runsOnClaude(entry.model)
  );
  const externalModels = new Set(external.map((entry) => entry.model));
  if (externalModels.size === 0) {
    return successBlocks(env, targets, legacyValue);
  }
  const live = await fetchLiveModels(env);
  if (!live.ok) {
    return claudeBlocks(
      env,
      marked,
      legacyValue,
      queryFailureBlock(live.reason),
      REPAIR_BLOCK
    );
  }
  const liveIds = new Set(live.ids);
  const missing = external.filter((entry) => !liveIds.has(entry.model));
  if (missing.length > 0) {
    return claudeBlocks(
      env,
      marked,
      legacyValue,
      missingModelsBlock(missing),
      REPAIR_BLOCK
    );
  }
  return successBlocks(env, targets, legacyValue);
}
function compact(blocks) {
  return blocks.filter((block) => block !== void 0);
}
async function build(env) {
  let marked = [];
  try {
    marked = scanAgents(projectAgentsDir(env));
  } catch {
  }
  const injection = env.AMATSUKA_AGENT_AUTO_INJECTION?.trim().toLowerCase() ?? "";
  let profileBlocks;
  if (injection === "" || injection === "none") {
    profileBlocks = [];
  } else if (injection === "claude") {
    profileBlocks = claudeBlocks(env, marked);
  } else if (isCustomInjection(injection)) {
    profileBlocks = await customBlocks(env, marked, injection);
  } else {
    profileBlocks = [unknownInjectionBlock(injection)];
  }
  const blocks = compact([
    ...profileBlocks,
    retiredBlock(marked),
    deprecatedAliasesBlock(env)
  ]);
  if (blocks.length === 0) return void 0;
  return blocks.join("\n\n");
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
  const context = await build(process.env);
  if (context !== void 0) respond(context);
} catch (error) {
  process.stderr.write(
    `agent-policy session-start: ${error instanceof Error ? error.message : "Unexpected error"}
`
  );
}
