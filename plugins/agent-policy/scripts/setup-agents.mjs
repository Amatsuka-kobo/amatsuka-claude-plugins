// src/setup-agents.ts
import fs3 from "node:fs";
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
  return textHash(body.join("\n"));
}
function textHash(text) {
  return crypto.createHash("sha256").update(text.trim()).digest("hex").slice(0, 16);
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
    id: "explore",
    label: "\u30B3\u30FC\u30C9\u30D9\u30FC\u30B9\u63A2\u7D22",
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
    id: "design-review",
    label: "\u8A2D\u8A08\u66F8\u30FB\u5B9F\u88C5\u8A08\u753B\u66F8\u306E\u30EC\u30D3\u30E5\u30FC",
    kind: "readonly",
    tools: ["Read", "Grep", "Glob", "Bash"]
  },
  {
    id: "knowledge-elicitation",
    label: "\u6697\u9ED9\u77E5\u306E\u62BD\u51FA\u30FB\u7406\u89E3\u30EC\u30D3\u30E5\u30FC",
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
    id: "complex-review",
    label: "\u91CD\u8981\u306A\u5B9F\u88C5\u30FB\u9AD8\u30EA\u30B9\u30AF\u8A2D\u8A08\u66F8\u306E\u6700\u7D42\u30EC\u30D3\u30E5\u30FC",
    kind: "readonly",
    tools: ["Read", "Grep", "Glob", "Bash"]
  },
  {
    id: "adversarial-review",
    label: "\u6575\u5BFE\u7684\u30EC\u30D3\u30E5\u30FC",
    kind: "readonly",
    tools: ["Read", "Grep", "Glob", "Bash"]
  }
];
var RETIRED_ROLE_REPLACEMENTS = {
  "final-review": "complex-review",
  "gate-review": "complex-review",
  "design-plan": null,
  advisor: null
};
function isRetiredRole(id) {
  return Object.hasOwn(RETIRED_ROLE_REPLACEMENTS, id);
}
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
function hasMixedKinds(kinds) {
  const unique2 = new Set(kinds);
  return unique2.has("impl") && unique2.has("readonly");
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
      if (isRetiredRole(name.replace(/\.md$/, ""))) continue;
      const fragment = readFragment(path.join(dir.path, name), dir.source);
      if (isRetiredRole(fragment.id)) continue;
      fragments.set(fragment.id, fragment);
    }
  }
  if (vendor !== void 0) {
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

// src/agents/vocabulary.ts
var JA = {
  bodyOrder: ["## When to invoke", "## Core Responsibilities", "## \u4F5C\u696D\u624B\u9806"],
  constraintHeading: "## \u5236\u7D04",
  outputFormatHeading: "## Output Format",
  listSeparator: "\u3001",
  quote: (value) => `\u300C${value}\u300D`,
  describe: (roles) => `Use this agent when ${roles}\u3092\u59D4\u8B72\u3059\u308B\u3068\u304D\u3002\u8A73\u7D30\u306F\u672C\u6587\u306E\u300CWhen to invoke\u300D\u3092\u53C2\u7167\u3002`
};
var EN = {
  bodyOrder: ["## When to invoke", "## Core Responsibilities", "## Procedure"],
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
  claude: "blue",
  none: "blue"
};
function compose(input) {
  const vocabulary = vocabularyFor(input.lang);
  const common = loadCommon(input.fragmentDirs);
  const { ids: ordered, selected } = selectFragments(input);
  const tools = resolveToolsFor(selected, input.mcpServers ?? []);
  const denyTools = input.denyTools ?? [];
  const description = describe(selected, vocabulary);
  const head = [
    "---",
    `name: ${input.name}`,
    `description: ${description}`,
    `model: ${input.model}`,
    ...input.effort === void 0 ? [] : [`effort: ${input.effort}`],
    `color: ${input.color ?? COLORS[input.vendor]}`,
    `tools: ${tools.join(", ")}`,
    ...denyTools.length > 0 ? [`disallowedTools: ${denyTools.join(", ")}`] : [],
    `agent-policy-role: ${ordered.join(", ")}`,
    ...input.vendor === "none" ? [] : [`agent-policy-vendor: ${input.vendor}`],
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
  const constraints = [
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
  const bodyText = body.join("\n").replace(/\n{3,}/g, "\n\n");
  head.splice(
    head.length - 2,
    0,
    `${DESCRIPTION_HASH_KEY}: ${textHash(description)}`,
    `${PREAMBLE_HASH_KEY}: ${textHash(preambleOf(bodyText))}`
  );
  return `${[...head, bodyText].join("\n").replace(/\n{3,}/g, "\n\n").trimEnd()}
`;
}
var DESCRIPTION_HASH_KEY = "agent-policy-description-hash";
var PREAMBLE_HASH_KEY = "agent-policy-preamble-hash";
function preambleOf(body) {
  const lines = body.split("\n");
  const heading = lines.findIndex((line) => line.startsWith("## "));
  return (heading === -1 ? lines : lines.slice(0, heading)).join("\n").trim();
}
function describeRoles(input) {
  const { ids, selected } = selectFragments(input);
  const implRoles = selected.filter((fragment) => fragment.kind === "impl").map((fragment) => fragment.id);
  const readonlyRoles = selected.filter((fragment) => fragment.kind === "readonly").map((fragment) => fragment.id);
  return {
    ids,
    implRoles,
    readonlyRoles,
    mixedKinds: hasMixedKinds(selected.map((fragment) => fragment.kind))
  };
}
function selectFragments(input) {
  const vendor = input.vendor === "none" ? void 0 : input.vendor;
  const fragments = loadFragments(input.fragmentDirs, vendor);
  const ids = sortRoleIds(input.roleIds);
  const selected = ids.map((id) => {
    const fragment = fragments.get(id);
    if (fragment === void 0) throw new Error(`Unknown role id: ${id}`);
    return fragment;
  });
  return { ids, selected };
}
function resolveToolsFor(selected, mcpServers) {
  const tools = [];
  for (const fragment of selected) {
    for (const tool of fragment.tools) {
      if (tool !== "Agent" && !tools.includes(tool)) tools.push(tool);
    }
  }
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
var EFFORT_ORDER = [
  "low",
  "medium",
  "high",
  "xhigh",
  "max"
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
    model: "claude-gpt-6-1-sol",
    color: "yellow"
  },
  {
    id: "gpt-terra",
    vendor: "gpt",
    label: "GPT Terra",
    defaultName: "gpt-terra",
    model: "claude-gpt-5-6-terra",
    color: "green"
  },
  {
    id: "gpt-luna",
    vendor: "gpt",
    label: "GPT Luna",
    defaultName: "gpt-luna",
    model: "claude-gpt-6-luna",
    color: "cyan"
  },
  {
    id: "gpt-astra",
    vendor: "gpt",
    label: "GPT Astra",
    defaultName: "gpt-astra",
    model: "claude-gpt-6-astra",
    color: "yellow"
  },
  {
    id: "grok",
    vendor: "grok",
    label: "Grok",
    defaultName: "grok",
    model: "claude-grok-4-7",
    color: "red"
  }
];
var ASSIGNMENTS = {
  "claude-model-policy": {
    "complex-impl": ["opus"],
    "normal-impl": ["sonnet"],
    "light-impl": ["haiku"],
    escalation: ["fable"],
    general: ["sonnet"],
    explore: ["sonnet"],
    "realtime-research": ["sonnet"],
    "e2e-verify": ["sonnet"],
    "design-review": ["opus"],
    "knowledge-elicitation": ["haiku"],
    "code-review": ["sonnet"],
    "complex-review": ["fable"],
    "adversarial-review": ["opus"]
  }
};
var RECOMMENDED = {
  "complex-impl": ["gpt-sol", "opus"],
  "normal-impl": ["gpt-sol", "sonnet", "grok"],
  "light-impl": ["gpt-luna", "haiku", "grok"],
  escalation: ["gpt-astra", "fable"],
  general: ["gpt-luna", "sonnet"],
  explore: ["gpt-sol", "sonnet"],
  "realtime-research": ["grok", "sonnet"],
  "e2e-verify": ["gpt-sol", "sonnet"],
  "design-review": ["gpt-sol", "opus"],
  "knowledge-elicitation": ["haiku", "gpt-luna"],
  "code-review": ["gpt-sol", "sonnet"],
  "complex-review": ["gpt-astra", "fable"],
  "adversarial-review": ["opus", "gpt-sol"]
};
var EFFORT = {
  escalation: { fable: "high", "gpt-astra": "high" },
  "complex-impl": { opus: "medium", "gpt-sol": "high" },
  "normal-impl": { sonnet: "medium", "gpt-sol": "medium", grok: "high" },
  "light-impl": { haiku: "medium", "gpt-luna": "low", grok: "medium" },
  general: { sonnet: "medium", "gpt-luna": "medium" },
  explore: { sonnet: "high", "gpt-sol": "medium" },
  "realtime-research": { grok: "high", sonnet: "high" },
  "e2e-verify": { sonnet: "high", "gpt-sol": "medium" },
  "design-review": { opus: "high", "gpt-sol": "high" },
  "knowledge-elicitation": { haiku: "low", "gpt-luna": "low" },
  "code-review": { sonnet: "high", "gpt-sol": "high" },
  "complex-review": { "gpt-astra": "high", fable: "high" },
  "adversarial-review": { opus: "high", "gpt-sol": "high" }
};
function effortFor(roleIds, modelId) {
  let highest;
  for (const roleId of roleIds) {
    const effort = EFFORT[roleId]?.[modelId];
    if (effort !== void 0 && (highest === void 0 || EFFORT_ORDER.indexOf(effort) > EFFORT_ORDER.indexOf(highest))) {
      highest = effort;
    }
  }
  return highest;
}
function modelById(id) {
  return MODELS.find((model) => model.id === id);
}
function modelIdForAlias(alias) {
  const lower = alias.toLowerCase();
  if (!lower.startsWith("claude-")) return void 0;
  const tokens = lower.split(/[-._]/);
  return MODELS.find((spec) => {
    if (spec.vendor === "claude" || !lower.includes(spec.vendor)) return false;
    const family = spec.id.slice(spec.vendor.length + 1);
    return family === "" || tokens.includes(family);
  })?.id;
}
function rankAliases(modelId, aliases) {
  const preset = modelById(modelId)?.model;
  return aliases.filter((alias) => modelIdForAlias(alias) === modelId).sort(
    (a, b) => Number(b === preset) - Number(a === preset) || a.length - b.length || (a < b ? -1 : a > b ? 1 : 0)
  );
}
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
import fs2 from "node:fs";
function frontmatter(file) {
  const lines = fs2.readFileSync(file, "utf8").split("\n");
  const meta = /* @__PURE__ */ new Map();
  if (lines[0]?.trim() !== "---") return meta;
  const close = lines.indexOf("---", 1);
  if (close === -1) return meta;
  const metadataLines = lines.slice(1, close);
  let skipUntil = 0;
  for (const [index, line] of metadataLines.entries()) {
    if (index < skipUntil) continue;
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
    if (key === "description" && /^[>|][+-]?$/.test(value)) {
      const folded = [];
      for (const candidate of metadataLines.slice(index + 1)) {
        if (!/^\s/.test(candidate)) break;
        if (candidate.trim() !== "") folded.push(candidate.trim());
      }
      skipUntil = index + 1 + folded.length;
      meta.set(key, folded.join(" "));
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

// src/setup-agents.ts
var VENDOR_COLORS = {
  gpt: "yellow",
  grok: "red",
  claude: "blue",
  none: "blue"
};
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
function requireModel(options) {
  const spec = modelById(options.modelId);
  if (spec === void 0) throw new Error("model-id: is unknown");
  return spec;
}
function recommendedForAlias(model) {
  const modelId = modelIdOf(model);
  if (modelId === null) return [];
  return sortRoleIds(
    Object.entries(RECOMMENDED).filter(([, recommended]) => recommended.includes(modelId)).map(([role]) => role)
  );
}
function validateRoles(options, model) {
  const fragments = loadFragments(
    fragmentDirsFor(pluginRoot(), options.dir, options.lang)
  );
  const invalid = options.roles.filter((role) => !fragments.has(role));
  if (invalid.length > 0) {
    throw new Error(`roles: ${invalid.join(", ")} is unknown`);
  }
  return options.roles.flatMap((role) => {
    if (roleById(role) === void 0 || RECOMMENDED[role].includes(model.id)) {
      return [];
    }
    return [`roles: ${role} is not recommended for ${model.id}`];
  });
}
function validateFragments(options) {
  const status = checkFragments(pluginRoot(), options.dir, options.lang);
  if (status.missing.length === 0 && status.stale.length === 0) return;
  throw new Error(
    `fragments: translation for "${options.lang}" is incomplete. missing=${status.missing.join(", ")} stale=${status.stale.map((entry) => entry.id).join(", ")}. Run --scaffold-fragments and translate them first`
  );
}
function defaultAgentName(options, spec, role) {
  const fragments = loadFragments(
    fragmentDirsFor(pluginRoot(), options.dir, options.lang),
    spec.vendor
  );
  const defaultName = fragments.get(role)?.defaultName ?? bundledDefaultNames(options.dir).get(role);
  return defaultName === void 0 ? spec.id : `${spec.id}-${defaultName}`;
}
function isClaudeEnum(model) {
  return CLAUDE_ENUM_MODELS.includes(model);
}
function unavailableWarning(live) {
  return `live models unavailable (${live.reason ?? "unknown"}); model existence was not validated`;
}
function resolveVendor(options, model, spec, live) {
  if (options.vendor !== "") return options.vendor;
  if (isClaudeEnum(model)) return "claude";
  if (!live.ok) return spec.vendor;
  const vendor = liveVendorOf(model, live);
  if (vendor === "unknown") {
    throw new Error(
      `vendor: could not infer vendor for model "${model}"; pass --vendor gpt|grok|claude|none`
    );
  }
  return vendor;
}
function liveVendorOf(model, live) {
  const vendor = live.vendors[model] ?? "unknown";
  if (vendor !== "unknown") return vendor;
  const modelId = modelIdForAlias(model);
  return modelId === void 0 ? "unknown" : modelById(modelId)?.vendor ?? "unknown";
}
function modelIsAvailable(model, live) {
  return isClaudeEnum(model) || live.ids.includes(model);
}
function liveAliasesOf(spec, live) {
  if (!live.ok || isClaudeEnum(spec.model)) return [spec.model];
  return rankAliases(spec.id, live.ids);
}
function aliasWarnings(modelId, aliases) {
  const [chosen, ...rest] = aliases;
  if (chosen === void 0 || rest.length === 0) return [];
  return [
    `model: ${modelId} matches several live aliases; using ${chosen}, not ${rest.join(", ")}`
  ];
}
function recommendedTarget(options, live, role, warnings) {
  const candidates = options.scope === "claude-only" ? ASSIGNMENTS["claude-model-policy"][role] : RECOMMENDED[role];
  for (const id of candidates) {
    const spec = modelById(id);
    if (spec === void 0) continue;
    const aliases = liveAliasesOf(spec, live);
    const model = aliases[0];
    if (model === void 0) continue;
    warnings.push(...aliasWarnings(spec.id, aliases));
    return {
      roleId: role,
      modelId: spec.id,
      name: defaultAgentName(options, spec, role),
      model,
      roles: [role],
      color: VENDOR_COLORS[spec.vendor],
      vendor: spec.vendor
    };
  }
  throw new Error(`roles: no available model for ${role}`);
}
function targetsFor(options, live) {
  const warnings = live.ok ? [] : [unavailableWarning(live)];
  if (options.recommended) {
    const roles = sortRoleIds(
      options.roles.length > 0 ? options.roles : ROLES.map((role) => role.id)
    );
    const definitions = scopedDefinitions(options.dir, options.scope);
    const fragments = loadFragments(
      fragmentDirsFor(pluginRoot(), options.dir, options.lang)
    );
    const visited = /* @__PURE__ */ new Set();
    const targets = [];
    for (const role of roles) {
      if (roleById(role) === void 0)
        throw new Error(
          `roles: ${role} is not a built-in role for --recommended`
        );
      const covering = definitions.filter(
        (definition) => definition.markerIds.includes(role)
      );
      if (covering.length === 1 && covering[0] !== void 0) {
        if (visited.has(covering[0].file)) continue;
        visited.add(covering[0].file);
      }
      const target = coveringTarget(role, covering, fragments, live, warnings);
      if (target !== void 0) {
        targets.push(target ?? recommendedTarget(options, live, role, warnings));
      }
    }
    return { warnings, targets };
  }
  const spec = requireModel(options);
  if (options.scope === "claude-only" && spec.vendor !== "claude") {
    throw new Error(
      `model-id: ${options.modelId} is not available with --scope claude`
    );
  }
  if (options.scope === "claude-only" && options.model !== "" && !isClaudeEnum(options.model)) {
    throw new Error(
      `model: ${options.model} is not available with --scope claude`
    );
  }
  let model = options.model;
  if (model === "") {
    const aliases = liveAliasesOf(spec, live);
    model = aliases[0] ?? spec.model;
    warnings.push(...aliasWarnings(spec.id, aliases));
  }
  if (options.write && live.ok && !modelIsAvailable(model, live)) {
    throw new Error(
      `model: ${model} is not a Claude enum and was not found in live models`
    );
  }
  warnings.push(...validateRoles(options, spec));
  const vendor = resolveVendor(options, model, spec, live);
  return {
    warnings: [...new Set(warnings)],
    targets: [
      {
        modelId: spec.id,
        name: options.name,
        model,
        roles: options.roles,
        color: VENDOR_COLORS[vendor],
        vendor
      }
    ]
  };
}
function composeInputFor(options, target, mcpServers) {
  return {
    name: target.name,
    model: target.model,
    vendor: target.vendor,
    roleIds: target.roles,
    fragmentDirs: fragmentDirsFor(pluginRoot(), options.dir, options.lang),
    lang: options.lang,
    effort: effortFor(target.roles, target.modelId),
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
      roles,
      description: null,
      preamble: null,
      preambleTexts: null
    };
  }
  const existing = parseDocument(existingRaw);
  const expected = parseDocument(rendered);
  const descriptionState = textState(
    existing.meta.get("description") ?? "",
    expected.meta.get("description") ?? "",
    existing.meta.get(DESCRIPTION_HASH_KEY)
  );
  const preambleState = textState(
    existing.preamble,
    expected.preamble,
    existing.meta.get(PREAMBLE_HASH_KEY)
  );
  const existingTools = splitTools(existing.meta.get("tools"));
  const expectedTools = splitTools(expected.meta.get("tools"));
  const changed = [];
  for (const [key, value] of expected.meta) {
    if (key === "tools" || RECORD_KEYS.includes(key)) continue;
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
    roles,
    description: descriptionState,
    preamble: preambleState,
    // description の両方の値は frontmatter.changed に載る。前置きはここで返す。
    preambleTexts: preambleState === "same" ? null : { existing: existing.preamble, template: expected.preamble }
  };
}
var RECORD_KEYS = [DESCRIPTION_HASH_KEY, PREAMBLE_HASH_KEY];
function textState(existing, template, record) {
  if (existing.trim() === template.trim()) return "same";
  if (record === void 0) return "unknown";
  return textHash(existing) === record ? "templateChanged" : "userEdited";
}
function diff(options, target, mcpServers) {
  const input = composeInputFor(options, target, mcpServers);
  const rendered = templateFor(input);
  const file = targetPath(options, target);
  const existingRaw = fs3.existsSync(file) ? fs3.readFileSync(file, "utf8") : void 0;
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
var RETAIN_NONE = { description: false, preamble: false };
function retainText(existing, merged, recordKey) {
  const record = existing.meta.get(recordKey);
  if (record === void 0) {
    merged.meta.delete(recordKey);
    merged.order = merged.order.filter((key) => key !== recordKey);
  } else {
    merged.meta.set(recordKey, record);
  }
}
function merge(existingRaw, renderedRaw, keep, retain = RETAIN_NONE) {
  const existing = parseDocument(existingRaw);
  const merged = parseDocument(renderedRaw);
  if (retain.description) {
    merged.meta.set("description", existing.meta.get("description") ?? "");
    retainText(existing, merged, DESCRIPTION_HASH_KEY);
  }
  if (retain.preamble) {
    merged.preamble = existing.preamble;
    retainText(existing, merged, PREAMBLE_HASH_KEY);
  }
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
function discarded(difference, keep, retain) {
  if (!difference.exists) {
    return { frontmatterKeys: [], preamble: false, sections: [] };
  }
  return {
    frontmatterKeys: difference.frontmatter.changed.map((entry) => entry.key).filter(
      (key) => !keep.keys.has(key) && !(key === "description" && retain.description)
    ),
    preamble: difference.preambleChanged && !keep.preamble && !retain.preamble,
    sections: difference.body.sectionsChanged.filter(
      (heading) => !keep.sections.has(heading)
    )
  };
}
function needsReview(selectors) {
  return selectors.filter((selector) => selector.startsWith("tools:mcp__"));
}
function write(options, target, mcpServers) {
  const file = targetPath(options, target);
  const input = composeInputFor(options, target, mcpServers);
  const rendered = templateFor(input);
  const exists = fs3.existsSync(file);
  const existingRaw = exists ? fs3.readFileSync(file, "utf8") : void 0;
  const difference = compare(options, target, input, rendered, existingRaw);
  const selectors = unique([
    ...exists && options.merge ? automaticKeep(difference) : [],
    ...options.keep
  ]);
  const keep = parseKeep(selectors);
  const shouldMerge = existingRaw !== void 0 && (options.merge || options.keep.length > 0);
  const retain = shouldMerge ? retainFor(options, difference, keep) : RETAIN_NONE;
  const content = shouldMerge ? merge(existingRaw, rendered, keep, retain) : rendered;
  const kept = shouldMerge ? selectors : [];
  fs3.mkdirSync(path2.dirname(file), { recursive: true });
  fs3.writeFileSync(file, content);
  return {
    ok: true,
    target: path2.relative(options.dir, file).split(path2.sep).join("/"),
    action: exists ? options.merge ? "merged" : "overwritten" : "written",
    kept,
    keptNeedsReview: needsReview(kept),
    discarded: discarded(
      difference,
      shouldMerge ? keep : parseKeep([]),
      retain
    ),
    roles: difference.roles,
    description: difference.description,
    preamble: difference.preamble,
    preambleTexts: difference.preambleTexts,
    toolsBefore: existingRaw === void 0 ? [] : splitTools(parseDocument(existingRaw).meta.get("tools")),
    toolsAfter: splitTools(parseDocument(content).meta.get("tools"))
  };
}
function retainFor(options, difference, keep) {
  const replaceDescription = options.replace.includes("description");
  const replacePreamble = options.replace.includes("preamble");
  if (replaceDescription && keep.keys.has("description")) {
    throw new Error(
      "replace: description conflicts with --keep key:description"
    );
  }
  if (replacePreamble && keep.preamble) {
    throw new Error("replace: preamble conflicts with --keep preamble");
  }
  return {
    description: keep.keys.has("description") || options.merge && !replaceDescription && difference.description !== null && difference.description !== "same",
    preamble: keep.preamble || options.merge && !replacePreamble && difference.preamble !== null && difference.preamble !== "same"
  };
}
function resolveMcp(options) {
  if (options.mcpServers.length === 0) return { servers: [], dropped: [] };
  const usable = usableMcpPrefixes();
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
  if (!fs3.existsSync(file)) return { servers: [], denyTools: [] };
  return mcpCurrentOf(fs3.readFileSync(file, "utf8"));
}
function setup(options, live) {
  validateFragments(options);
  const resolution = targetsFor(options, live);
  const mcp = resolveMcp(options);
  const inherits = options.recommended && options.merge && options.mcpServers.length === 0;
  let usable;
  const results = resolution.targets.map((target) => {
    const file = targetPath(options, target);
    const current = mcpCurrentFor(file);
    let servers = mcp.servers;
    let dropped = mcp.dropped;
    let targetOptions = options;
    if (inherits && fs3.existsSync(file)) {
      usable ??= usableMcpPrefixes();
      const inherited = inheritMcp(fs3.readFileSync(file, "utf8"), usable);
      servers = inherited.servers;
      dropped = inherited.dropped;
      if (options.mcpDeny.length === 0) {
        targetOptions = { ...options, mcpDeny: current.denyTools };
      }
    }
    const result = options.write ? write(targetOptions, target, servers) : diff(targetOptions, target, servers);
    return {
      ...result,
      modelId: target.modelId,
      ...target.roleId === void 0 ? {} : { roleId: target.roleId },
      mcpCurrent: current,
      mcpDropped: dropped
    };
  });
  return {
    ok: true,
    results,
    warnings: resolution.warnings
  };
}
function usableMcpPrefixes() {
  return new Set(
    listMcpServers(process.env).filter((server) => server.usable).map((server) => toolPrefix(server.name))
  );
}
function inheritMcp(content, usable) {
  const entries = splitTools(parseDocument(content).meta.get("tools")).filter(
    (tool) => tool.startsWith("mcp__")
  );
  const servers = [];
  const dropped = [];
  for (const entry of entries) {
    const alive = [...usable].some(
      (prefix) => entry === prefix || entry.startsWith(`${prefix}__`)
    );
    if (alive) servers.push(entry);
    else dropped.push(entry.slice("mcp__".length));
  }
  return { servers, dropped };
}
function listLiveModels(live, scope) {
  const claudeEnums = [...CLAUDE_ENUM_MODELS];
  if (scope === "claude-only") {
    return {
      ok: true,
      models: [],
      claudeEnums
    };
  }
  if (!live.ok) {
    return {
      ok: false,
      reason: live.reason,
      models: [],
      claudeEnums
    };
  }
  return {
    ok: true,
    models: live.ids.map((id) => ({
      id,
      vendor: liveVendorOf(id, live),
      recommendedFor: recommendedForAlias(id)
    })),
    claudeEnums
  };
}
function listMcp() {
  return { ok: true, servers: listMcpServers(process.env) };
}
function listAvailableRoles(options) {
  const dirs = fragmentDirsFor(
    pluginRoot(),
    options.dir,
    options.lang
  );
  const fragments = loadFragments(dirs);
  const ownDir = dirs.at(-1)?.path;
  const roles = [...fragments.values()].sort(
    (left, right) => roleOrder(left.id) - roleOrder(right.id) || left.id.localeCompare(right.id)
  ).map((fragment) => ({
    id: fragment.id,
    label: fragment.label,
    kind: fragment.kind,
    tools: fragment.tools,
    source: fragment.source,
    languageMismatch: options.lang !== "ja" && fragment.source === "project" && ownDir !== void 0 && fs3.existsSync(path2.join(ownDir, `${fragment.id}.md`))
  }));
  return { ok: true, lang: options.lang, roles };
}
function coveredDefinitions(projectDir, roleIds, scope) {
  const covered = new Map(
    roleIds.map((roleId) => [roleId, []])
  );
  for (const definition of scopedDefinitions(projectDir, scope)) {
    for (const roleId of definition.markerIds) {
      covered.get(roleId)?.push(definition.name);
    }
  }
  return covered;
}
function scopedDefinitions(projectDir, scope) {
  const agentsDir = path2.join(projectDir, ".claude", "agents");
  if (!fs3.existsSync(agentsDir)) return [];
  const definitions = [];
  for (const file of fs3.readdirSync(agentsDir).sort()) {
    if (!file.endsWith(".md")) continue;
    try {
      const document = parseDocument(
        fs3.readFileSync(path2.join(agentsDir, file), "utf8")
      );
      const marker = document.meta.get("agent-policy-role");
      if (marker === void 0) continue;
      const model = document.meta.get("model");
      const vendor = document.meta.get("agent-policy-vendor");
      if (scope === "claude-only" && (!runsOnClaude(model) || vendor !== void 0 && vendor !== "claude" && vendor !== "none")) {
        continue;
      }
      const base = file.replace(/\.md$/, "");
      definitions.push({
        name: document.meta.get("name") ?? base,
        file: base,
        model,
        vendor,
        markerIds: splitList(marker)
      });
    } catch {
    }
  }
  return definitions;
}
function modelIdOf(model) {
  if (model === null || model === void 0) return null;
  return MODELS.find((spec) => spec.model === model)?.id ?? modelIdForAlias(model) ?? null;
}
function isVendor(value) {
  return value === "gpt" || value === "grok" || value === "claude" || value === "none";
}
function coveringTarget(role, covering, fragments, live, warnings) {
  if (covering.length === 0) return null;
  const [definition] = covering;
  if (covering.length > 1 || definition === void 0) {
    warnings.push(
      `roles: ${role} is covered by ${covering.map((entry) => entry.file).join(", ")}; not regenerated`
    );
    return void 0;
  }
  const unresolved = definition.markerIds.filter((id) => !fragments.has(id));
  if (unresolved.length > 0) {
    warnings.push(
      `roles: ${definition.file} declares retired or unknown role ids (${unresolved.join(", ")}); not regenerated`
    );
    return void 0;
  }
  const modelId = modelIdOf(definition.model);
  if (modelId === null || definition.model === void 0) {
    warnings.push(
      `model: ${definition.file} declares model "${definition.model ?? ""}" that matches no model id; not regenerated`
    );
    return void 0;
  }
  const vendor = definition.vendor ?? "none";
  if (!isVendor(vendor)) {
    warnings.push(
      `vendor: ${definition.file} declares unknown vendor "${vendor}"; not regenerated`
    );
    return void 0;
  }
  if (live.ok && !modelIsAvailable(definition.model, live)) {
    const others = rankAliases(modelId, live.ids);
    const hint = others.length > 0 ? ` (live aliases of ${modelId}: ${others.join(", ")})` : "";
    warnings.push(
      `model: ${definition.file} declares model "${definition.model}" that was not found in live models; not regenerated${hint}`
    );
    return void 0;
  }
  return {
    roleId: role,
    modelId,
    name: definition.file,
    model: definition.model,
    roles: definition.markerIds.filter((id) => fragments.has(id)),
    color: VENDOR_COLORS[vendor],
    vendor
  };
}
function bundledDefaultNames(projectDir) {
  const fragments = loadFragments(
    fragmentDirsFor(pluginRoot(), projectDir, "en").filter(
      (dir) => dir.source === "plugin"
    )
  );
  const names = /* @__PURE__ */ new Map();
  for (const [id, fragment] of fragments) {
    if (fragment.defaultName !== void 0) {
      names.set(id, fragment.defaultName);
    }
  }
  return names;
}
function toolsFormatOf(raw) {
  if (raw === void 0) return "none";
  if (Array.isArray(raw)) return "other";
  const value = raw.trim();
  if (value === "" || /^[[{|>]/.test(value) || /["'()#]/.test(value)) {
    return "other";
  }
  return "csv";
}
function keyLinesOf(lines, close, key) {
  const pattern = new RegExp(`^\\s*${key}\\s*:`);
  return lines.slice(1, Math.max(close, 1)).flatMap((line, index) => pattern.test(line) ? [index + 1] : []);
}
function keyLineAmbiguous(lines, close, key) {
  const found = keyLinesOf(lines, close, key);
  return found.length > 1 || /^\s/.test(lines[found[0] ?? -1] ?? "");
}
function disallowedToolsOf(tools, format, selected) {
  if (selected.length === 0) {
    return (tools ?? []).filter((tool) => tool === "Agent");
  }
  if (format === "none") return ["*"];
  const allowed = resolveToolsFor(selected, []);
  return (tools ?? []).filter(
    (tool) => !tool.startsWith("mcp__") && !allowed.includes(tool)
  );
}
function stringValue(value) {
  return typeof value === "string" && value !== "" ? value : null;
}
function inspectDefinitions(projectDir, fragments) {
  const agentsDir = path2.join(projectDir, ".claude", "agents");
  if (!fs3.existsSync(agentsDir)) return [];
  const definitions = [];
  for (const file of fs3.readdirSync(agentsDir).sort()) {
    if (!file.endsWith(".md")) continue;
    let meta;
    let lines;
    try {
      meta = frontmatter(path2.join(agentsDir, file));
      lines = fs3.readFileSync(path2.join(agentsDir, file), "utf8").split("\n");
    } catch {
      continue;
    }
    const marker = meta.get("agent-policy-role");
    if (typeof marker !== "string") continue;
    const ids = splitList(marker);
    const selected = ids.flatMap((id) => {
      const fragment = fragments.get(id);
      return fragment === void 0 ? [] : [fragment];
    });
    const rawTools = meta.get("tools");
    const close = lines.indexOf("---", 1);
    const toolsFormat = keyLineAmbiguous(lines, close, "tools") || keyLineAmbiguous(lines, close, "agent-policy-role") ? "other" : toolsFormatOf(rawTools);
    definitions.push({
      name: stringValue(meta.get("name")) ?? file.replace(/\.md$/, ""),
      file: path2.posix.join(".claude", "agents", file),
      model: stringValue(meta.get("model")),
      modelId: modelIdOf(stringValue(meta.get("model"))),
      vendor: stringValue(meta.get("agent-policy-vendor")),
      roles: selected.map((fragment) => fragment.id),
      retiredRoles: ids.filter(isRetiredRole).map((id) => ({
        id,
        replacement: RETIRED_ROLE_REPLACEMENTS[id] ?? null
      })),
      unknownRoles: ids.filter(
        (id) => !isRetiredRole(id) && !fragments.has(id)
      ),
      disallowedTools: disallowedToolsOf(
        parseToolsField(rawTools),
        toolsFormat,
        selected
      ),
      toolsFormat
    });
  }
  return definitions;
}
function candidatesFor(recommended, scope, live) {
  const pool = scope === "claude-only" ? recommended.filter((id) => isClaudeEnum(id)) : recommended;
  const ids = [.../* @__PURE__ */ new Set([...pool, ...CLAUDE_ENUM_MODELS])];
  const candidates = ids.flatMap((id) => {
    const spec = modelById(id);
    if (spec === void 0) return [];
    return liveAliasesOf(spec, live).map((model, index) => ({
      modelId: spec.id,
      model,
      recommended: index === 0 && recommended.includes(id)
    }));
  });
  return [
    ...candidates.filter((candidate) => candidate.recommended),
    ...candidates.filter((candidate) => !candidate.recommended)
  ];
}
function listCoverage(options, live) {
  const roleIds = sortRoleIds(Object.keys(RECOMMENDED));
  const fragments = loadFragments(
    fragmentDirsFor(pluginRoot(), options.dir, options.lang)
  );
  const covered = coveredDefinitions(options.dir, roleIds, options.scope);
  const fallbackNames = options.lang === "en" ? void 0 : roleIds.some((id) => fragments.get(id)?.defaultName === void 0) ? bundledDefaultNames(options.dir) : void 0;
  const roles = roleIds.map((id) => {
    const fragment = fragments.get(id);
    if (fragment === void 0) {
      throw new Error(`Role fragment not found: ${id}`);
    }
    const models = options.scope === "claude-only" ? ASSIGNMENTS["claude-model-policy"][id] : RECOMMENDED[id];
    return {
      id,
      label: fragment.label,
      kind: fragment.kind,
      defaultName: fragment.defaultName ?? fallbackNames?.get(id),
      models,
      candidates: candidatesFor(models, options.scope, live),
      coveredBy: covered.get(id) ?? []
    };
  });
  return {
    ok: true,
    liveOk: live.ok,
    roles,
    uncovered: roles.filter((role) => role.coveredBy.length === 0).map((role) => role.id),
    definitions: inspectDefinitions(options.dir, fragments),
    modelBreakdown: modelBreakdownOf(options.dir)
  };
}
function modelBreakdownOf(projectDir) {
  const all = scopedDefinitions(projectDir, "with-external").length;
  const claude = scopedDefinitions(projectDir, "claude-only").length;
  return { claude, external: all - claude };
}
function readDefinition(options) {
  const file = path2.join(options.dir, ".claude", "agents", `${options.name}.md`);
  const target = path2.relative(options.dir, file).split(path2.sep).join("/");
  if (!fs3.existsSync(file)) {
    throw new Error(`target: ${target} \u304C\u5B58\u5728\u3057\u306A\u3044`);
  }
  const raw = fs3.readFileSync(file, "utf8");
  const lines = raw.split("\n");
  const close = lines[0]?.trim() === "---" ? lines.indexOf("---", 1) : -1;
  if (close === -1) {
    throw new Error(
      raw.includes("\r\n") ? `target: ${target} \u306E frontmatter \u3092\u8AAD\u307F\u53D6\u308C\u306A\u3044\u3002\u6539\u884C\u30B3\u30FC\u30C9\u304C CRLF \u306E\u53EF\u80FD\u6027\u304C\u3042\u308B(CRLF \u306E\u5B9A\u7FA9\u306F\u66F8\u304D\u63DB\u3048\u306E\u5BFE\u8C61\u5916)` : `target: ${target} \u306B frontmatter \u304C\u7121\u3044`
    );
  }
  return { file, target, lines, close };
}
function keyLineIndex(definition, key) {
  const { lines, close } = definition;
  if (keyLineAmbiguous(lines, close, key)) {
    throw new Error(
      `${key}: ${definition.target} \u306E ${key} \u884C\u3092 1 \u884C\u306B\u7279\u5B9A\u3067\u304D\u306A\u3044\u305F\u3081\u66F8\u304D\u63DB\u3048\u306A\u3044(\u540C\u3058\u30AD\u30FC\u304C\u8907\u6570\u3042\u308B\u3001\u307E\u305F\u306F\u5B57\u4E0B\u3052\u3055\u308C\u3066\u3044\u308B)`
    );
  }
  return keyLinesOf(lines, close, key)[0] ?? -1;
}
function lineValue(line) {
  if (line === void 0) return "";
  return line.slice(line.indexOf(":") + 1);
}
function writeDefinition(definition) {
  fs3.writeFileSync(definition.file, definition.lines.join("\n"));
}
function definitionFragments(options, ids) {
  const fragments = loadFragments(
    fragmentDirsFor(pluginRoot(), options.dir, options.lang)
  );
  const selected = ids.flatMap((id) => {
    const fragment = fragments.get(id);
    return fragment === void 0 ? [] : [fragment];
  });
  return { fragments, selected };
}
function addToolsLine(definition, options) {
  if (options.tools.length > 1) {
    throw new Error('tools: "*" \u306F\u4ED6\u306E\u30C4\u30FC\u30EB\u3068\u4F75\u7528\u3067\u304D\u306A\u3044');
  }
  if (keyLineIndex(definition, "tools") !== -1) {
    throw new Error(`tools: ${definition.target} \u306B\u306F tools \u6B04\u304C\u65E2\u306B\u3042\u308B`);
  }
  const marker = keyLineIndex(definition, "agent-policy-role");
  const ids = marker === -1 ? [] : splitList(lineValue(definition.lines[marker]));
  const { selected } = definitionFragments(options, ids);
  if (selected.length === 0) {
    throw new Error(
      `roles: ${definition.target} \u306B\u306F\u89E3\u6C7A\u3067\u304D\u308B\u5F79\u5272\u304C\u7121\u304F\u3001\u8A31\u53EF\u3059\u308B\u30C4\u30FC\u30EB\u3092\u6C7A\u3081\u3089\u308C\u306A\u3044`
    );
  }
  const nameLine = keyLineIndex(definition, "name");
  if (nameLine === -1) {
    throw new Error(`name: ${definition.target} \u306B name \u884C\u304C\u7121\u3044`);
  }
  definition.lines.splice(
    nameLine + 1,
    0,
    `tools: ${resolveToolsFor(selected, []).join(", ")}`
  );
  writeDefinition(definition);
  return { ok: true, target: definition.target, changed: true, warnings: [] };
}
function pruneTools(options) {
  const definition = readDefinition(options);
  if (options.tools.includes("*")) return addToolsLine(definition, options);
  const index = keyLineIndex(definition, "tools");
  if (index === -1) {
    throw new Error(`tools: ${definition.target} \u306B tools \u884C\u304C\u7121\u3044`);
  }
  const line = definition.lines[index] ?? "";
  const value = lineValue(line);
  if (toolsFormatOf(value) !== "csv") {
    throw new Error(
      `tools: ${definition.target} \u306E tools \u306F\u672A\u5BFE\u5FDC\u306E\u66F8\u5F0F\u306E\u305F\u3081\u66F8\u304D\u63DB\u3048\u306A\u3044\u30021 \u884C\u306E\u30AB\u30F3\u30DE\u533A\u5207\u308A\u3060\u3051\u3092\u6271\u3046`
    );
  }
  const current = splitTools(value);
  const warnings = options.tools.filter((tool) => !current.includes(tool)).map((tool) => `tools: ${tool} \u306F tools \u884C\u306B\u7121\u3044\u305F\u3081\u7121\u8996\u3057\u305F`);
  const remaining = current.filter((tool) => !options.tools.includes(tool));
  if (remaining.length === current.length) {
    return {
      ok: true,
      target: definition.target,
      changed: false,
      warnings,
      toolsBefore: current,
      toolsAfter: current
    };
  }
  if (remaining.length === 0) {
    throw new Error(
      `tools: ${definition.target} \u306E\u30C4\u30FC\u30EB\u304C\u3059\u3079\u3066\u5916\u308C\u308B\u305F\u3081\u66F8\u304D\u63DB\u3048\u306A\u3044`
    );
  }
  definition.lines[index] = `${line.slice(0, line.indexOf(":") + 1)} ${remaining.join(", ")}`;
  writeDefinition(definition);
  return {
    ok: true,
    target: definition.target,
    changed: true,
    warnings,
    toolsBefore: current,
    toolsAfter: remaining
  };
}
function rewriteRoles(options) {
  const definition = readDefinition(options);
  const { fragments } = definitionFragments(options, []);
  const invalid = options.roles.filter((id) => !fragments.has(id));
  if (invalid.length > 0) {
    throw new Error(
      `roles: ${invalid.join(", ")} \u306F\u5EC3\u6B62\u6E08\u307F\u304B\u672A\u77E5\u306E\u5F79\u5272 ID \u306E\u305F\u3081\u66F8\u304D\u8FBC\u307E\u306A\u3044`
    );
  }
  const index = keyLineIndex(definition, "agent-policy-role");
  if (index === -1) {
    throw new Error(`roles: ${definition.target} \u306B agent-policy-role \u884C\u304C\u7121\u3044`);
  }
  const before = definition.lines[index];
  if (options.roles.length === 0) {
    definition.lines.splice(index, 1);
  } else {
    definition.lines[index] = `agent-policy-role: ${options.roles.join(", ")}`;
  }
  const changed = options.roles.length === 0 || definition.lines[index] !== before;
  if (changed) writeDefinition(definition);
  return { ok: true, target: definition.target, changed, warnings: [] };
}
function parseArgs(argv) {
  const options = {
    scope: candidateScopeFor(process.env.AMATSUKA_AGENT_AUTO_INJECTION) ?? "claude-only",
    modelId: "",
    recommended: false,
    name: "",
    model: "",
    vendor: "",
    roles: [],
    dir: process.cwd(),
    lang: "ja",
    mcpServers: [],
    mcpDeny: [],
    write: false,
    merge: false,
    listLiveModels: false,
    listRoles: false,
    listCoverage: false,
    listMcp: false,
    checkFragments: false,
    scaffoldFragments: false,
    keep: [],
    pruneTools: false,
    rewriteRoles: false,
    tools: [],
    replace: []
  };
  const seen = /* @__PURE__ */ new Set();
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    const value = argv[index + 1];
    if (arg !== void 0) seen.add(arg);
    switch (arg) {
      case "--policy":
      case "--list-policies":
      case "--list-models":
        throw new Error(
          `Unsupported option: ${arg} was removed; use --scope claude|custom to choose the candidate scope`
        );
      case "--models":
        throw new Error(
          "Unsupported option: --models was removed; use --recommended"
        );
      case "--scope":
        if (value !== "claude" && value !== "custom") {
          throw new Error("scope: must be claude or custom");
        }
        options.scope = value === "claude" ? "claude-only" : "with-external";
        index += 1;
        break;
      case "--model-id":
        options.modelId = requireValue(value, "model-id");
        index += 1;
        break;
      case "--recommended":
        options.recommended = true;
        break;
      case "--name":
        options.name = requireValue(value, "name");
        index += 1;
        break;
      case "--model":
        options.model = requireValue(value, "model");
        index += 1;
        break;
      case "--vendor":
        if (value !== "gpt" && value !== "grok" && value !== "claude" && value !== "none") {
          throw new Error("vendor: must be gpt, grok, claude or none");
        }
        options.vendor = value;
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
        break;
      case "--write":
        options.write = true;
        break;
      case "--merge":
        options.merge = true;
        break;
      case "--list-live-models":
        options.listLiveModels = true;
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
      case "--prune-tools":
        options.pruneTools = true;
        break;
      case "--rewrite-roles":
        options.rewriteRoles = true;
        break;
      case "--tools":
        options.tools = splitList(requireValue(value, "tools"));
        index += 1;
        break;
      case "--replace":
        options.replace = splitList(requireValue(value, "replace"));
        for (const entry of options.replace) {
          if (entry !== "description" && entry !== "preamble") {
            throw new Error("replace: must be description or preamble");
          }
        }
        index += 1;
        break;
      default:
        throw new Error(`Unsupported option: ${arg}`);
    }
  }
  if (options.recommended) {
    for (const [flag, supplied] of [
      ["--model-id", options.modelId !== ""],
      ["--name", options.name !== ""],
      ["--model", options.model !== ""],
      ["--vendor", options.vendor !== ""],
      ["--keep", options.keep.length > 0],
      ["--replace", options.replace.length > 0]
    ]) {
      if (supplied)
        throw new Error(`${flag}: cannot be used with --recommended`);
    }
  }
  if (options.name !== "" && !/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(options.name)) {
    throw new Error("name: must be lowercase letters, digits and hyphens");
  }
  if (options.pruneTools || options.rewriteRoles) {
    const operation = options.pruneTools ? "--prune-tools" : "--rewrite-roles";
    const accepted = /* @__PURE__ */ new Set([
      operation,
      "--name",
      "--dir",
      options.pruneTools ? "--tools" : "--roles"
    ]);
    for (const flag of seen) {
      if (!accepted.has(flag)) {
        throw new Error(`${flag}: cannot be used with ${operation}`);
      }
    }
    if (options.name === "") throw new Error("name: is required");
    if (options.pruneTools && options.tools.length === 0) {
      throw new Error("tools: is required");
    }
    if (options.rewriteRoles && !seen.has("--roles")) {
      throw new Error("roles: is required");
    }
    return options;
  }
  if (seen.has("--tools")) throw new Error("tools: requires --prune-tools");
  if (options.listLiveModels || options.listRoles || options.listCoverage || options.listMcp || options.checkFragments || options.scaffoldFragments) {
    return options;
  }
  if (options.merge && !options.write)
    throw new Error("merge: requires --write");
  if (options.replace.length > 0 && !options.merge)
    throw new Error("replace: requires --merge");
  if (options.recommended) return options;
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
async function main() {
  try {
    const options = parseArgs(process.argv.slice(2));
    if (options.pruneTools) {
      respond(pruneTools(options));
    } else if (options.rewriteRoles) {
      respond(rewriteRoles(options));
    } else if (options.listLiveModels) {
      const live = options.scope === "claude-only" ? { ok: true, ids: [], vendors: {} } : await fetchLiveModels(process.env);
      respond(listLiveModels(live, options.scope));
    } else if (options.listCoverage) {
      const live = options.scope === "claude-only" ? { ok: true, ids: [], vendors: {} } : await fetchLiveModels(process.env);
      respond(listCoverage(options, live));
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
      const live = options.scope === "claude-only" ? { ok: true, ids: [], vendors: {} } : await fetchLiveModels(process.env);
      respond(setup(options, live));
    }
  } catch (error) {
    respond({
      ok: false,
      error: error instanceof Error ? error.message : "Unexpected error",
      results: []
    });
    process.exitCode = 1;
  }
}
await main();
