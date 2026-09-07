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
function hasMixedKinds(kinds) {
  const unique2 = new Set(kinds);
  return unique2.has("impl") && unique2.has("readonly");
}

// src/agents/policies.ts
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
    model: "claude-gpt-5-6-luna",
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
    model: "claude-grok-4-6",
    color: "red"
  }
];
var RECOMMENDED = {
  "complex-impl": ["opus", "gpt-sol"],
  "normal-impl": ["sonnet", "gpt-luna", "grok"],
  "light-impl": ["haiku", "gpt-luna", "grok"],
  escalation: ["fable", "gpt-astra"],
  general: ["sonnet", "gpt-luna"],
  "design-plan": ["opus"],
  "explore-lead": ["opus"],
  explore: ["sonnet", "grok", "gpt-terra"],
  "realtime-research": ["sonnet", "grok"],
  "e2e-verify": ["sonnet", "gpt-astra"],
  "independent-review": ["sonnet", "grok"],
  "doc-review": ["haiku"],
  "code-review": ["sonnet"],
  "final-review": ["fable", "gpt-astra"],
  "gate-review": ["fable", "gpt-astra"],
  advisor: ["fable", "gpt-astra"]
};
var AGENT_DENIED_MODELS = ["haiku"];
var SOLO_DENIED_ROLES = [
  "light-impl",
  "advisor",
  "doc-review",
  "code-review",
  "final-review",
  "gate-review"
];
function allowsAgentTool(ids, model) {
  if (model !== void 0 && AGENT_DENIED_MODELS.includes(model)) return false;
  return ids.some((id) => !SOLO_DENIED_ROLES.includes(id));
}
function modelById(id) {
  return MODELS.find((model) => model.id === id);
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
  claude: "blue",
  none: "blue"
};
function compose(input) {
  const vocabulary = vocabularyFor(input.lang);
  const common = loadCommon(input.fragmentDirs);
  const { ids: ordered, selected } = selectFragments(input);
  const withAgent = allowsAgentTool(input.roleIds, input.modelId);
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
    agentTool: allowsAgentTool(input.roleIds, input.modelId)
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

// src/setup-agents.ts
var CLAUDE_ENUMS = ["sonnet", "opus", "haiku", "fable"];
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
function recommendedRolesFor(modelId) {
  return sortRoleIds(
    Object.entries(RECOMMENDED).filter(([, models]) => models.includes(modelId)).map(([role]) => role)
  );
}
function recommendedForAlias(model) {
  const modelIds = MODELS.filter((spec) => spec.model === model).map(
    (spec) => spec.id
  );
  return sortRoleIds(
    Object.entries(RECOMMENDED).filter(
      ([, recommended]) => recommended.some((modelId) => modelIds.includes(modelId))
    ).map(([role]) => role)
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
function defaultAgentName(options, spec) {
  const roles = recommendedRolesFor(spec.id);
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
function isClaudeEnum(model) {
  return CLAUDE_ENUMS.includes(model);
}
function unavailableWarning(live) {
  return `live models unavailable (${live.reason ?? "unknown"}); model existence was not validated`;
}
function resolveVendor(options, model, spec, live) {
  if (options.vendor !== "") return options.vendor;
  if (isClaudeEnum(model)) return "claude";
  if (!live.ok) return spec.vendor;
  const vendor = live.vendors[model] ?? "unknown";
  if (vendor === "unknown") {
    throw new Error(
      `vendor: could not infer vendor for model "${model}"; pass --vendor gpt|grok|claude|none`
    );
  }
  return vendor;
}
function modelIsAvailable(model, live) {
  return isClaudeEnum(model) || live.ids.includes(model);
}
function targetsFor(options, live) {
  const warnings = live.ok ? [] : [unavailableWarning(live)];
  if (options.models.length > 0) {
    const specs = options.models.map((id) => {
      const spec2 = modelById(id);
      if (spec2 === void 0) throw new Error(`models: ${id} is unknown`);
      return spec2;
    });
    const included = live.ok ? specs.filter((spec2) => modelIsAvailable(spec2.model, live)) : specs;
    const modelsDropped = live.ok ? specs.filter((spec2) => !modelIsAvailable(spec2.model, live)).map((spec2) => spec2.id) : [];
    return {
      warnings,
      modelsDropped,
      targets: included.map((spec2) => {
        const vendor2 = resolveVendor(options, spec2.model, spec2, live);
        return {
          modelId: spec2.id,
          composeModelId: spec2.id,
          name: defaultAgentName(options, spec2),
          model: spec2.model,
          roles: recommendedRolesFor(spec2.id),
          color: VENDOR_COLORS[vendor2],
          vendor: vendor2
        };
      })
    };
  }
  const spec = requireModel(options);
  const model = options.model === "" ? spec.model : options.model;
  if (options.write && live.ok && !modelIsAvailable(model, live)) {
    throw new Error(
      `model: ${model} is not a Claude enum and was not found in live models`
    );
  }
  warnings.push(...validateRoles(options, spec));
  const vendor = resolveVendor(options, model, spec, live);
  return {
    warnings: [...new Set(warnings)],
    modelsDropped: [],
    targets: [
      {
        modelId: spec.id,
        composeModelId: options.model === "" ? spec.id : void 0,
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
    modelId: target.composeModelId,
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
  return selectors.filter((selector) => selector.startsWith("tools:mcp__"));
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
function setup(options, live) {
  validateFragments(options);
  const resolution = targetsFor(options, live);
  const mcp = resolveMcp(options);
  const results = resolution.targets.map((target) => {
    const current = mcpCurrentFor(targetPath(options, target));
    const result = options.write ? write(options, target, mcp.servers) : diff(options, target, mcp.servers);
    return {
      ...result,
      modelId: target.modelId,
      mcpCurrent: current,
      mcpDropped: mcp.dropped
    };
  });
  return {
    ok: true,
    results,
    warnings: resolution.warnings,
    modelsDropped: resolution.modelsDropped
  };
}
function listLiveModels(live) {
  const claudeEnums = [...CLAUDE_ENUMS];
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
      vendor: live.vendors[id] ?? "unknown",
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
    languageMismatch: options.lang !== "ja" && fragment.source === "project" && ownDir !== void 0 && fs2.existsSync(path2.join(ownDir, `${fragment.id}.md`))
  }));
  return { ok: true, lang: options.lang, roles };
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
function listCoverage(options) {
  const roleIds = sortRoleIds(Object.keys(RECOMMENDED));
  const fragments = loadFragments(
    fragmentDirsFor(pluginRoot(), options.dir, options.lang)
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
      models: RECOMMENDED[id],
      coveredBy: covered.get(id) ?? []
    };
  });
  return {
    ok: true,
    roles,
    uncovered: roles.filter((role) => role.coveredBy.length === 0).map((role) => role.id)
  };
}
function parseArgs(argv) {
  const options = {
    modelId: "",
    models: [],
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
    keep: []
  };
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    const value = argv[index + 1];
    switch (arg) {
      case "--policy":
      case "--list-policies":
      case "--list-models":
        throw new Error(
          `Unsupported option: ${arg} was removed; setup-agents is custom-profile only`
        );
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
      default:
        throw new Error(`Unsupported option: ${arg}`);
    }
  }
  if (options.name !== "" && !/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(options.name)) {
    throw new Error("name: must be lowercase letters, digits and hyphens");
  }
  if (options.listLiveModels || options.listRoles || options.listCoverage || options.listMcp || options.checkFragments || options.scaffoldFragments) {
    return options;
  }
  if (options.merge && !options.write)
    throw new Error("merge: requires --write");
  if (options.models.length > 0) {
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
async function main() {
  try {
    const options = parseArgs(process.argv.slice(2));
    if (options.listLiveModels) {
      respond(listLiveModels(await fetchLiveModels(process.env)));
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
      respond(setup(options, await fetchLiveModels(process.env)));
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
