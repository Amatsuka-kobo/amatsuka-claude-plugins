#!/usr/bin/env node
var __defProp = Object.defineProperty;
var __name = (target, value) => __defProp(target, "name", { value, configurable: true });

// src/setup.ts
import fs3 from "node:fs";
import path3 from "node:path";

// src/lib/agents.ts
import fs2 from "node:fs";
import path2 from "node:path";

// src/lib/document.ts
function frontmatterClose(lines) {
  if (lines[0]?.trim() !== "---") return -1;
  return lines.indexOf("---", 1);
}
__name(frontmatterClose, "frontmatterClose");
function parseDocument(content) {
  const lines = content.split("\n");
  const close = frontmatterClose(lines);
  const meta = /* @__PURE__ */ new Map();
  const order = [];
  if (close !== -1) {
    let blockKey;
    for (const line of lines.slice(1, close)) {
      if (blockKey !== void 0 && /^(\s|-)/.test(line)) {
        meta.set(blockKey, `${meta.get(blockKey)}
${line}`);
        continue;
      }
      blockKey = void 0;
      const block = /^([^\s:#][^:]*):$/.exec(line.trimEnd());
      if (block?.[1] !== void 0) {
        blockKey = block[1];
        meta.set(blockKey, "");
        order.push(blockKey);
        continue;
      }
      const at = line.indexOf(": ");
      if (at <= 0) continue;
      const key = line.slice(0, at);
      meta.set(key, line.slice(at + 2));
      order.push(key);
    }
  }
  const preamble = [];
  const sections = /* @__PURE__ */ new Map();
  let heading;
  let buffer = [];
  for (const line of lines.slice(close === -1 ? 0 : close + 1)) {
    if (line.startsWith("## ")) {
      if (heading !== void 0) sections.set(heading, buffer.join("\n").trim());
      heading = line.trim();
      buffer = [];
      continue;
    }
    if (heading === void 0) preamble.push(line);
    else buffer.push(line);
  }
  if (heading !== void 0) sections.set(heading, buffer.join("\n").trim());
  return { order, meta, preamble: preamble.join("\n").trim(), sections };
}
__name(parseDocument, "parseDocument");
function render(document) {
  const head = ["---"];
  for (const key of document.order) {
    const value = document.meta.get(key) ?? "";
    head.push(value.startsWith("\n") ? `${key}:${value}` : `${key}: ${value}`);
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
__name(render, "render");
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
function duplicateHeadings(content) {
  const seen = /* @__PURE__ */ new Set();
  const duplicated = /* @__PURE__ */ new Set();
  for (const line of bodyLines(content)) {
    if (!line.startsWith("## ")) continue;
    const heading = line.trim();
    if (seen.has(heading)) duplicated.add(heading);
    seen.add(heading);
  }
  return [...duplicated];
}
__name(duplicateHeadings, "duplicateHeadings");

// src/lib/fragments.ts
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

// src/lib/hash.ts
import crypto from "node:crypto";
function textHash(text) {
  return crypto.createHash("sha256").update(text.trim()).digest("hex").slice(0, 16);
}
__name(textHash, "textHash");
function bodyHash(content) {
  const lines = content.split("\n");
  let body = lines;
  if (lines[0]?.trim() === "---") {
    const close = lines.indexOf("---", 1);
    if (close !== -1) body = lines.slice(close + 1);
  }
  return textHash(body.join("\n"));
}
__name(bodyHash, "bodyHash");
function encodeRecord(record) {
  return Buffer.from(JSON.stringify(record), "utf8").toString("base64url");
}
__name(encodeRecord, "encodeRecord");
function decodeRecord(value) {
  if (value === void 0 || value.trim() === "") return void 0;
  try {
    const parsed = JSON.parse(
      Buffer.from(value.trim(), "base64url").toString("utf8")
    );
    if (typeof parsed !== "object" || parsed === null) return void 0;
    if (typeof parsed.sections !== "object" || parsed.sections === null) {
      return void 0;
    }
    return parsed;
  } catch {
    return void 0;
  }
}
__name(decodeRecord, "decodeRecord");

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
var CLAUDE_MODELS = [
  "sonnet",
  "opus",
  "haiku",
  "fable"
];
var EFFORTS = [
  "low",
  "medium",
  "high",
  "xhigh",
  "max"
];
function roleById(id) {
  return ROLES.find((role) => role.id === id);
}
__name(roleById, "roleById");
function isClaudeModel(value) {
  return CLAUDE_MODELS.includes(value);
}
__name(isClaudeModel, "isClaudeModel");
function isEffort(value) {
  return EFFORTS.includes(value);
}
__name(isEffort, "isEffort");

// src/lib/fragments.ts
var JA = {
  bodyOrder: [
    "## When to invoke",
    "## Core Responsibilities",
    "## \u4F5C\u696D\u624B\u9806",
    "## \u5236\u7D04",
    "## Output Format"
  ]
};
var EN = {
  bodyOrder: [
    "## When to invoke",
    "## Core Responsibilities",
    "## Procedure",
    "## Constraints",
    "## Output Format"
  ]
};
var WHEN_TO_INVOKE = "## When to invoke";
function vocabularyFor(lang) {
  return lang === "ja" ? JA : EN;
}
__name(vocabularyFor, "vocabularyFor");
function pluginRoot() {
  const fromEnv = process.env.CLAUDE_PLUGIN_ROOT;
  if (fromEnv !== void 0 && fromEnv !== "") return fromEnv;
  let dir = path.dirname(fileURLToPath(import.meta.url));
  while (!fs.existsSync(path.join(dir, ".claude-plugin", "plugin.json"))) {
    const parent = path.dirname(dir);
    if (parent === dir) throw new Error("plugin root not found");
    dir = parent;
  }
  return dir;
}
__name(pluginRoot, "pluginRoot");
function trim(lines) {
  let start = 0;
  let end = lines.length;
  while (start < end && lines[start]?.trim() === "") start += 1;
  while (end > start && lines[end - 1]?.trim() === "") end -= 1;
  return lines.slice(start, end);
}
__name(trim, "trim");
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
    if (heading !== void 0) sections.get(heading)?.push(line);
  }
  for (const [key, body] of sections) sections.set(key, trim(body));
  return { meta, sections };
}
__name(parse, "parse");
function requireMeta(meta, key, file) {
  const value = meta[key];
  if (value === void 0 || value === "") {
    throw new Error(`Fragment is missing "${key}": ${file}`);
  }
  return value;
}
__name(requireMeta, "requireMeta");
function readFragment(file) {
  const { meta, sections } = parse(fs.readFileSync(file, "utf8"));
  const id = requireMeta(meta, "id", file);
  const role = roleById(id);
  if (role === void 0) throw new Error(`Unknown role id: ${id} (${file})`);
  const kind = requireMeta(meta, "kind", file);
  if (kind !== "impl" && kind !== "readonly") {
    throw new Error(`Fragment "kind" must be impl or readonly: ${file}`);
  }
  return {
    id: role.id,
    label: requireMeta(meta, "label", file),
    description: requireMeta(meta, "description", file),
    defaultName: requireMeta(meta, "default-name", file),
    tools: requireMeta(meta, "tools", file).split(",").map((tool) => tool.trim()).filter((tool) => tool !== ""),
    kind,
    sections
  };
}
__name(readFragment, "readFragment");
function assertLang(lang) {
  if (!/^[A-Za-z]{2,3}(?:-[A-Za-z0-9]{2,8})*$/.test(lang)) {
    throw new Error(`lang: invalid language code: "${lang}"`);
  }
}
__name(assertLang, "assertLang");
function bundledLang(lang) {
  return lang === "ja" ? "ja" : "en";
}
__name(bundledLang, "bundledLang");
function bundledDir(root, lang) {
  return path.join(root, "assets", "roles", bundledLang(lang));
}
__name(bundledDir, "bundledDir");
function translationDir(projectDir, lang) {
  assertLang(lang);
  return path.join(projectDir, ".claude", "better-agentics", "roles", lang);
}
__name(translationDir, "translationDir");
function needsTranslation(lang) {
  return lang !== "ja" && lang !== "en";
}
__name(needsTranslation, "needsTranslation");
function roleFiles(dir) {
  return fs.readdirSync(dir).filter((name) => name.endsWith(".md") && !name.startsWith("_")).sort((left, right) => left.localeCompare(right));
}
__name(roleFiles, "roleFiles");
function loadFragments(root, projectDir, lang) {
  assertLang(lang);
  const dir = bundledDir(root, lang);
  const fragments = /* @__PURE__ */ new Map();
  for (const name of roleFiles(dir)) {
    const fragment = readFragment(path.join(dir, name));
    fragments.set(fragment.id, fragment);
  }
  if (!needsTranslation(lang)) return fragments;
  const target = translationDir(projectDir, lang);
  if (!fs.existsSync(target)) return fragments;
  for (const name of roleFiles(target)) {
    const translated = readFragment(path.join(target, name));
    const bundled = fragments.get(translated.id);
    if (bundled === void 0) continue;
    const when = bundled.sections.get(WHEN_TO_INVOKE);
    if (when !== void 0) translated.sections.set(WHEN_TO_INVOKE, when);
    fragments.set(translated.id, {
      ...translated,
      tools: bundled.tools,
      kind: bundled.kind,
      defaultName: bundled.defaultName
    });
  }
  return fragments;
}
__name(loadFragments, "loadFragments");
function loadPreamble(root, projectDir, lang) {
  const candidates = [path.join(bundledDir(root, lang), "_common.md")];
  if (needsTranslation(lang)) {
    candidates.unshift(
      path.join(translationDir(projectDir, lang), "_common.md")
    );
  }
  for (const file of candidates) {
    if (!fs.existsSync(file)) continue;
    const preamble = parse(fs.readFileSync(file, "utf8")).sections.get(
      "## Preamble"
    );
    if (preamble !== void 0) return preamble;
  }
  throw new Error("_common.md not found");
}
__name(loadPreamble, "loadPreamble");
function bundledFiles(dir) {
  return fs.readdirSync(dir).filter((name) => name.endsWith(".md")).sort((left, right) => left.localeCompare(right));
}
__name(bundledFiles, "bundledFiles");
function checkFragments(root, projectDir, lang) {
  assertLang(lang);
  if (!needsTranslation(lang)) {
    return { lang, targetDir: null, missing: [], stale: [], ready: [] };
  }
  const sourceDir = bundledDir(root, lang);
  const targetDir = translationDir(projectDir, lang);
  const status = {
    lang,
    targetDir,
    missing: [],
    stale: [],
    ready: []
  };
  for (const name of bundledFiles(sourceDir)) {
    const id = name.replace(/\.md$/, "");
    const target = path.join(targetDir, name);
    if (!fs.existsSync(target)) {
      status.missing.push(id);
      continue;
    }
    const expected = bodyHash(
      fs.readFileSync(path.join(sourceDir, name), "utf8")
    );
    const actual = parse(fs.readFileSync(target, "utf8")).meta["source-hash"];
    if (actual === expected) status.ready.push(id);
    else status.stale.push(id);
  }
  return status;
}
__name(checkFragments, "checkFragments");
function scaffoldFragments(root, projectDir, lang) {
  assertLang(lang);
  if (!needsTranslation(lang)) return [];
  const sourceDir = bundledDir(root, lang);
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
__name(scaffoldFragments, "scaffoldFragments");

// src/lib/compose.ts
var ROLE_KEY = "better-agentics-role";
var HASH_KEY = "better-agentics-hash";
function compose(input) {
  const fragment = loadFragments(
    input.pluginRoot,
    input.projectDir,
    input.lang
  ).get(input.roleId);
  if (fragment === void 0)
    throw new Error(`Unknown role id: ${input.roleId}`);
  const tools = [...fragment.tools];
  for (const tool of input.mcpTools) if (!tools.includes(tool)) tools.push(tool);
  const preamble = loadPreamble(input.pluginRoot, input.projectDir, input.lang).map(
    (line) => line.replace("{{NAME}}", input.name).replace("{{ROLE_LABEL}}", fragment.label)
  ).join("\n").trim();
  const body = [preamble, ""];
  for (const heading of vocabularyFor(input.lang).bodyOrder) {
    const lines = fragment.sections.get(heading);
    if (lines === void 0 || lines.length === 0) continue;
    body.push(heading, "", ...lines, "");
  }
  const bodyText = body.join("\n").replace(/\n{3,}/g, "\n\n").trimEnd();
  const parsed = parseDocument(`---
---
${bodyText}
`);
  const record = {
    description: textHash(fragment.description),
    preamble: textHash(parsed.preamble),
    sections: Object.fromEntries(
      [...parsed.sections].map(([heading, text]) => [heading, textHash(text)])
    )
  };
  const head = [
    "---",
    `name: ${input.name}`,
    `description: ${fragment.description}`,
    `model: ${input.model}`,
    ...input.effort === void 0 ? [] : [`effort: ${input.effort}`],
    `tools: ${tools.join(", ")}`,
    ...input.denyTools.length > 0 ? [`disallowedTools: ${input.denyTools.join(", ")}`] : [],
    `${ROLE_KEY}: ${input.roleId}`,
    `${HASH_KEY}: ${encodeRecord(record)}`,
    "---",
    ""
  ];
  return `${[...head, bodyText].join("\n")}
`;
}
__name(compose, "compose");

// src/lib/agents.ts
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
  const dir = path2.join(projectDir, ".claude", "agents");
  let files;
  try {
    files = fs2.readdirSync(dir).sort();
  } catch {
    return [];
  }
  const found = [];
  for (const name of files) {
    if (!name.endsWith(".md")) continue;
    let content;
    try {
      content = fs2.readFileSync(path2.join(dir, name), "utf8");
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

// src/lib/mcp.ts
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
    const head = line.slice(0, at).trim();
    const sep = head.indexOf(": ");
    const name = sep === -1 ? head.replace(/:$/, "").trim() : head.slice(0, sep).trim();
    if (name === "") continue;
    servers.push({
      name,
      status,
      usable: USABLE.some((known) => status.startsWith(known))
    });
  }
  return servers;
}
__name(parseMcpList, "parseMcpList");
function toolPrefix(name) {
  return `mcp__${name.replace(/[^A-Za-z0-9_-]/g, "_")}`;
}
__name(toolPrefix, "toolPrefix");
function listMcpServers(env) {
  const bin = env.BETTER_AGENTICS_CLAUDE_BIN;
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
__name(listMcpServers, "listMcpServers");
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
  const split = /* @__PURE__ */ __name((value) => value === void 0 ? [] : value.split(",").map((entry) => entry.trim()).filter((entry) => entry !== ""), "split");
  return {
    servers: split(meta.get("tools")).filter((tool) => tool.startsWith("mcp__")).map((tool) => tool.slice("mcp__".length)),
    denyTools: split(meta.get("disallowedTools"))
  };
}
__name(mcpCurrentOf, "mcpCurrentOf");

// src/lib/regenerate.ts
var GENERATED_KEYS = [
  "name",
  "description",
  "model",
  "effort",
  "tools",
  "disallowedTools",
  ROLE_KEY,
  HASH_KEY
];
function classify(existing, template, record) {
  if (textHash(existing) === textHash(template)) return "same";
  if (record === void 0) return "unknown";
  if (textHash(existing) === record) return "templateChanged";
  return "userEdited";
}
__name(classify, "classify");
function recordValue(record, key) {
  if (record === void 0) return void 0;
  if (key === "description") return record.description;
  if (key === "preamble") return record.preamble;
  return record.sections[key];
}
__name(recordValue, "recordValue");
function textOf(document, key) {
  if (key === "description") return document.meta.get("description") ?? "";
  if (key === "preamble") return document.preamble;
  return document.sections.get(key);
}
__name(textOf, "textOf");
function report(key, existing, template, record) {
  const state = classify(existing, template, recordValue(record, key));
  return state === "same" ? { key, state } : { key, state, existing, template };
}
__name(report, "report");
function compare(existingRaw, templateRaw) {
  const existing = parseDocument(existingRaw);
  const template = parseDocument(templateRaw);
  const record = decodeRecord(existing.meta.get(HASH_KEY));
  const reports = [];
  for (const key of ["description", "preamble"]) {
    reports.push(
      report(
        key,
        textOf(existing, key) ?? "",
        textOf(template, key) ?? "",
        record
      )
    );
  }
  for (const [heading, body] of template.sections) {
    const current = existing.sections.get(heading);
    reports.push(
      current === void 0 ? { key: heading, state: "new" } : report(heading, current, body, record)
    );
  }
  for (const heading of existing.sections.keys()) {
    if (!template.sections.has(heading)) {
      reports.push({ key: heading, state: "extra" });
    }
  }
  return reports;
}
__name(compare, "compare");
function merge(input) {
  const existing = parseDocument(input.existingRaw);
  const template = parseDocument(input.templateRaw);
  const existingRecord = decodeRecord(existing.meta.get(HASH_KEY));
  const record = decodeRecord(template.meta.get(HASH_KEY)) ?? { sections: {} };
  const reports = compare(input.existingRaw, input.templateRaw);
  const kept = [];
  const replaced = [];
  const keepRecord = /* @__PURE__ */ __name((key) => {
    const value = recordValue(existingRecord, key);
    if (key === "description" || key === "preamble") {
      if (value === void 0) delete record[key];
      else record[key] = value;
    } else if (value === void 0) {
      delete record.sections[key];
    } else {
      record.sections[key] = value;
    }
  }, "keepRecord");
  const merged = {
    order: [...template.order],
    meta: new Map(template.meta),
    preamble: template.preamble,
    sections: new Map(template.sections)
  };
  merged.meta.set(
    "name",
    existing.meta.get("name") ?? template.meta.get("name") ?? ""
  );
  for (const entry of reports) {
    if (entry.state === "extra") {
      merged.sections.set(entry.key, existing.sections.get(entry.key) ?? "");
      kept.push(entry.key);
      continue;
    }
    if (input.keep.has(entry.key)) {
      if (entry.key === "description") {
        merged.meta.set("description", existing.meta.get("description") ?? "");
      } else if (entry.key === "preamble") {
        merged.preamble = existing.preamble;
      } else {
        merged.sections.set(entry.key, existing.sections.get(entry.key) ?? "");
      }
      keepRecord(entry.key);
      kept.push(entry.key);
      continue;
    }
    if (entry.state !== "same" && entry.state !== "new")
      replaced.push(entry.key);
  }
  const keysKept = existing.order.filter(
    (key) => !GENERATED_KEYS.includes(key) && !merged.meta.has(key)
  );
  for (const key of keysKept) {
    merged.order.push(key);
    merged.meta.set(key, existing.meta.get(key) ?? "");
  }
  merged.meta.set(HASH_KEY, encodeRecord(record));
  return { content: render(merged), kept, replaced, keysKept };
}
__name(merge, "merge");

// src/setup.ts
var NAME_PATTERN = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
var COMMANDS = {
  "--list-coverage": "list-coverage",
  "--check-fragments": "check-fragments",
  "--scaffold-fragments": "scaffold-fragments",
  "--list-mcp": "list-mcp",
  "--prune-tools": "prune-tools",
  "--rewrite-roles": "rewrite-roles",
  "--check": "check",
  "--write": "write"
};
function splitList(value) {
  return [
    ...new Set(
      value.split(",").map((entry) => entry.trim()).filter((entry) => entry !== "")
    )
  ];
}
__name(splitList, "splitList");
function requireValue(value, field) {
  if (value === void 0 || value.startsWith("--")) {
    throw new Error(`${field}: is required`);
  }
  return value;
}
__name(requireValue, "requireValue");
function parseArgs(argv) {
  const options = {
    command: "list-coverage",
    dir: process.cwd(),
    lang: "ja",
    name: "",
    role: "",
    model: "",
    effort: void 0,
    mcpServers: void 0,
    mcpDeny: void 0,
    keep: [],
    tools: [],
    roles: void 0
  };
  let command;
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index] ?? "";
    const value = argv[index + 1];
    const known = COMMANDS[arg];
    if (known !== void 0) {
      if (command !== void 0)
        throw new Error(`${arg}: only one command is allowed`);
      command = known;
      continue;
    }
    switch (arg) {
      case "--dir":
        options.dir = path3.resolve(requireValue(value, "dir"));
        break;
      case "--lang":
        options.lang = requireValue(value, "lang");
        break;
      case "--name":
        options.name = requireValue(value, "name");
        break;
      case "--role":
        options.role = requireValue(value, "role");
        break;
      case "--model":
        options.model = requireValue(value, "model");
        break;
      case "--effort":
        options.effort = requireValue(value, "effort");
        break;
      case "--mcp-servers":
        options.mcpServers = splitList(requireValue(value, "mcp-servers"));
        break;
      case "--mcp-deny":
        options.mcpDeny = splitList(requireValue(value, "mcp-deny"));
        break;
      case "--keep":
        options.keep = splitList(requireValue(value, "keep"));
        break;
      case "--tools":
        options.tools = splitList(requireValue(value, "tools"));
        break;
      case "--roles":
        options.roles = requireValue(value, "roles").trim();
        break;
      default:
        throw new Error(`Unsupported option: ${arg}`);
    }
    index += 1;
  }
  if (command === void 0) throw new Error("command: is required");
  options.command = command;
  assertLang(options.lang);
  if (options.name !== "" && !NAME_PATTERN.test(options.name)) {
    throw new Error("name: must be lowercase letters, digits and hyphens");
  }
  if (["prune-tools", "rewrite-roles", "check", "write"].includes(command) && options.name === "") {
    throw new Error("name: is required");
  }
  if (command === "prune-tools" && options.tools.length === 0) {
    throw new Error("tools: is required");
  }
  if (command === "rewrite-roles" && options.roles === void 0) {
    throw new Error("roles: is required");
  }
  return options;
}
__name(parseArgs, "parseArgs");
function relative(options, file) {
  return path3.relative(options.dir, file).split(path3.sep).join("/");
}
__name(relative, "relative");
function definitionPath(options) {
  return path3.join(options.dir, ".claude", "agents", `${options.name}.md`);
}
__name(definitionPath, "definitionPath");
function disallowedToolsOf(entry, allowed) {
  if (allowed === void 0) return [];
  if (entry.toolsFormat === "none") return ["*"];
  return (entry.tools ?? []).filter(
    (tool) => !tool.startsWith("mcp__") && !allowed.includes(tool)
  );
}
__name(disallowedToolsOf, "disallowedToolsOf");
function listCoverage(options) {
  const fragments = loadFragments(pluginRoot(), options.dir, options.lang);
  const definitions = scanDefinitions(options.dir);
  const { duplicates, unknownRoles } = inspect(definitions);
  const roles = ROLES.map((role) => {
    const fragment = fragments.get(role.id);
    return {
      id: role.id,
      label: fragment?.label ?? role.label,
      kind: role.kind,
      reason: role.reason,
      model: role.model,
      effort: role.effort,
      defaultName: fragment?.defaultName ?? "",
      coveredBy: definitions.filter((entry) => entry.role === role.id).map((entry) => entry.file)
    };
  });
  return {
    ok: true,
    roles,
    uncovered: roles.filter((role) => role.coveredBy.length === 0).map((role) => role.id),
    definitions: definitions.map((entry) => {
      const role = roleById(entry.role);
      return {
        file: entry.file,
        name: entry.name,
        role: entry.role,
        model: entry.model ?? null,
        effort: entry.effort ?? null,
        known: role !== void 0,
        disallowedTools: disallowedToolsOf(
          entry,
          role === void 0 ? void 0 : fragments.get(role.id)?.tools
        ),
        toolsFormat: entry.toolsFormat
      };
    }),
    duplicates: duplicates.map((entry) => ({
      role: entry.role,
      files: definitions.filter((definition) => definition.role === entry.role).map((definition) => definition.file)
    })),
    unknownRoles: unknownRoles.map((entry) => ({
      file: entry.file,
      role: entry.role
    }))
  };
}
__name(listCoverage, "listCoverage");
function readDefinition(options) {
  const file = definitionPath(options);
  const target = relative(options, file);
  if (!fs3.existsSync(file)) throw new Error(`target: ${target} does not exist`);
  const lines = fs3.readFileSync(file, "utf8").split("\n");
  const close = lines[0]?.trim() === "---" ? lines.indexOf("---", 1) : -1;
  if (close === -1) throw new Error(`target: ${target} has no frontmatter`);
  return { file, target, lines, close };
}
__name(readDefinition, "readDefinition");
function keyLineIndex(definition, key) {
  if (keyLineAmbiguous(definition.lines, definition.close, key)) {
    throw new Error(
      `${key}: the ${key} line of ${definition.target} is not a single unindented line`
    );
  }
  return keyLinesOf(definition.lines, definition.close, key)[0] ?? -1;
}
__name(keyLineIndex, "keyLineIndex");
function pruneTools(options) {
  const definition = readDefinition(options);
  const index = keyLineIndex(definition, "tools");
  if (index === -1)
    throw new Error(`tools: ${definition.target} has no tools line`);
  const line = definition.lines[index] ?? "";
  const value = line.slice(line.indexOf(":") + 1).trim();
  if (value === "" || /^[[{|>]/.test(value) || /["'()#]/.test(value)) {
    throw new Error(
      `tools: ${definition.target} uses an unsupported tools format; only a single comma-separated line is rewritten`
    );
  }
  const current = splitList(value);
  const warnings = options.tools.filter((tool) => !current.includes(tool)).map((tool) => `tools: ${tool} is not in the tools line`);
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
      `tools: every tool of ${definition.target} would be removed`
    );
  }
  definition.lines[index] = `tools: ${remaining.join(", ")}`;
  fs3.writeFileSync(definition.file, definition.lines.join("\n"));
  return {
    ok: true,
    target: definition.target,
    changed: true,
    warnings,
    toolsBefore: current,
    toolsAfter: remaining
  };
}
__name(pruneTools, "pruneTools");
function rewriteRoles(options) {
  const definition = readDefinition(options);
  const roles = options.roles ?? "";
  if (roles !== "" && roleById(roles) === void 0) {
    throw new Error(`roles: ${roles} is not a role id`);
  }
  const index = keyLineIndex(definition, ROLE_KEY);
  if (index === -1) {
    throw new Error(`roles: ${definition.target} has no ${ROLE_KEY} line`);
  }
  const line = definition.lines[index] ?? "";
  const before = line.slice(line.indexOf(":") + 1).trim();
  if (roles === "") definition.lines.splice(index, 1);
  else definition.lines[index] = `${ROLE_KEY}: ${roles}`;
  const changed = roles !== before;
  if (changed) fs3.writeFileSync(definition.file, definition.lines.join("\n"));
  return {
    ok: true,
    target: definition.target,
    changed,
    before,
    after: roles === "" ? null : roles
  };
}
__name(rewriteRoles, "rewriteRoles");
function effortOf(options, role) {
  if (options.effort === void 0) return role.effort;
  if (options.effort === "none") return void 0;
  if (!isEffort(options.effort)) {
    throw new Error(
      `effort: ${options.effort} is not one of low, medium, high, xhigh, max, none`
    );
  }
  return options.effort;
}
__name(effortOf, "effortOf");
function existingMcpTools(existingRaw) {
  if (existingRaw === void 0) return [];
  const tools = parseDocument(existingRaw).meta.get("tools") ?? "";
  return splitList(tools.replace(/\n\s*-\s*/g, ",")).filter(
    (tool) => tool.startsWith("mcp__")
  );
}
__name(existingMcpTools, "existingMcpTools");
function resolveMcp(options, existingRaw) {
  if (options.mcpServers === void 0) {
    return { tools: existingMcpTools(existingRaw), dropped: [] };
  }
  if (options.mcpServers.length === 0) return { tools: [], dropped: [] };
  const usable = new Set(
    listMcpServers(process.env).filter((server) => server.usable).map((server) => toolPrefix(server.name))
  );
  const tools = [];
  const dropped = [];
  for (const name of options.mcpServers) {
    const prefixed = toolPrefix(name);
    if (usable.has(prefixed)) tools.push(prefixed);
    else dropped.push(name);
  }
  return { tools, dropped };
}
__name(resolveMcp, "resolveMcp");
function prepare(options) {
  const role = roleById(options.role);
  if (role === void 0)
    throw new Error(`role: ${options.role} is not a role id`);
  if (!isClaudeModel(options.model)) {
    throw new Error(
      `model: ${options.model} is not one of sonnet, opus, haiku, fable`
    );
  }
  const status = checkFragments(pluginRoot(), options.dir, options.lang);
  if (status.missing.length > 0 || status.stale.length > 0) {
    throw new Error(
      `fragments: translation for "${options.lang}" is incomplete. missing=${status.missing.join(", ")} stale=${status.stale.join(", ")}. Run --scaffold-fragments and translate them first`
    );
  }
  const file = definitionPath(options);
  const target = relative(options, file);
  const existingRaw = fs3.existsSync(file) ? fs3.readFileSync(file, "utf8") : void 0;
  if (existingRaw !== void 0) {
    const duplicated = duplicateHeadings(existingRaw);
    if (duplicated.length > 0) {
      throw new Error(
        `target: ${target} has duplicated headings (${duplicated.join(", ")}); merge them by hand first`
      );
    }
  }
  const effort = effortOf(options, role);
  const mcp = resolveMcp(options, existingRaw);
  const mcpCurrent = existingRaw === void 0 ? { servers: [], denyTools: [] } : mcpCurrentOf(existingRaw);
  const template = compose({
    name: options.name,
    roleId: role.id,
    model: options.model,
    effort,
    lang: options.lang,
    pluginRoot: pluginRoot(),
    projectDir: options.dir,
    mcpTools: mcp.tools,
    denyTools: options.mcpDeny ?? mcpCurrent.denyTools
  });
  return {
    file,
    target,
    role,
    existingRaw,
    template,
    effort,
    mcpCurrent,
    mcpDropped: mcp.dropped
  };
}
__name(prepare, "prepare");
function keepKeys(options, existingRaw) {
  if (options.keep.length === 0) return /* @__PURE__ */ new Set();
  if (existingRaw === void 0)
    throw new Error("keep: there is no existing file to keep from");
  const existing = parseDocument(existingRaw);
  const keys = options.keep.map(
    (name) => name === "description" || name === "preamble" ? name : `## ${name}`
  );
  const missing = keys.filter(
    (key) => key.startsWith("## ") && !existing.sections.has(key)
  );
  if (missing.length > 0) {
    throw new Error(
      `keep: not found in the existing file: ${missing.join(", ")}`
    );
  }
  return new Set(keys);
}
__name(keepKeys, "keepKeys");
function adopting(existingRaw) {
  return existingRaw !== void 0 && !parseDocument(existingRaw).meta.has(ROLE_KEY);
}
__name(adopting, "adopting");
function check(options) {
  const generation = prepare(options);
  const { existingRaw } = generation;
  return {
    ok: true,
    target: generation.target,
    exists: existingRaw !== void 0,
    adopt: adopting(existingRaw),
    sections: existingRaw === void 0 ? [] : compare(existingRaw, generation.template),
    keysKept: existingRaw === void 0 ? [] : merge({
      existingRaw,
      templateRaw: generation.template,
      keep: /* @__PURE__ */ new Set()
    }).keysKept,
    mcpCurrent: generation.mcpCurrent,
    effort: generation.effort ?? null
  };
}
__name(check, "check");
function write(options) {
  const generation = prepare(options);
  const { existingRaw } = generation;
  const keep = keepKeys(options, existingRaw);
  const result = existingRaw === void 0 ? { content: generation.template, kept: [], replaced: [], keysKept: [] } : merge({ existingRaw, templateRaw: generation.template, keep });
  fs3.mkdirSync(path3.dirname(generation.file), { recursive: true });
  fs3.writeFileSync(generation.file, result.content);
  return {
    ok: true,
    target: generation.target,
    action: existingRaw === void 0 ? "written" : adopting(existingRaw) ? "adopted" : "regenerated",
    kept: result.kept,
    replaced: result.replaced,
    keysKept: result.keysKept,
    toolsAfter: splitList(
      parseDocument(result.content).meta.get("tools") ?? ""
    ),
    mcpDropped: generation.mcpDropped
  };
}
__name(write, "write");
function run(options) {
  switch (options.command) {
    case "list-coverage":
      return listCoverage(options);
    case "check-fragments":
      return {
        ok: true,
        ...checkFragments(pluginRoot(), options.dir, options.lang)
      };
    case "scaffold-fragments":
      return {
        ok: true,
        lang: options.lang,
        written: scaffoldFragments(pluginRoot(), options.dir, options.lang).map(
          (file) => relative(options, file)
        )
      };
    case "list-mcp":
      return { ok: true, servers: listMcpServers(process.env) };
    case "prune-tools":
      return pruneTools(options);
    case "rewrite-roles":
      return rewriteRoles(options);
    case "check":
      return check(options);
    case "write":
      return write(options);
  }
}
__name(run, "run");
try {
  process.stdout.write(
    `${JSON.stringify(run(parseArgs(process.argv.slice(2))))}
`
  );
} catch (error) {
  process.stdout.write(
    `${JSON.stringify({
      ok: false,
      error: error instanceof Error ? error.message : "Unexpected error"
    })}
`
  );
  process.exitCode = 1;
}
export {
  definitionPath,
  splitList
};
