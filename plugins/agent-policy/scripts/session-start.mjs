#!/usr/bin/env node

// src/hooks/session-start.ts
import fs from "node:fs";
import path from "node:path";

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
    id: "general",
    label: "\u305D\u306E\u4ED6\u306E\u30BF\u30B9\u30AF",
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
var POLICIES = [
  { id: "claude-model-policy", label: "Claude \u306E\u307F", injection: "claude" },
  {
    id: "with-codex-policy",
    label: "Claude + Codex \u4F75\u7528",
    injection: "with-codex"
  },
  {
    id: "with-grok-policy",
    label: "Claude + Grok \u4F75\u7528",
    injection: "with-grok"
  },
  {
    id: "codex-grok-policy",
    label: "Claude + Codex + Grok \u4F75\u7528",
    injection: "with-codex-grok"
  }
];
var MODELS = [
  {
    id: "opus",
    vendor: "claude",
    label: "Opus",
    defaultName: "claude-opus",
    model: "opus",
    color: "blue"
  },
  {
    id: "sonnet",
    vendor: "claude",
    label: "Sonnet",
    defaultName: "claude-sonnet",
    model: "sonnet",
    color: "purple"
  },
  {
    id: "haiku",
    vendor: "claude",
    label: "Haiku",
    defaultName: "claude-haiku",
    model: "haiku",
    color: "pink"
  },
  {
    id: "fable",
    vendor: "claude",
    label: "Fable",
    defaultName: "claude-fable",
    model: "fable",
    color: "orange"
  },
  {
    id: "gpt-sol",
    vendor: "gpt",
    label: "GPT Sol",
    defaultName: "gpt-sol",
    model: "claude-gpt-5-6-sol",
    aliasEnv: "AMATSUKA_AGENT_GPT_SOL_ALIAS",
    color: "yellow"
  },
  {
    id: "gpt-terra",
    vendor: "gpt",
    label: "GPT Terra",
    defaultName: "gpt-terra",
    model: "claude-gpt-5-6-terra",
    aliasEnv: "AMATSUKA_AGENT_GPT_TERRA_ALIAS",
    color: "green"
  },
  {
    id: "gpt-luna",
    vendor: "gpt",
    label: "GPT Luna",
    defaultName: "gpt-luna",
    model: "claude-gpt-5-6-luna",
    aliasEnv: "AMATSUKA_AGENT_GPT_LUNA_ALIAS",
    color: "cyan"
  },
  {
    id: "grok",
    vendor: "grok",
    label: "Grok",
    defaultName: "grok",
    model: "claude-grok-4-6",
    aliasEnv: "AMATSUKA_AGENT_GROK_ALIAS",
    color: "red"
  }
];
var ASSIGNMENTS = {
  "claude-model-policy": {
    "complex-impl": ["opus"],
    "normal-impl": ["sonnet"],
    "light-impl": ["haiku"],
    general: ["sonnet"],
    explore: ["sonnet"],
    "realtime-research": ["sonnet"],
    "independent-review": ["sonnet"],
    "doc-review": ["haiku"],
    "code-review": ["sonnet"],
    advisor: ["fable", "opus"]
  },
  "with-codex-policy": {
    "complex-impl": ["gpt-sol"],
    "normal-impl": ["gpt-terra"],
    "light-impl": ["gpt-luna"],
    general: ["gpt-terra"],
    explore: ["gpt-terra"],
    "realtime-research": ["gpt-terra"],
    "independent-review": ["gpt-terra"],
    "doc-review": ["haiku"],
    "code-review": ["sonnet"],
    advisor: ["fable", "opus"]
  },
  "with-grok-policy": {
    "complex-impl": ["opus"],
    "normal-impl": ["grok"],
    "light-impl": ["grok"],
    general: ["grok"],
    explore: ["grok"],
    "realtime-research": ["grok"],
    "independent-review": ["grok"],
    "doc-review": ["haiku"],
    "code-review": ["sonnet"],
    advisor: ["fable", "opus"]
  },
  "codex-grok-policy": {
    "complex-impl": ["gpt-sol"],
    "normal-impl": ["gpt-terra"],
    "light-impl": ["gpt-luna"],
    general: ["gpt-terra"],
    explore: ["grok"],
    "realtime-research": ["grok"],
    "independent-review": ["grok"],
    "doc-review": ["haiku"],
    "code-review": ["sonnet"],
    advisor: ["fable", "opus"]
  }
};
function rolesFor(policy, model) {
  const assignments = ASSIGNMENTS[policy];
  const roles = Object.keys(assignments).filter(
    (role) => assignments[role].includes(model)
  );
  return sortRoleIds(roles);
}
function rolesAcrossPolicies(model) {
  const roles = /* @__PURE__ */ new Set();
  for (const policy of POLICIES) {
    for (const role of rolesFor(policy.id, model)) roles.add(role);
  }
  return sortRoleIds([...roles]);
}

// src/agents/presets.ts
var PRESETS = MODELS.filter(
  (model) => model.vendor !== "claude"
).map((model) => ({
  name: model.defaultName,
  vendor: model.vendor,
  defaultAlias: model.model,
  color: model.color,
  roleIds: rolesAcrossPolicies(model.id)
}));
var DEFAULT_ALIASES = Object.fromEntries(
  PRESETS.map((preset) => [preset.name, preset.defaultAlias])
);

// src/hooks/session-start.ts
var POLICIES2 = {
  claude: "claude-model-policy",
  "with-codex": "with-codex-policy",
  "with-grok": "with-grok-policy",
  "with-codex-grok": "codex-grok-policy"
};
var RETIRED = [
  "claude-researcher",
  "gpt-researcher",
  "grok-researcher",
  "grok-implementer"
];
var LABELS = /* @__PURE__ */ new Map();
var ALIASES = [
  {
    preset: "gpt-sol",
    variable: "AMATSUKA_AGENT_GPT_SOL_ALIAS",
    skill: "agent-policy:setup-agents"
  },
  {
    preset: "gpt-terra",
    variable: "AMATSUKA_AGENT_GPT_TERRA_ALIAS",
    skill: "agent-policy:setup-agents"
  },
  {
    preset: "gpt-luna",
    variable: "AMATSUKA_AGENT_GPT_LUNA_ALIAS",
    skill: "agent-policy:setup-agents"
  },
  {
    preset: "grok",
    variable: "AMATSUKA_AGENT_GROK_ALIAS",
    skill: "agent-policy:setup-agents"
  }
];
function policyBlock(value) {
  if (value === void 0 || value === "" || value === "none") return void 0;
  const policy = POLICIES2[value];
  if (policy === void 0) {
    return `AMATSUKA_AGENT_AUTO_INJECTION \u306E\u5024 "${value}" \u306F\u672A\u77E5\u306E\u305F\u3081\u3001agent-policy \u306E\u65B9\u91DD\u6CE8\u5165\u3092\u30B9\u30AD\u30C3\u30D7\u3057\u305F\u3002`;
  }
  return `\u6700\u521D\u306B\u5FC5\u305A agent-policy:${policy} \u30B9\u30AD\u30EB\u3092\u4F7F\u7528\u3057\u3001\u3053\u306E\u898F\u5F8B\u306B\u5F93\u3046`;
}
function agentsDir(env) {
  const projectDir = env.CLAUDE_PROJECT_DIR;
  if (projectDir === void 0 || projectDir === "") return void 0;
  const dir = path.join(projectDir, ".claude", "agents");
  return fs.existsSync(dir) ? dir : void 0;
}
function frontmatter(file) {
  const lines = fs.readFileSync(file, "utf8").split("\n");
  const meta = /* @__PURE__ */ new Map();
  if (lines[0]?.trim() !== "---") return meta;
  const close = lines.indexOf("---", 1);
  if (close === -1) return meta;
  for (const line of lines.slice(1, close)) {
    const at = line.indexOf(":");
    if (at <= 0) continue;
    meta.set(line.slice(0, at).trim(), line.slice(at + 1).trim());
  }
  return meta;
}
function scan(dir) {
  if (dir === void 0) return [];
  const found = [];
  for (const file of fs.readdirSync(dir).sort()) {
    if (!file.endsWith(".md")) continue;
    let meta;
    try {
      meta = frontmatter(path.join(dir, file));
    } catch {
      continue;
    }
    const marker = meta.get("agent-policy-role");
    found.push({
      name: meta.get("name") ?? file.replace(/\.md$/, ""),
      model: meta.get("model"),
      roles: marker === void 0 ? [] : marker.split(",").map((role) => role.trim()).filter((role) => role !== "")
    });
  }
  return found;
}
function labelOf(env, id) {
  const cached = LABELS.get(id);
  if (cached !== void 0 || LABELS.has(id)) return cached;
  const known = roleById(id);
  if (known !== void 0) {
    LABELS.set(id, known.label);
    return known.label;
  }
  const projectDir = env.CLAUDE_PROJECT_DIR;
  if (projectDir === void 0 || projectDir === "") {
    LABELS.set(id, void 0);
    return void 0;
  }
  const base = path.join(projectDir, ".claude", "agent-policy", "roles");
  const candidates = [path.join(base, `${id}.md`)];
  try {
    if (fs.existsSync(base)) {
      for (const entry of fs.readdirSync(base, { withFileTypes: true })) {
        if (entry.isDirectory()) {
          candidates.push(path.join(base, entry.name, `${id}.md`));
        }
      }
    }
  } catch {
  }
  for (const file of candidates) {
    try {
      if (!fs.existsSync(file)) continue;
      const label = frontmatter(file).get("label");
      const resolved = label === "" ? void 0 : label;
      LABELS.set(id, resolved);
      return resolved;
    } catch {
    }
  }
  LABELS.set(id, void 0);
  return void 0;
}
function markerBlock(env, marked) {
  const byRole = /* @__PURE__ */ new Map();
  for (const entry of marked) {
    for (const role of entry.roles) {
      if (labelOf(env, role) === void 0) continue;
      byRole.set(role, [...byRole.get(role) ?? [], entry.name]);
    }
  }
  if (byRole.size === 0) return void 0;
  const lines = [
    "\u6B21\u306E Agent \u306F\u5F79\u5272\u30DE\u30FC\u30AB\u30FC\u3092\u5BA3\u8A00\u3057\u3066\u3044\u308B\u3002\u62C5\u5F53\u8868\u306E\u8A72\u5F53\u3059\u308B\u5E2F\u306F\u3001\u3053\u308C\u3089\u3092\u512A\u5148\u3057\u3066\u4F7F\u3046\u3002\u540C\u3058\u5E2F\u306B\u8907\u6570\u3042\u308B\u3068\u304D\u306F\u4F9D\u983C\u5185\u5BB9\u306B\u8FD1\u3044\u3082\u306E\u3092\u9078\u3076\u3002"
  ];
  for (const role of sortRoleIds([...byRole.keys()])) {
    const names = byRole.get(role);
    if (names !== void 0) {
      lines.push(`- ${labelOf(env, role)}: ${names.join(" / ")}`);
    }
  }
  return lines.join("\n");
}
function unknownRoleBlock(env, marked) {
  const lines = [];
  for (const entry of marked) {
    for (const role of entry.roles) {
      if (labelOf(env, role) === void 0) {
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
function setupBlock(env, marked) {
  const byName = new Map(marked.map((entry) => [entry.name, entry]));
  const lines = [];
  for (const spec of ALIASES) {
    const alias = env[spec.variable]?.trim();
    if (alias === void 0 || alias === "") continue;
    if (alias === DEFAULT_ALIASES[spec.preset]) continue;
    const preset = PRESETS.find((entry) => entry.name === spec.preset);
    const named = byName.get(spec.preset);
    if (named?.model === alias) continue;
    if (preset === void 0) {
      if (named === void 0) {
        lines.push(`- ${spec.preset}: \u5B9A\u7FA9\u304C\u7121\u3044\u3002${spec.skill} \u3092\u5B9F\u884C\u3059\u308B`);
      } else {
        lines.push(
          `- ${spec.preset}: \u5B9A\u7FA9\u306E model \u304C "${named.model ?? "\u672A\u8A2D\u5B9A"}" \u3067\u3001${spec.variable} \u306E "${alias}" \u3068\u98DF\u3044\u9055\u3046\u3002${spec.skill} \u3092\u5B9F\u884C\u3059\u308B`
        );
      }
      continue;
    }
    const withAlias = marked.filter((entry) => entry.model === alias);
    const covered = new Set(withAlias.flatMap((entry) => entry.roles));
    const missing = preset.roleIds.filter((role) => !covered.has(role));
    if (missing.length === 0) continue;
    if (withAlias.length === 0) {
      if (named === void 0) {
        lines.push(
          `- ${spec.preset}: ${spec.variable} \u306E "${alias}" \u3092 model \u306B\u6301\u3064\u5B9A\u7FA9\u304C\u7121\u3044\u3002${spec.skill} \u3092\u5B9F\u884C\u3059\u308B`
        );
      } else {
        lines.push(
          `- ${spec.preset}: \u5B9A\u7FA9\u306E model \u304C "${named.model ?? "\u672A\u8A2D\u5B9A"}" \u3067\u3001${spec.variable} \u306E "${alias}" \u3068\u98DF\u3044\u9055\u3046\u3002${spec.skill} \u3092\u5B9F\u884C\u3059\u308B`
        );
      }
    } else {
      lines.push(
        `- ${spec.preset}: ${withAlias.map((entry) => entry.name).join(" / ")} \u304C "${alias}" \u3092\u4F7F\u3063\u3066\u3044\u308B\u304C\u3001${missing.join(", ")} \u3092\u5BA3\u8A00\u3059\u308B\u5B9A\u7FA9\u304C\u7121\u3044\u3002${spec.skill} \u3092\u5B9F\u884C\u3059\u308B`
      );
    }
  }
  if (lines.length === 0) return void 0;
  return [
    "\u6B21\u306E Agent \u306F\u65E2\u5B9A\u3068\u7570\u306A\u308B\u30A8\u30A4\u30EA\u30A2\u30B9\u304C\u6307\u5B9A\u3055\u308C\u3066\u3044\u308B\u304C\u3001\u30D7\u30ED\u30B8\u30A7\u30AF\u30C8\u5B9A\u7FA9\u304C\u8FFD\u968F\u3057\u3066\u3044\u306A\u3044\u3002\u30A8\u30A4\u30EA\u30A2\u30B9\u306B\u4F9D\u5B58\u3059\u308B\u59D4\u8B72\u3092\u884C\u3046\u524D\u306B\u5BFE\u51E6\u3059\u308B:",
    ...lines
  ].join("\n");
}
function retiredBlock(env, marked) {
  const found = marked.map((entry) => entry.name).filter((name) => RETIRED.includes(name));
  if (found.length === 0) return void 0;
  const lines = [
    `\u6B21\u306E Agent \u5B9A\u7FA9\u306F\u5EC3\u6B62\u6E08\u307F\u3067\u3042\u308B\u3002\u30D7\u30ED\u30B8\u30A7\u30AF\u30C8\u5B9A\u7FA9\u306F\u540C\u68B1\u5B9A\u7FA9\u3088\u308A\u512A\u5148\u3055\u308C\u308B\u305F\u3081\u524A\u9664\u3059\u308B: ${found.join(", ")}`
  ];
  const grokAlias = env.AMATSUKA_AGENT_GROK_ALIAS?.trim();
  if (found.some((name) => name.startsWith("grok-")) && (grokAlias === void 0 || grokAlias === "")) {
    lines.push(
      "Grok \u306E\u65E2\u5B9A\u30A8\u30A4\u30EA\u30A2\u30B9\u306F `claude-grok-4-6` \u3078\u5909\u308F\u3063\u305F\u3002\u30D7\u30ED\u30AD\u30B7\u8A2D\u5B9A\u306B\u3053\u306E\u5225\u540D\u304C\u7121\u3044\u5834\u5408\u3001\u59D4\u8B72\u6642\u306B `unknown provider for model` \u3067\u5931\u6557\u3059\u308B\u30024.5 \u3092\u4F7F\u3044\u7D9A\u3051\u308B\u306A\u3089 `AMATSUKA_AGENT_GROK_ALIAS=claude-grok-4-5` \u3092\u8A2D\u5B9A\u3059\u308B\u3002"
    );
  }
  return lines.join("\n");
}
function build(env) {
  let marked = [];
  try {
    marked = scan(agentsDir(env));
  } catch {
  }
  const blocks = [
    policyBlock(env.AMATSUKA_AGENT_AUTO_INJECTION),
    markerBlock(env, marked),
    unknownRoleBlock(env, marked),
    setupBlock(env, marked),
    retiredBlock(env, marked)
  ].filter((block) => block !== void 0);
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
  const context = build(process.env);
  if (context !== void 0) respond(context);
} catch (error) {
  process.stderr.write(
    `agent-policy session-start: ${error instanceof Error ? error.message : "Unexpected error"}
`
  );
}
