// src/setup-agents.ts
import fs2 from "node:fs";
import path2 from "node:path";
import { fileURLToPath } from "node:url";

// src/agents/fragments.ts
import fs from "node:fs";
import path from "node:path";
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
  for (const [index, dir] of dirs.entries()) {
    const source = index === 0 ? "plugin" : "project";
    if (!fs.existsSync(dir)) continue;
    const files = fs.readdirSync(dir).filter((name) => name.endsWith(".md") && !name.startsWith("_")).sort((left, right) => left.localeCompare(right));
    for (const name of files) {
      if (name.split(".").length > 2) continue;
      const fragment = readFragment(path.join(dir, name), source);
      fragments.set(fragment.id, fragment);
    }
  }
  for (const dir of dirs) {
    if (!fs.existsSync(dir)) continue;
    for (const name of fs.readdirSync(dir).sort((left, right) => left.localeCompare(right))) {
      if (!name.endsWith(`.${vendor}.md`)) continue;
      const { meta, sections } = parse(
        fs.readFileSync(path.join(dir, name), "utf8")
      );
      const target = fragments.get(meta.id ?? "");
      if (target !== void 0) appendSections(target, sections);
    }
  }
  return fragments;
}
function loadCommon(dirs) {
  const sections = /* @__PURE__ */ new Map();
  for (const dir of dirs) {
    const file = path.join(dir, "_common.md");
    if (!fs.existsSync(file)) continue;
    for (const [heading, body] of parse(fs.readFileSync(file, "utf8")).sections) {
      sections.set(heading, body);
    }
  }
  if (sections.size === 0) throw new Error("_common.md not found");
  return sections;
}

// src/agents/roles.ts
var ROLES = [
  {
    id: "complex-impl",
    label: "\u8907\u96D1\u307E\u305F\u306F\u91CD\u8981\u306A\u5B9F\u88C5",
    kind: "impl",
    tools: ["Read", "Grep", "Glob", "Write", "Edit", "Bash", "Skill", "LSP"]
  },
  {
    id: "normal-impl",
    label: "\u901A\u5E38\u306E\u5B9F\u88C5",
    kind: "impl",
    tools: ["Read", "Grep", "Glob", "Write", "Edit", "Bash", "Skill", "LSP"]
  },
  {
    id: "light-impl",
    label: "\u8EFD\u91CF\u306A\u5B9F\u88C5",
    kind: "impl",
    tools: ["Read", "Grep", "Glob", "Write", "Edit", "Bash", "LSP"]
  },
  {
    id: "general",
    label: "\u305D\u306E\u4ED6\u306E\u30BF\u30B9\u30AF",
    kind: "impl",
    tools: ["Read", "Grep", "Glob", "Write", "Edit", "Bash", "Skill", "LSP"]
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

// src/agents/compose.ts
var COLORS = {
  gpt: "yellow",
  grok: "red",
  claude: "blue"
};
var BODY_ORDER = [
  "## When to invoke",
  "## Core Responsibilities",
  "## \u4F5C\u696D\u624B\u9806"
];
function compose(input) {
  const common = loadCommon(input.fragmentDirs);
  const { ids: ordered, selected } = selectFragments(input);
  const withAgent = allowsAgentTool(input.roleIds);
  const tools = resolveToolsFor(selected, withAgent);
  const head = [
    "---",
    `name: ${input.name}`,
    `description: ${describe(selected)}`,
    `model: ${input.model}`,
    `color: ${input.color ?? COLORS[input.vendor]}`,
    `tools: ${tools.join(", ")}`,
    `agent-policy-role: ${ordered.join(", ")}`,
    "---",
    ""
  ];
  const body = [];
  body.push(...preamble(common, input.name, selected), "");
  for (const heading of BODY_ORDER) {
    const items = selected.flatMap(
      (fragment) => fragment.sections.get(heading) ?? []
    );
    if (items.length === 0) continue;
    body.push(heading, "", ...items, "");
  }
  if (withAgent) {
    const advisor = common.get("## \u30A2\u30C9\u30D0\u30A4\u30B6\u30FC\u3078\u306E\u76F8\u8AC7");
    if (advisor !== void 0)
      body.push("## \u30A2\u30C9\u30D0\u30A4\u30B6\u30FC\u3078\u306E\u76F8\u8AC7", "", ...advisor, "");
  }
  const constraints = [
    ...withAgent ? common.get("## Agent tool \u306E\u5236\u7D04") ?? [] : [],
    ...common.get("## \u5236\u7D04") ?? [],
    ...selected.flatMap((fragment) => fragment.sections.get("## \u5236\u7D04") ?? [])
  ];
  if (constraints.length > 0) body.push("## \u5236\u7D04", "", ...constraints, "");
  body.push("## Output Format", "");
  if (selected.length === 1) {
    body.push(...selected[0]?.sections.get("## Output Format") ?? [], "");
  } else {
    for (const fragment of selected) {
      const items = fragment.sections.get("## Output Format");
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
function resolveToolsFor(selected, withAgent) {
  const tools = [];
  for (const fragment of selected) {
    for (const tool of fragment.tools) {
      if (tool !== "Agent" && !tools.includes(tool)) tools.push(tool);
    }
  }
  if (withAgent) tools.push("Agent");
  return tools;
}
function describe(selected) {
  const list = selected.map((fragment) => fragment.description).join("\u3001");
  return `Use this agent when ${list}\u3092\u59D4\u8B72\u3059\u308B\u3068\u304D\u3002\u8A73\u7D30\u306F\u672C\u6587\u306E\u300CWhen to invoke\u300D\u3092\u53C2\u7167\u3002`;
}
function preamble(common, name, selected) {
  const labels = selected.map((fragment) => `\u300C${fragment.label}\u300D`).join("\u3001");
  return (common.get("## Preamble") ?? []).map(
    (line) => line.replace("{{NAME}}", name).replace("{{ROLE_LABELS}}", labels)
  );
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
function fragmentDirs(projectDir) {
  return [
    path2.join(pluginRoot(), "assets", "roles"),
    path2.join(projectDir, ".claude", "agent-policy", "roles")
  ];
}
function composeInput(options) {
  return {
    name: options.name,
    model: options.model,
    vendor: options.vendor,
    roleIds: options.roles,
    fragmentDirs: fragmentDirs(options.dir)
  };
}
function template(options) {
  return compose(composeInput(options));
}
function targetPath(options) {
  return path2.join(options.dir, ".claude", "agents", `${options.name}.md`);
}
function compare(options, rendered, existingRaw) {
  const file = targetPath(options);
  const relative = path2.relative(options.dir, file).split(path2.sep).join("/");
  const roles = describeRoles(composeInput(options));
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
function diff(options) {
  const rendered = template(options);
  const file = targetPath(options);
  const existingRaw = fs2.existsSync(file) ? fs2.readFileSync(file, "utf8") : void 0;
  return compare(options, rendered, existingRaw);
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
    ...difference.frontmatter.toolsOnlyInExisting.map(
      (tool) => `tools:${tool}`
    ),
    ...difference.frontmatter.keysOnlyInExisting.map((key) => `key:${key}`),
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
function write(options) {
  const file = targetPath(options);
  const rendered = template(options);
  const exists = fs2.existsSync(file);
  const existingRaw = exists ? fs2.readFileSync(file, "utf8") : void 0;
  const difference = compare(options, rendered, existingRaw);
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
    discarded: discarded(difference, shouldMerge ? keep : parseKeep([]))
  };
}
function listAvailableRoles(options) {
  const roles = [
    ...loadFragments(fragmentDirs(options.dir), options.vendor).values()
  ].sort(
    (left, right) => roleOrder(left.id) - roleOrder(right.id) || left.id.localeCompare(right.id)
  ).map(({ id, label, kind, tools, source }) => ({
    id,
    label,
    kind,
    tools,
    source
  }));
  return { ok: true, roles };
}
function parseArgs(argv) {
  const options = {
    vendor: "gpt",
    name: "",
    model: "",
    roles: [],
    dir: process.cwd(),
    check: false,
    write: false,
    merge: false,
    listRoles: false,
    keep: []
  };
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    const value = argv[index + 1];
    switch (arg) {
      case "--vendor":
        if (value !== "gpt" && value !== "grok" && value !== "claude") {
          throw new Error("vendor: must be gpt, grok or claude");
        }
        options.vendor = value;
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
        options.roles = [
          ...new Set(
            requireValue(value, "roles").split(",").map((role) => role.trim()).filter((role) => role !== "")
          )
        ];
        index += 1;
        break;
      case "--dir":
        options.dir = path2.resolve(requireValue(value, "dir"));
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
      case "--list-roles":
        options.listRoles = true;
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
  if (options.listRoles) return options;
  if (options.name === "") throw new Error("name: is required");
  if (options.model === "") throw new Error("model: is required");
  if (options.roles.length === 0) throw new Error("roles: is required");
  if (options.merge && !options.write)
    throw new Error("merge: requires --write");
  return options;
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
  if (options.listRoles) {
    respond(listAvailableRoles(options));
  } else if (options.write) {
    respond(write(options));
  } else {
    respond(diff(options));
  }
} catch (error) {
  respond({
    ok: false,
    error: error instanceof Error ? error.message : "Unexpected error"
  });
  process.exitCode = 1;
}
