// src/setup-agents.ts
import fs2 from "node:fs";
import path2 from "node:path";
import { fileURLToPath } from "node:url";

// src/agents/fragments.ts
import fs from "node:fs";
import path from "node:path";

// src/agents/hash.ts
import crypto from "node:crypto";
function bodyHash(content) {
  const lines = content.split("\n");
  let body = lines;
  if (lines[0]?.trim() === "---") {
    const close = lines.indexOf("---", 1);
    if (close !== -1) body = lines.slice(close + 1);
  }
  return crypto.createHash("sha256").update(body.join("\n").trim()).digest("hex").slice(0, 16);
}

// src/agents/fragments.ts
function parse(content) {
  const lines = content.split("\n");
  if (lines[0]?.trim() !== "---") throw new Error("Fragment has no frontmatter");
  const close = lines.indexOf("---", 1);
  if (close === -1) throw new Error("Fragment frontmatter is not closed");
  const meta = {};
  for (const line of lines.slice(1, close)) {
    const at = line.indexOf(":");
    if (at <= 0) continue;
    meta[line.slice(0, at).trim()] = line.slice(at + 1).trim();
  }
  const sections = /* @__PURE__ */ new Map();
  let heading;
  for (const line of lines.slice(close + 1)) {
    if (line.startsWith("## ")) {
      heading = line.trim();
      if (!sections.has(heading)) sections.set(heading, []);
      continue;
    }
    if (heading === void 0) continue;
    sections.get(heading)?.push(line);
  }
  for (const [key, body] of sections) {
    sections.set(key, trim(body));
  }
  return { meta, sections };
}
function trim(lines) {
  let start = 0;
  let end = lines.length;
  while (start < end && lines[start]?.trim() === "") start += 1;
  while (end > start && lines[end - 1]?.trim() === "") end -= 1;
  return lines.slice(start, end);
}
function requireMeta(meta, key, file) {
  const value = meta[key];
  if (value === void 0 || value === "") {
    throw new Error(`Fragment is missing "${key}": ${file}`);
  }
  return value;
}
function readFragment(file, source) {
  const { meta, sections } = parse(fs.readFileSync(file, "utf8"));
  const kind = requireMeta(meta, "kind", file);
  if (kind !== "impl" && kind !== "readonly") {
    throw new Error(`Fragment "kind" must be impl or readonly: ${file}`);
  }
  return {
    id: requireMeta(meta, "id", file),
    label: requireMeta(meta, "label", file),
    description: requireMeta(meta, "description", file),
    defaultName: meta["default-name"],
    tools: requireMeta(meta, "tools", file).split(",").map((tool) => tool.trim()),
    kind,
    source,
    sections
  };
}
function appendSections(base, extra) {
  for (const [heading, body] of extra) {
    const current = base.sections.get(heading);
    base.sections.set(
      heading,
      current === void 0 ? body : [...current, ...body]
    );
  }
}
function loadFragments(dirs, vendor) {
  const fragments = /* @__PURE__ */ new Map();
  for (const dir of dirs) {
    if (!fs.existsSync(dir.path)) continue;
    const files = fs.readdirSync(dir.path).filter((name) => name.endsWith(".md") && !name.startsWith("_")).sort((left, right) => left.localeCompare(right));
    for (const name of files) {
      if (name.split(".").length > 2) continue;
      const fragment = readFragment(path.join(dir.path, name), dir.source);
      fragments.set(fragment.id, fragment);
    }
  }
  const overlays = /* @__PURE__ */ new Map();
  for (const dir of dirs) {
    if (!fs.existsSync(dir.path)) continue;
    for (const name of fs.readdirSync(dir.path).sort((left, right) => left.localeCompare(right))) {
      if (!name.endsWith(`.${vendor}.md`)) continue;
      const { meta, sections } = parse(
        fs.readFileSync(path.join(dir.path, name), "utf8")
      );
      const id = meta.id;
      if (id === void 0 || id === "") continue;
      overlays.set(id, sections);
    }
  }
  for (const [id, sections] of overlays) {
    const target = fragments.get(id);
    if (target !== void 0) appendSections(target, sections);
  }
  return fragments;
}
function loadCommon(dirs) {
  const sections = /* @__PURE__ */ new Map();
  for (const dir of dirs) {
    const file = path.join(dir.path, "_common.md");
    if (!fs.existsSync(file)) continue;
    for (const [heading, body] of parse(fs.readFileSync(file, "utf8")).sections) {
      sections.set(heading, body);
    }
  }
  if (sections.size === 0) throw new Error("_common.md not found");
  return sections;
}
function fragmentDirsFor(pluginRoot2, projectDir, lang) {
  const bundled = lang === "ja" || lang === "en" ? lang : "en";
  const dirs = [
    {
      path: path.join(pluginRoot2, "assets", "roles", bundled),
      source: "plugin"
    }
  ];
  const projectRoles = path.join(projectDir, ".claude", "agent-policy", "roles");
  if (bundled !== lang) {
    dirs.push({ path: path.join(projectRoles, lang), source: "project" });
  }
  dirs.push({ path: projectRoles, source: "project" });
  return dirs;
}
function bundledDir(pluginRoot2, lang) {
  const bundled = lang === "ja" || lang === "en" ? lang : "en";
  return path.join(pluginRoot2, "assets", "roles", bundled);
}
function translationDir(projectDir, lang) {
  return path.join(projectDir, ".claude", "agent-policy", "roles", lang);
}
function bundledFiles(dir) {
  return fs.readdirSync(dir).filter((name) => name.endsWith(".md")).sort((left, right) => left.localeCompare(right));
}
function checkFragments(pluginRoot2, projectDir, lang) {
  const sourceDir = bundledDir(pluginRoot2, lang);
  if (lang === "ja" || lang === "en") {
    return {
      lang,
      sourceDir,
      targetDir: null,
      missing: [],
      stale: [],
      ready: []
    };
  }
  const targetDir = translationDir(projectDir, lang);
  const missing = [];
  const stale = [];
  const ready = [];
  for (const name of bundledFiles(sourceDir)) {
    const id = name.replace(/\.md$/, "");
    const target = path.join(targetDir, name);
    if (!fs.existsSync(target)) {
      missing.push(id);
      continue;
    }
    const expected = bodyHash(
      fs.readFileSync(path.join(sourceDir, name), "utf8")
    );
    const actual = parse(fs.readFileSync(target, "utf8")).meta["source-hash"];
    if (actual !== expected) {
      stale.push({ id, expected, actual: actual ?? "" });
      continue;
    }
    ready.push(id);
  }
  return { lang, sourceDir, targetDir, missing, stale, ready };
}
function scaffoldFragments(pluginRoot2, projectDir, lang) {
  if (lang === "ja" || lang === "en") return [];
  const sourceDir = bundledDir(pluginRoot2, lang);
  const targetDir = translationDir(projectDir, lang);
  fs.mkdirSync(targetDir, { recursive: true });
  const written = [];
  for (const name of bundledFiles(sourceDir)) {
    const target = path.join(targetDir, name);
    const source = fs.readFileSync(path.join(sourceDir, name), "utf8");
    const hash = bodyHash(source);
    const current = fs.existsSync(target) ? parse(fs.readFileSync(target, "utf8")).meta["source-hash"] : void 0;
    if (current === hash) continue;
    const lines = source.split("\n");
    const close = lines.indexOf("---", 1);
    const injected = [
      ...lines.slice(0, close),
      "source-lang: en",
      `source-hash: ${hash}`,
      ...lines.slice(close)
    ];
    fs.writeFileSync(target, injected.join("\n"));
    written.push(target);
  }
  return written;
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
var AGENT_CAPABLE = [
  "complex-impl",
  "normal-impl",
  "general"
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
function allowsAgentTool(ids) {
  return ids.some((id) => AGENT_CAPABLE.includes(id));
}
function hasMixedKinds(kinds) {
  const unique2 = new Set(kinds);
  return unique2.has("impl") && unique2.has("readonly");
}

// src/agents/vocabulary.ts
var JA = {
  bodyOrder: ["## When to invoke", "## Core Responsibilities", "## \u4F5C\u696D\u624B\u9806"],
  advisorHeading: "## \u30A2\u30C9\u30D0\u30A4\u30B6\u30FC\u3078\u306E\u76F8\u8AC7",
  agentConstraintHeading: "## Agent tool \u306E\u5236\u7D04",
  constraintHeading: "## \u5236\u7D04",
  outputFormatHeading: "## Output Format",
  listSeparator: "\u3001",
  quote: (value) => `\u300C${value}\u300D`,
  describe: (roles) => `Use this agent when ${roles}\u3092\u59D4\u8B72\u3059\u308B\u3068\u304D\u3002\u8A73\u7D30\u306F\u672C\u6587\u306E\u300CWhen to invoke\u300D\u3092\u53C2\u7167\u3002`
};
var EN = {
  bodyOrder: ["## When to invoke", "## Core Responsibilities", "## Procedure"],
  advisorHeading: "## Consulting an advisor",
  agentConstraintHeading: "## Agent tool limits",
  constraintHeading: "## Constraints",
  outputFormatHeading: "## Output Format",
  listSeparator: ", ",
  quote: (value) => `"${value}"`,
  describe: (roles) => `Use this agent when delegating ${roles}. See "When to invoke" below for details.`
};
function vocabularyFor(lang) {
  return lang === "ja" ? JA : EN;
}

// src/agents/compose.ts
var COLORS = {
  gpt: "yellow",
  grok: "red",
  claude: "blue"
};
function compose(input) {
  const vocabulary = vocabularyFor(input.lang);
  const common = loadCommon(input.fragmentDirs);
  const { ids: ordered, selected } = selectFragments(input);
  const withAgent = allowsAgentTool(input.roleIds);
  const tools = resolveToolsFor(selected, withAgent, input.mcpServers ?? []);
  const denyTools = input.denyTools ?? [];
  const head = [
    "---",
    `name: ${input.name}`,
    `description: ${describe(selected, vocabulary)}`,
    `model: ${input.model}`,
    `color: ${input.color ?? COLORS[input.vendor]}`,
    `tools: ${tools.join(", ")}`,
    ...denyTools.length > 0 ? [`disallowedTools: ${denyTools.join(", ")}`] : [],
    `agent-policy-role: ${ordered.join(", ")}`,
    "---",
    ""
  ];
  const body = [];
  body.push(...preamble(common, input.name, selected, vocabulary), "");
  for (const heading of vocabulary.bodyOrder) {
    const items = selected.flatMap(
      (fragment) => fragment.sections.get(heading) ?? []
    );
    if (items.length === 0) continue;
    body.push(heading, "", ...items, "");
  }
  if (withAgent) {
    const advisor = common.get(vocabulary.advisorHeading);
    if (advisor !== void 0)
      body.push(vocabulary.advisorHeading, "", ...advisor, "");
  }
  const constraints = [
    ...withAgent ? common.get(vocabulary.agentConstraintHeading) ?? [] : [],
    ...common.get(vocabulary.constraintHeading) ?? [],
    ...selected.flatMap(
      (fragment) => fragment.sections.get(vocabulary.constraintHeading) ?? []
    )
  ];
  if (constraints.length > 0)
    body.push(vocabulary.constraintHeading, "", ...constraints, "");
  body.push(vocabulary.outputFormatHeading, "");
  if (selected.length === 1) {
    body.push(
      ...selected[0]?.sections.get(vocabulary.outputFormatHeading) ?? [],
      ""
    );
  } else {
    for (const fragment of selected) {
      const items = fragment.sections.get(vocabulary.outputFormatHeading);
      if (items === void 0 || items.length === 0) continue;
      body.push(`### ${fragment.label}`, "", ...items, "");
    }
  }
  return `${[...head, ...body].join("\n").replace(/\n{3,}/g, "\n\n").trimEnd()}
`;
}
function describeRoles(input) {
  const { ids, selected } = selectFragments(input);
  const implRoles = selected.filter((fragment) => fragment.kind === "impl").map((fragment) => fragment.id);
  const readonlyRoles = selected.filter((fragment) => fragment.kind === "readonly").map((fragment) => fragment.id);
  return {
    ids,
    implRoles,
    readonlyRoles,
    mixedKinds: hasMixedKinds(selected.map((fragment) => fragment.kind)),
    agentTool: allowsAgentTool(input.roleIds)
  };
}
function selectFragments(input) {
  const fragments = loadFragments(input.fragmentDirs, input.vendor);
  const ids = sortRoleIds(input.roleIds);
  const selected = ids.map((id) => {
    const fragment = fragments.get(id);
    if (fragment === void 0) throw new Error(`Unknown role id: ${id}`);
    return fragment;
  });
  return { ids, selected };
}
function resolveToolsFor(selected, withAgent, mcpServers) {
  const tools = [];
  for (const fragment of selected) {
    for (const tool of fragment.tools) {
      if (tool !== "Agent" && !tools.includes(tool)) tools.push(tool);
    }
  }
  if (withAgent) tools.push("Agent");
  for (const server of mcpServers) {
    if (!tools.includes(server)) tools.push(server);
  }
  return tools;
}
function describe(selected, vocabulary) {
  const list = selected.map((fragment) => fragment.description).join(vocabulary.listSeparator);
  return vocabulary.describe(list);
}
function preamble(common, name, selected, vocabulary) {
  const labels = selected.map((fragment) => vocabulary.quote(fragment.label)).join(vocabulary.listSeparator);
  return (common.get("## Preamble") ?? []).map(
    (line) => line.replace("{{NAME}}", name).replace("{{ROLE_LABELS}}", labels)
  );
}

// src/agents/mcp.ts
import { execFileSync } from "node:child_process";
var USABLE = ["\u2714 Connected", "cached"];
var STATUSES = [
  "\u2714 Connected",
  "\u2718 Failed to connect",
  "! Needs authentication",
  "\u23F8 Pending approval",
  "\u2718 Rejected",
  "cached"
];
function parseMcpList(output) {
  const servers = [];
  for (const raw of output.split("\n")) {
    const line = raw.trim();
    if (line === "") continue;
    if (line.startsWith("\u26A0") || line.startsWith("Checking")) continue;
    const at = line.lastIndexOf(" - ");
    if (at === -1) continue;
    const status = line.slice(at + 3).trim();
    if (!STATUSES.some((known) => status.startsWith(known))) continue;
    const head = line.slice(0, at);
    const space = head.indexOf(" ");
    const name = (space === -1 ? head : head.slice(0, space)).replace(/:$/, "");
    if (name === "") continue;
    servers.push({
      name,
      status,
      usable: USABLE.some((known) => status.startsWith(known))
    });
  }
  return servers;
}
function toolPrefix(name) {
  return `mcp__${name.replace(/[^A-Za-z0-9_-]/g, "_")}`;
}
function listMcpServers(env) {
  const bin = env.AGENT_POLICY_CLAUDE_BIN;
  const options = {
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
    timeout: 3e4,
    maxBuffer: 8 * 1024 * 1024,
    // options.env は process.env と自動マージされないため、PATH を保つ。
    env: { ...process.env, ...env }
  };
  try {
    const output = bin === void 0 || bin === "" ? execFileSync("claude", ["mcp", "list"], options) : execFileSync(process.execPath, [bin], options);
    return parseMcpList(output);
  } catch {
    return [];
  }
}
function mcpCurrentOf(content) {
  const lines = content.split("\n");
  if (lines[0]?.trim() !== "---") return { servers: [], denyTools: [] };
  const close = lines.indexOf("---", 1);
  if (close === -1) return { servers: [], denyTools: [] };
  const meta = /* @__PURE__ */ new Map();
  for (const line of lines.slice(1, close)) {
    const at = line.indexOf(": ");
    if (at <= 0) continue;
    meta.set(line.slice(0, at).trim(), line.slice(at + 2).trim());
  }
  const split = (value) => value === void 0 ? [] : value.split(",").map((entry) => entry.trim()).filter((entry) => entry !== "");
  return {
    servers: split(meta.get("tools")).filter((tool) => tool.startsWith("mcp__")).map((tool) => tool.slice("mcp__".length)),
    denyTools: split(meta.get("disallowedTools"))
  };
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
function modelById(id) {
  return MODELS.find((model) => model.id === id);
}
function policyById(id) {
  return POLICIES.find((policy) => policy.id === id);
}
function policyForInjection(value) {
  if (value === void 0) return void 0;
  return POLICIES.find((policy) => policy.injection === value.trim())?.id;
}
function modelsFor(policy) {
  const used = /* @__PURE__ */ new Set();
  for (const models of Object.values(ASSIGNMENTS[policy])) {
    for (const id of models) used.add(id);
  }
  return MODELS.filter((model) => used.has(model.id));
}
function rolesFor(policy, model) {
  const assignments = ASSIGNMENTS[policy];
  const roles = Object.keys(assignments).filter(
    (role) => assignments[role].includes(model)
  );
  return sortRoleIds(roles);
}
function resolveModelValue(spec, env) {
  if (spec.aliasEnv === void 0) return spec.model;
  const value = env[spec.aliasEnv]?.trim();
  return value === void 0 || value === "" ? spec.model : value;
}

// src/setup-agents.ts
function parseDocument(content) {
  const lines = content.split("\n");
  const startsWithFrontmatter = lines[0]?.trim() === "---";
  const close = startsWithFrontmatter ? lines.indexOf("---", 1) : -1;
  const hasFrontmatter = startsWithFrontmatter && close !== -1;
  const meta = /* @__PURE__ */ new Map();
  const order = [];
  if (hasFrontmatter) {
    for (const line of lines.slice(1, close)) {
      const at = line.indexOf(": ");
      if (at <= 0) continue;
      const key = line.slice(0, at);
      meta.set(key, line.slice(at + 2));
      order.push(key);
    }
  }
  const preamble2 = [];
  const sections = /* @__PURE__ */ new Map();
  let heading;
  let buffer = [];
  for (const line of lines.slice(hasFrontmatter ? close + 1 : 0)) {
    if (line.startsWith("## ")) {
      if (heading !== void 0) sections.set(heading, buffer.join("\n").trim());
      heading = line.trim();
      buffer = [];
      continue;
    }
    if (heading === void 0) preamble2.push(line);
    else buffer.push(line);
  }
  if (heading !== void 0) sections.set(heading, buffer.join("\n").trim());
  return { order, meta, preamble: preamble2.join("\n").trim(), sections };
}
function splitTools(value) {
  if (value === void 0) return [];
  return value.split(",").map((tool) => tool.trim()).filter((tool) => tool !== "");
}
function only(left, right) {
  return left.filter((item) => !right.includes(item));
}
function pluginRoot() {
  return process.env.CLAUDE_PLUGIN_ROOT ?? path2.resolve(path2.dirname(fileURLToPath(import.meta.url)), "..");
}
function requirePolicy(options) {
  const policy = policyById(options.policy);
  if (policy === void 0) {
    throw new Error(
      `policy: must be one of ${POLICIES.map((entry) => entry.id).join(", ")}`
    );
  }
  return policy.id;
}
function requireModel(options, policy) {
  const spec = modelById(options.modelId);
  if (spec === void 0) throw new Error("model-id: is unknown");
  if (!modelsFor(policy).some((entry) => entry.id === spec.id)) {
    throw new Error(`model-id: ${spec.id} is not used in ${policy}`);
  }
  return spec;
}
function validateRoles(options, policy, model) {
  const allowed = new Set(rolesFor(policy, model.id));
  const invalid = options.roles.filter(
    (role) => roleById(role) !== void 0 && !allowed.has(role)
  );
  if (invalid.length > 0) {
    throw new Error(
      `roles: ${invalid.join(", ")} is not assigned to ${model.id} in ${policy}`
    );
  }
}
function validateFragments(options) {
  const status = checkFragments(pluginRoot(), options.dir, options.lang);
  if (status.missing.length === 0 && status.stale.length === 0) return;
  throw new Error(
    `fragments: translation for "${options.lang}" is incomplete. missing=${status.missing.join(", ")} stale=${status.stale.map((entry) => entry.id).join(", ")}. Run --scaffold-fragments and translate them first`
  );
}
function defaultAgentName(options, policy, spec) {
  const roles = rolesFor(policy, spec.id);
  if (roles.length !== 1) return spec.id;
  const role = roles[0];
  if (role === void 0) return spec.id;
  const fragments = loadFragments(
    fragmentDirsFor(pluginRoot(), options.dir, options.lang),
    spec.vendor
  );
  const defaultName = fragments.get(role)?.defaultName ?? bundledDefaultNames(options.dir).get(role);
  return defaultName === void 0 ? spec.id : `${spec.id}-${defaultName}`;
}
function targetsFor(options, policy) {
  if (options.models.length > 0) {
    return options.models.map((id) => {
      const spec2 = modelById(id);
      if (spec2 === void 0) throw new Error(`models: ${id} is unknown`);
      if (!modelsFor(policy).some((entry) => entry.id === spec2.id)) {
        throw new Error(`models: ${id} is not used in ${policy}`);
      }
      return {
        modelId: spec2.id,
        name: defaultAgentName(options, policy, spec2),
        model: resolveModelValue(spec2, process.env),
        roles: rolesFor(policy, spec2.id),
        color: spec2.color,
        vendor: spec2.vendor
      };
    });
  }
  const spec = requireModel(options, policy);
  validateRoles(options, policy, spec);
  return [
    {
      modelId: spec.id,
      name: options.name,
      model: options.model === "" ? resolveModelValue(spec, process.env) : options.model,
      roles: options.roles,
      color: spec.color,
      vendor: spec.vendor
    }
  ];
}
function composeInputFor(options, target, mcpServers) {
  return {
    name: target.name,
    model: target.model,
    vendor: target.vendor,
    roleIds: target.roles,
    fragmentDirs: fragmentDirsFor(pluginRoot(), options.dir, options.lang),
    lang: options.lang,
    color: target.color,
    mcpServers,
    denyTools: options.mcpDeny
  };
}
function templateFor(input) {
  return compose(input);
}
function targetPath(options, target) {
  return path2.join(options.dir, ".claude", "agents", `${target.name}.md`);
}
function compare(options, target, input, rendered, existingRaw) {
  const file = targetPath(options, target);
  const relative = path2.relative(options.dir, file).split(path2.sep).join("/");
  const roles = describeRoles(input);
  if (existingRaw === void 0) {
    return {
      ok: true,
      target: relative,
      exists: false,
      identical: false,
      frontmatter: {
        changed: [],
        toolsOnlyInExisting: [],
        toolsOnlyInTemplate: [],
        keysOnlyInExisting: []
      },
      preambleChanged: false,
      body: {
        sectionsOnlyInExisting: [],
        sectionsOnlyInTemplate: [],
        sectionsChanged: []
      },
      roles
    };
  }
  const existing = parseDocument(existingRaw);
  const expected = parseDocument(rendered);
  const existingTools = splitTools(existing.meta.get("tools"));
  const expectedTools = splitTools(expected.meta.get("tools"));
  const changed = [];
  for (const [key, value] of expected.meta) {
    if (key === "tools") continue;
    const current = existing.meta.get(key);
    if (current !== void 0 && current !== value) {
      changed.push({ key, existing: current, template: value });
    }
  }
  const sectionsChanged = [];
  for (const [heading, body] of expected.sections) {
    const current = existing.sections.get(heading);
    if (current !== void 0 && current !== body) sectionsChanged.push(heading);
  }
  return {
    ok: true,
    target: relative,
    exists: true,
    identical: existingRaw === rendered,
    frontmatter: {
      changed,
      toolsOnlyInExisting: only(existingTools, expectedTools),
      toolsOnlyInTemplate: only(expectedTools, existingTools),
      keysOnlyInExisting: only(
        [...existing.meta.keys()],
        [...expected.meta.keys()]
      )
    },
    preambleChanged: existing.preamble !== expected.preamble,
    body: {
      sectionsOnlyInExisting: only(
        [...existing.sections.keys()],
        [...expected.sections.keys()]
      ),
      sectionsOnlyInTemplate: only(
        [...expected.sections.keys()],
        [...existing.sections.keys()]
      ),
      sectionsChanged
    },
    roles
  };
}
function diff(options, target, mcpServers) {
  const input = composeInputFor(options, target, mcpServers);
  const rendered = templateFor(input);
  const file = targetPath(options, target);
  const existingRaw = fs2.existsSync(file) ? fs2.readFileSync(file, "utf8") : void 0;
  return compare(options, target, input, rendered, existingRaw);
}
function parseKeep(selectors) {
  const keep = {
    tools: /* @__PURE__ */ new Set(),
    keys: /* @__PURE__ */ new Set(),
    sections: /* @__PURE__ */ new Set(),
    preamble: false
  };
  for (const selector of selectors) {
    if (selector === "preamble") {
      keep.preamble = true;
      continue;
    }
    const at = selector.indexOf(":");
    const kind = at === -1 ? selector : selector.slice(0, at);
    const value = at === -1 ? "" : selector.slice(at + 1);
    if (value === "")
      throw new Error(`keep: must be <kind>:<value>: ${selector}`);
    switch (kind) {
      case "tools":
        keep.tools.add(value);
        break;
      case "key":
        keep.keys.add(value);
        break;
      case "section":
        keep.sections.add(value);
        break;
      default:
        throw new Error(`keep: unknown selector kind: ${selector}`);
    }
  }
  return keep;
}
function render(document) {
  const head = ["---"];
  for (const key of document.order) {
    head.push(`${key}: ${document.meta.get(key) ?? ""}`);
  }
  head.push("---", "");
  const body = [];
  if (document.preamble !== "") body.push(document.preamble, "");
  for (const [heading, content] of document.sections) {
    body.push(heading, "");
    if (content !== "") body.push(content, "");
  }
  return `${[...head, ...body].join("\n").trimEnd()}
`;
}
function merge(existingRaw, renderedRaw, keep) {
  const existing = parseDocument(existingRaw);
  const merged = parseDocument(renderedRaw);
  const missing = [];
  for (const heading of keep.sections) {
    if (!existing.sections.has(heading)) missing.push(`section:${heading}`);
  }
  const existingTools = splitTools(existing.meta.get("tools"));
  for (const tool of keep.tools) {
    if (!existingTools.includes(tool)) missing.push(`tools:${tool}`);
  }
  for (const key of keep.keys) {
    if (!existing.meta.has(key)) missing.push(`key:${key}`);
  }
  if (missing.length > 0) {
    throw new Error(`keep: not found in existing file: ${missing.join(", ")}`);
  }
  const tools = splitTools(merged.meta.get("tools"));
  for (const tool of existingTools) {
    if (keep.tools.has(tool) && !tools.includes(tool)) tools.push(tool);
  }
  merged.meta.set("tools", tools.join(", "));
  for (const key of keep.keys) {
    const value = existing.meta.get(key);
    if (value === void 0) continue;
    if (!merged.order.includes(key)) merged.order.push(key);
    merged.meta.set(key, value);
  }
  if (keep.preamble && existing.preamble !== "") {
    merged.preamble = existing.preamble;
  }
  for (const heading of keep.sections) {
    const content = existing.sections.get(heading);
    if (content === void 0) continue;
    merged.sections.set(heading, content);
  }
  return render(merged);
}
function automaticKeep(difference) {
  return [
    ...difference.frontmatter.toolsOnlyInExisting.filter((tool) => !tool.startsWith("mcp__")).map((tool) => `tools:${tool}`),
    ...difference.frontmatter.keysOnlyInExisting.filter((key) => key !== "disallowedTools").map((key) => `key:${key}`),
    ...difference.body.sectionsOnlyInExisting.map(
      (heading) => `section:${heading}`
    )
  ];
}
function unique(selectors) {
  return [...new Set(selectors)];
}
function discarded(difference, keep) {
  if (!difference.exists) {
    return { frontmatterKeys: [], preamble: false, sections: [] };
  }
  return {
    frontmatterKeys: difference.frontmatter.changed.map((entry) => entry.key).filter((key) => !keep.keys.has(key)),
    preamble: difference.preambleChanged && !keep.preamble,
    sections: difference.body.sectionsChanged.filter(
      (heading) => !keep.sections.has(heading)
    )
  };
}
function needsReview(selectors) {
  return selectors.filter(
    (selector) => selector.startsWith("tools:mcp__") || selector === "section:## \u30C4\u30FC\u30EB\u904B\u7528"
  );
}
function write(options, target, mcpServers) {
  const file = targetPath(options, target);
  const input = composeInputFor(options, target, mcpServers);
  const rendered = templateFor(input);
  const exists = fs2.existsSync(file);
  const existingRaw = exists ? fs2.readFileSync(file, "utf8") : void 0;
  const difference = compare(options, target, input, rendered, existingRaw);
  const selectors = unique([
    ...exists && options.merge ? automaticKeep(difference) : [],
    ...options.keep
  ]);
  const keep = parseKeep(selectors);
  const shouldMerge = existingRaw !== void 0 && (options.merge || options.keep.length > 0);
  const content = shouldMerge ? merge(existingRaw, rendered, keep) : rendered;
  const kept = shouldMerge ? selectors : [];
  fs2.mkdirSync(path2.dirname(file), { recursive: true });
  fs2.writeFileSync(file, content);
  return {
    ok: true,
    target: path2.relative(options.dir, file).split(path2.sep).join("/"),
    action: exists ? options.merge ? "merged" : "overwritten" : "written",
    kept,
    keptNeedsReview: needsReview(kept),
    discarded: discarded(difference, shouldMerge ? keep : parseKeep([])),
    roles: difference.roles
  };
}
function resolveMcp(options) {
  if (options.mcpServers.length === 0) return { servers: [], dropped: [] };
  const usable = new Set(
    listMcpServers(process.env).filter((server) => server.usable).map((server) => toolPrefix(server.name))
  );
  const servers = [];
  const dropped = [];
  for (const name of options.mcpServers) {
    const prefixed = toolPrefix(name);
    if (usable.has(prefixed)) servers.push(prefixed);
    else dropped.push(name);
  }
  return { servers, dropped };
}
function mcpCurrentFor(file) {
  if (!fs2.existsSync(file)) return { servers: [], denyTools: [] };
  return mcpCurrentOf(fs2.readFileSync(file, "utf8"));
}
function setup(options) {
  const policy = requirePolicy(options);
  validateFragments(options);
  const targets = targetsFor(options, policy);
  const mcp = resolveMcp(options);
  const results = targets.map((target) => {
    const current = mcpCurrentFor(targetPath(options, target));
    const result = options.write ? write(options, target, mcp.servers) : diff(options, target, mcp.servers);
    return {
      ...result,
      modelId: target.modelId,
      mcpCurrent: current,
      mcpDropped: mcp.dropped
    };
  });
  return { ok: true, results };
}
function listPolicies(env) {
  return {
    ok: true,
    injected: policyForInjection(env.AMATSUKA_AGENT_AUTO_INJECTION) ?? null,
    policies: POLICIES.map(({ id, label, injection }) => ({
      id,
      label,
      injection
    }))
  };
}
function listModels(options) {
  const policy = requirePolicy(options);
  return {
    ok: true,
    policy,
    models: modelsFor(policy).map((spec) => ({
      id: spec.id,
      label: spec.label,
      defaultName: defaultAgentName(options, policy, spec),
      model: resolveModelValue(spec, process.env),
      vendor: spec.vendor,
      color: spec.color,
      roles: rolesFor(policy, spec.id)
    }))
  };
}
function listMcp() {
  return { ok: true, servers: listMcpServers(process.env) };
}
function listAvailableRoles(options) {
  const policy = requirePolicy(options);
  const model = requireModel(options, policy);
  const allowed = new Set(rolesFor(policy, model.id));
  const dirs = fragmentDirsFor(
    pluginRoot(),
    options.dir,
    options.lang
  );
  const fragments = loadFragments(dirs, model.vendor);
  const ownDir = dirs.at(-1)?.path;
  const roles = [...fragments.values()].filter(
    (fragment) => allowed.has(fragment.id) || roleById(fragment.id) === void 0
  ).sort(
    (left, right) => roleOrder(left.id) - roleOrder(right.id) || left.id.localeCompare(right.id)
  ).map((fragment) => ({
    id: fragment.id,
    label: fragment.label,
    kind: fragment.kind,
    tools: fragment.tools,
    source: fragment.source,
    languageMismatch: options.lang !== "ja" && fragment.source === "project" && ownDir !== void 0 && fs2.existsSync(path2.join(ownDir, `${fragment.id}.md`))
  }));
  return { ok: true, policy, modelId: model.id, lang: options.lang, roles };
}
function coveredDefinitions(projectDir, roleIds) {
  const covered = new Map(
    roleIds.map((roleId) => [roleId, []])
  );
  const agentsDir = path2.join(projectDir, ".claude", "agents");
  if (!fs2.existsSync(agentsDir)) return covered;
  for (const file of fs2.readdirSync(agentsDir).sort()) {
    if (!file.endsWith(".md")) continue;
    try {
      const document = parseDocument(
        fs2.readFileSync(path2.join(agentsDir, file), "utf8")
      );
      const marker = document.meta.get("agent-policy-role");
      if (marker === void 0) continue;
      const name = document.meta.get("name") ?? file.replace(/\.md$/, "");
      for (const roleId of splitList(marker)) {
        covered.get(roleId)?.push(name);
      }
    } catch {
    }
  }
  return covered;
}
function bundledDefaultNames(projectDir) {
  const fragments = loadFragments(
    fragmentDirsFor(pluginRoot(), projectDir, "en").filter(
      (dir) => dir.source === "plugin"
    ),
    "claude"
  );
  const names = /* @__PURE__ */ new Map();
  for (const [id, fragment] of fragments) {
    if (fragment.defaultName !== void 0) {
      names.set(id, fragment.defaultName);
    }
  }
  return names;
}
function listCoverage(options) {
  const policy = requirePolicy(options);
  const roleIds = sortRoleIds(Object.keys(ASSIGNMENTS[policy]));
  const fragments = loadFragments(
    fragmentDirsFor(pluginRoot(), options.dir, options.lang),
    "claude"
  );
  const covered = coveredDefinitions(options.dir, roleIds);
  const fallbackNames = options.lang === "en" ? void 0 : roleIds.some((id) => fragments.get(id)?.defaultName === void 0) ? bundledDefaultNames(options.dir) : void 0;
  const roles = roleIds.map((id) => {
    const fragment = fragments.get(id);
    if (fragment === void 0) {
      throw new Error(`Role fragment not found: ${id}`);
    }
    return {
      id,
      label: fragment.label,
      defaultName: fragment.defaultName ?? fallbackNames?.get(id),
      models: ASSIGNMENTS[policy][id],
      coveredBy: covered.get(id) ?? []
    };
  });
  return {
    ok: true,
    policy,
    roles,
    uncovered: roles.filter((role) => role.coveredBy.length === 0).map((role) => role.id)
  };
}
function parseArgs(argv) {
  const options = {
    policy: "",
    modelId: "",
    models: [],
    name: "",
    model: "",
    roles: [],
    dir: process.cwd(),
    lang: "ja",
    mcpServers: [],
    mcpDeny: [],
    check: false,
    write: false,
    merge: false,
    listPolicies: false,
    listModels: false,
    listRoles: false,
    listCoverage: false,
    listMcp: false,
    checkFragments: false,
    scaffoldFragments: false,
    keep: []
  };
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    const value = argv[index + 1];
    switch (arg) {
      case "--policy":
        options.policy = requireValue(value, "policy");
        index += 1;
        break;
      case "--model-id":
        options.modelId = requireValue(value, "model-id");
        index += 1;
        break;
      case "--models":
        options.models = splitList(requireValue(value, "models"));
        index += 1;
        break;
      case "--name":
        options.name = requireValue(value, "name");
        index += 1;
        break;
      case "--model":
        options.model = requireValue(value, "model");
        index += 1;
        break;
      case "--roles":
        options.roles = splitList(requireValue(value, "roles"));
        index += 1;
        break;
      case "--dir":
        options.dir = path2.resolve(requireValue(value, "dir"));
        index += 1;
        break;
      case "--lang":
        options.lang = requireValue(value, "lang");
        index += 1;
        break;
      case "--mcp-servers":
        options.mcpServers = splitList(requireValue(value, "mcp-servers"));
        index += 1;
        break;
      case "--mcp-deny":
        options.mcpDeny = splitList(requireValue(value, "mcp-deny"));
        index += 1;
        break;
      case "--check":
        options.check = true;
        break;
      case "--write":
        options.write = true;
        break;
      case "--merge":
        options.merge = true;
        break;
      case "--list-policies":
        options.listPolicies = true;
        break;
      case "--list-models":
        options.listModels = true;
        break;
      case "--list-roles":
        options.listRoles = true;
        break;
      case "--list-coverage":
        options.listCoverage = true;
        break;
      case "--list-mcp":
        options.listMcp = true;
        break;
      case "--check-fragments":
        options.checkFragments = true;
        break;
      case "--scaffold-fragments":
        options.scaffoldFragments = true;
        break;
      case "--keep":
        options.keep.push(requireValue(value, "keep"));
        index += 1;
        break;
      default:
        throw new Error(`Unsupported option: ${arg}`);
    }
  }
  if (options.name !== "" && !/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(options.name)) {
    throw new Error("name: must be lowercase letters, digits and hyphens");
  }
  if (options.listPolicies || options.listModels || options.listRoles || options.listCoverage || options.listMcp || options.checkFragments || options.scaffoldFragments) {
    return options;
  }
  if (options.merge && !options.write)
    throw new Error("merge: requires --write");
  if (options.models.length > 0) {
    if (options.policy === "") throw new Error("policy: is required");
    if (options.keep.length > 0) {
      throw new Error("keep: cannot be used with --models");
    }
    return options;
  }
  if (options.name === "") throw new Error("name: is required");
  if (options.modelId === "") throw new Error("model-id: is required");
  if (options.roles.length === 0) throw new Error("roles: is required");
  return options;
}
function splitList(value) {
  return [
    ...new Set(
      value.split(",").map((entry) => entry.trim()).filter((entry) => entry !== "")
    )
  ];
}
function requireValue(value, field) {
  if (value === void 0 || value.startsWith("--")) {
    throw new Error(`${field}: is required`);
  }
  return value;
}
function respond(value) {
  process.stdout.write(`${JSON.stringify(value)}
`);
}
try {
  const options = parseArgs(process.argv.slice(2));
  if (options.listPolicies) {
    respond(listPolicies(process.env));
  } else if (options.listModels) {
    respond(listModels(options));
  } else if (options.listCoverage) {
    respond(listCoverage(options));
  } else if (options.listMcp) {
    respond(listMcp());
  } else if (options.checkFragments) {
    respond({
      ok: true,
      ...checkFragments(pluginRoot(), options.dir, options.lang)
    });
  } else if (options.scaffoldFragments) {
    const written = scaffoldFragments(pluginRoot(), options.dir, options.lang);
    respond({
      ok: true,
      lang: options.lang,
      written: written.map(
        (file) => path2.relative(options.dir, file).split(path2.sep).join("/")
      )
    });
  } else if (options.listRoles) {
    respond(listAvailableRoles(options));
  } else {
    respond(setup(options));
  }
} catch (error) {
  respond({
    ok: false,
    error: error instanceof Error ? error.message : "Unexpected error",
    results: []
  });
  process.exitCode = 1;
}
