#!/usr/bin/env node

// src/hooks/delegation-gate.ts
import fs2 from "node:fs";
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

// src/hooks/delegation-gate.ts
var STDIN_TIMEOUT_MS = 2e3;
var DEFAULT_TTL_SECONDS = 7200;
var CONFIG_RELATIVE_PATH = path2.join(
  ".claude",
  "agent-policy",
  "delegation-gate.json"
);
var DIRECT_FLAG_RELATIVE_PATH = path2.join(
  ".claude",
  "agent-policy",
  "delegation-gate.direct"
);
var BUILTIN_TOOLS = {
  Edit: { pathParam: "file_path", absolute: true },
  Write: { pathParam: "file_path", absolute: true },
  NotebookEdit: { pathParam: "notebook_path", absolute: true }
};
function isRecord(value) {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
function report(message) {
  process.stderr.write(`${message}
`);
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
        if (!isRecord(parsed)) {
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
function gateEnabled(env) {
  const value = env.AMATSUKA_AGENT_DELEGATION_GATE?.trim().toLowerCase();
  return value === "1" || value === "true" || value === "on";
}
function canonicalizePath(value) {
  const absolute = path2.resolve(value);
  let existing = absolute;
  const missing = [];
  while (!fs2.existsSync(existing)) {
    const parent = path2.dirname(existing);
    if (parent === existing) return absolute;
    missing.unshift(path2.basename(existing));
    existing = parent;
  }
  return path2.resolve(fs2.realpathSync(existing), ...missing);
}
function resolveProjectRoot(input) {
  const envRoot = process.env.CLAUDE_PROJECT_DIR;
  const inputRoot = input?.cwd;
  const selected = envRoot !== void 0 && envRoot !== "" ? envRoot : typeof inputRoot === "string" && inputRoot !== "" ? inputRoot : process.cwd();
  return canonicalizePath(selected);
}
function configPath(projectRoot) {
  return path2.join(projectRoot, CONFIG_RELATIVE_PATH);
}
function directFlagPath(projectRoot) {
  return path2.join(projectRoot, DIRECT_FLAG_RELATIVE_PATH);
}
function invalidConfigMessage(file) {
  return `delegation-gate: \u6709\u52B9\u5316\u3055\u308C\u3066\u3044\u308B\u304C\u8A2D\u5B9A\u30D5\u30A1\u30A4\u30EB\u304C\u58CA\u308C\u3066\u3044\u308B(${file})`;
}
function readConfig(projectRoot) {
  const file = configPath(projectRoot);
  let raw;
  try {
    raw = fs2.readFileSync(file, "utf8");
  } catch (error) {
    const code = isRecord(error) ? error.code : void 0;
    return {
      ok: false,
      message: code === "ENOENT" ? `delegation-gate: \u6709\u52B9\u5316\u3055\u308C\u3066\u3044\u308B\u304C\u8A2D\u5B9A\u30D5\u30A1\u30A4\u30EB\u304C\u7121\u3044(${file})` : `delegation-gate: \u6709\u52B9\u5316\u3055\u308C\u3066\u3044\u308B\u304C\u8A2D\u5B9A\u30D5\u30A1\u30A4\u30EB\u3092\u8AAD\u3081\u306A\u3044(${file})`
    };
  }
  let parsed;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return { ok: false, message: invalidConfigMessage(file) };
  }
  if (!isRecord(parsed)) {
    return { ok: false, message: invalidConfigMessage(file) };
  }
  const denyGlobs = parsed.denyGlobs;
  if (!Array.isArray(denyGlobs) || !denyGlobs.every((item) => typeof item === "string")) {
    return { ok: false, message: invalidConfigMessage(file) };
  }
  if (denyGlobs.length === 0) {
    return {
      ok: false,
      message: `delegation-gate: \u6709\u52B9\u5316\u3055\u308C\u3066\u3044\u308B\u304C denyGlobs \u304C\u7A7A\u3067\u3042\u308B(${file})`
    };
  }
  const mcpTools = {};
  if (parsed.mcpTools !== void 0) {
    if (!isRecord(parsed.mcpTools)) {
      return { ok: false, message: invalidConfigMessage(file) };
    }
    for (const [toolName, value] of Object.entries(parsed.mcpTools)) {
      if (!isRecord(value) || typeof value.pathParam !== "string" || value.pathParam === "" || typeof value.absolute !== "boolean") {
        return { ok: false, message: invalidConfigMessage(file) };
      }
      mcpTools[toolName] = {
        pathParam: value.pathParam,
        absolute: value.absolute
      };
    }
  }
  const ttlSeconds = parsed.ttlSeconds ?? DEFAULT_TTL_SECONDS;
  if (typeof ttlSeconds !== "number" || !Number.isFinite(ttlSeconds) || ttlSeconds < 0) {
    return { ok: false, message: invalidConfigMessage(file) };
  }
  return {
    ok: true,
    config: { denyGlobs, mcpTools, ttlSeconds }
  };
}
function readCliTtlSeconds(projectRoot) {
  try {
    const parsed = JSON.parse(
      fs2.readFileSync(configPath(projectRoot), "utf8")
    );
    if (!isRecord(parsed)) return DEFAULT_TTL_SECONDS;
    const ttl = parsed.ttlSeconds;
    return typeof ttl === "number" && Number.isFinite(ttl) && ttl >= 0 ? ttl : DEFAULT_TTL_SECONDS;
  } catch {
    return DEFAULT_TTL_SECONDS;
  }
}
function remainingDirectSeconds(projectRoot, ttlSeconds, now = Date.now()) {
  const flag = directFlagPath(projectRoot);
  let modifiedAt;
  try {
    const stats = fs2.statSync(flag);
    if (!stats.isFile()) return void 0;
    modifiedAt = stats.mtimeMs;
  } catch {
    return void 0;
  }
  const ageSeconds = (now - modifiedAt) / 1e3;
  if (ageSeconds < 0 || ageSeconds > ttlSeconds) return void 0;
  return Math.max(0, Math.ceil(ttlSeconds - ageSeconds));
}
function runDirectCli(args, directIndex) {
  const mode = args[directIndex + 1];
  if (mode !== "on" && mode !== "off" && mode !== "status") {
    report("delegation-gate: --direct \u306B\u306F on / off / status \u3092\u6307\u5B9A\u3059\u308B");
    return;
  }
  const projectRoot = resolveProjectRoot();
  const flag = directFlagPath(projectRoot);
  const ttlSeconds = readCliTtlSeconds(projectRoot);
  if (mode === "on") {
    fs2.mkdirSync(path2.dirname(flag), { recursive: true });
    fs2.closeSync(fs2.openSync(flag, "a"));
    const now = /* @__PURE__ */ new Date();
    fs2.utimesSync(flag, now, now);
    const expiresAt = new Date(now.getTime() + ttlSeconds * 1e3);
    process.stdout.write(
      `delegation-gate: \u4E00\u6642\u89E3\u9664\u3092\u958B\u59CB\u3057\u305F(\u671F\u9650: ${expiresAt.toISOString()})
`
    );
    return;
  }
  if (mode === "off") {
    fs2.rmSync(flag, { force: true });
    process.stdout.write("delegation-gate: \u4E00\u6642\u89E3\u9664\u3092\u7D42\u4E86\u3057\u305F\n");
    return;
  }
  const remaining = remainingDirectSeconds(projectRoot, ttlSeconds);
  process.stdout.write(
    remaining === void 0 ? "delegation-gate: \u4E00\u6642\u89E3\u9664\u3057\u3066\u3044\u306A\u3044\n" : `delegation-gate: \u4E00\u6642\u89E3\u9664\u4E2D(\u6B8B\u308A ${remaining} \u79D2)
`
  );
}
function toolPathSpec(toolName, config) {
  return BUILTIN_TOOLS[toolName] ?? config.mcpTools[toolName];
}
function normalizedTargetPath(toolInput, spec, projectRoot) {
  if (!isRecord(toolInput)) return void 0;
  const rawPath = toolInput[spec.pathParam];
  if (typeof rawPath !== "string" || rawPath === "") return void 0;
  if (spec.absolute && !path2.isAbsolute(rawPath)) return void 0;
  const target = canonicalizePath(
    spec.absolute ? rawPath : path2.resolve(projectRoot, rawPath)
  );
  const relative = path2.relative(projectRoot, target);
  if (relative === ".." || relative.startsWith(`..${path2.sep}`) || path2.isAbsolute(relative)) {
    return void 0;
  }
  return relative.split(path2.sep).join("/");
}
function denialReason(projectRoot) {
  const env = {
    ...process.env,
    CLAUDE_PROJECT_DIR: projectRoot
  };
  const scope = candidateScopeFor(env.AMATSUKA_AGENT_AUTO_INJECTION) ?? "claude-only";
  const table = markerTable(
    env,
    candidateAgents(
      scanAgents(path2.join(projectRoot, ".claude", "agents")),
      scope
    ),
    scope
  );
  const candidates = table === void 0 ? "" : `(\u59D4\u8B72\u5148\u5019\u88DC \u2014 ${table})\u3002`;
  return `delegation-gate: \u30E1\u30A4\u30F3\u30BB\u30C3\u30B7\u30E7\u30F3\u3067\u3053\u306E\u5C64\u306E\u30D5\u30A1\u30A4\u30EB\u306F\u7DE8\u96C6\u3057\u306A\u3044\u904B\u7528\u65B9\u91DD\u3067\u3042\u308B\u3002\u62C5\u5F53\u8868\u306E\u5F79\u5272\u306B\u5F93\u3044 Agent tool \u3067\u59D4\u8B72\u3059\u308B\u3002${candidates}Bash \u7D4C\u7531\u306E\u66F8\u304D\u8FBC\u307F\u3084\u4ED6\u30C4\u30FC\u30EB\u3078\u306E\u5207\u66FF\u3067\u56DE\u907F\u3057\u306A\u3044\u3002\u76F4\u63A5\u7DE8\u96C6\u304C\u5FC5\u8981\u306A\u3068\u304D\u306F\u3001\u30E6\u30FC\u30B6\u30FC\u81EA\u8EAB\u304C \`--direct on\` \u3092\u5B9F\u884C\u3057\u3066\u4E00\u6642\u89E3\u9664\u3059\u308B(TTL \u3067\u81EA\u52D5\u5931\u52B9)\u3002`;
}
function respondDeny(projectRoot) {
  process.stdout.write(
    `${JSON.stringify({
      hookSpecificOutput: {
        hookEventName: "PreToolUse",
        permissionDecision: "deny",
        permissionDecisionReason: denialReason(projectRoot)
      }
    })}
`
  );
}
async function runHook() {
  if (!gateEnabled(process.env)) return;
  const result = await readHookInput();
  if (!result.ok) {
    report(`delegation-gate: ${result.reason}`);
    return;
  }
  if ("agent_id" in result.input) return;
  const projectRoot = resolveProjectRoot(result.input);
  const configResult = readConfig(projectRoot);
  if (!configResult.ok) {
    report(configResult.message);
    return;
  }
  const { config } = configResult;
  if (remainingDirectSeconds(projectRoot, config.ttlSeconds) !== void 0) {
    return;
  }
  const toolName = result.input.tool_name;
  if (typeof toolName !== "string") return;
  const spec = toolPathSpec(toolName, config);
  if (spec === void 0) return;
  const target = normalizedTargetPath(
    result.input.tool_input,
    spec,
    projectRoot
  );
  if (target === void 0) return;
  if (!config.denyGlobs.some((glob) => path2.matchesGlob(target, glob))) return;
  respondDeny(projectRoot);
}
async function main() {
  try {
    const directIndex = process.argv.indexOf("--direct");
    if (directIndex !== -1) {
      runDirectCli(process.argv, directIndex);
      return;
    }
    await runHook();
  } catch {
  }
}
void main();
