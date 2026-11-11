#!/usr/bin/env node
var __defProp = Object.defineProperty;
var __name = (target, value) => __defProp(target, "name", { value, configurable: true });

// src/lib/agents.ts
import fs2 from "node:fs";
import path2 from "node:path";

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
function roleById(id) {
  return ROLES.find((role) => role.id === id);
}
__name(roleById, "roleById");
function rolesFor(reason) {
  return ROLES.filter((role) => role.reason === reason);
}
__name(rolesFor, "rolesFor");
function isClaudeModel(value) {
  return CLAUDE_MODELS.includes(value);
}
__name(isClaudeModel, "isClaudeModel");

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

// src/lib/config.ts
import fs3 from "node:fs";
import path3 from "node:path";
var CONFIG_FILE = ".claude/better-agentics/config.json";
function validate(value) {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return "the top level must be an object";
  }
  const roles = value.disabledRoles;
  if (!Array.isArray(roles) || !roles.every((role) => typeof role === "string")) {
    return "disabledRoles must be an array of role IDs";
  }
  const unknown = roles.filter((role) => roleById(role) === void 0);
  if (unknown.length > 0) {
    return `disabledRoles contains unknown role IDs: ${unknown.join(", ")}`;
  }
  return { disabledRoles: roles };
}
__name(validate, "validate");
function readConfig(projectDir) {
  const file = path3.join(projectDir, CONFIG_FILE);
  if (!fs3.existsSync(file)) return { kind: "absent" };
  let raw;
  try {
    raw = fs3.readFileSync(file, "utf8");
  } catch (error) {
    return {
      kind: "invalid",
      message: `${CONFIG_FILE} could not be read: ${error instanceof Error ? error.message : String(error)}`,
      raw: null
    };
  }
  let parsed;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return { kind: "invalid", message: `${CONFIG_FILE} is not valid JSON`, raw };
  }
  const result = validate(parsed);
  return typeof result === "string" ? { kind: "invalid", message: `${CONFIG_FILE}: ${result}`, raw } : { kind: "ok", config: result };
}
__name(readConfig, "readConfig");
function disabledRolesOf(state) {
  return state.kind === "ok" ? state.config.disabledRoles : [];
}
__name(disabledRolesOf, "disabledRolesOf");

// ../../node_modules/.pnpm/@typesafe-ai+sdk@0.6.0/node_modules/@typesafe-ai/sdk/dist/index.mjs
var requestIdFrom = /* @__PURE__ */ __name((headers) => headers.get("x-typesafe-request-id") ?? void 0, "requestIdFrom");
var APIPromise = class APIPromise2 extends Promise {
  static {
    __name(this, "APIPromise");
  }
  #responsePromise;
  #parseResponse;
  #parsed;
  constructor(responsePromise, parseResponse) {
    super((resolve) => resolve(void 0));
    this.#responsePromise = responsePromise;
    this.#parseResponse = parseResponse;
  }
  /**
  * Resolves to the raw `Response` without parsing the body. SDK requests buffer the full
  * body under the request timeout before handoff; reading it afterwards is caller-owned.
  * The caller owns the body; don't also `await` the parsed result on the same promise.
  */
  asResponse() {
    return this.#responsePromise;
  }
  /** Return the parsed result, HTTP response, and request ID. */
  async withResponse() {
    const [data, response] = await Promise.all([this.#parse(), this.#responsePromise]);
    return {
      data,
      response,
      requestId: requestIdFrom(response.headers)
    };
  }
  /** Transform the parsed result, sharing the HTTP response and a single body parse. */
  map(fn) {
    return new APIPromise2(this.#responsePromise, () => this.#parse().then(fn));
  }
  #parse() {
    this.#parsed ??= this.#responsePromise.then(this.#parseResponse);
    return this.#parsed;
  }
  then(onfulfilled, onrejected) {
    return this.#parse().then(onfulfilled, onrejected);
  }
  catch(onrejected) {
    return this.#parse().catch(onrejected);
  }
  finally(onfinally) {
    return this.#parse().finally(onfinally);
  }
};
var ENV = {
  /** Required API key; used when `apiKey` is omitted. */
  apiKey: "TYPESAFE_API_KEY",
  /** API root; defaults to `https://api.typesafe.ai`. */
  baseURL: "TYPESAFE_BASE_URL",
  /** Default model name; defaults to `jev-latest`. */
  defaultModel: "TYPESAFE_DEFAULT_MODEL",
  /** Log level; defaults to `warn`. */
  logLevel: "TYPESAFE_LOG_LEVEL"
};
var readEnv = /* @__PURE__ */ __name((name) => {
  if (typeof process === "undefined" || !process.env) return void 0;
  return process.env[name]?.trim() || void 0;
}, "readEnv");
var fromCodeOrEnv = /* @__PURE__ */ __name((fromCode, envVar) => fromCode ?? readEnv(envVar), "fromCodeOrEnv");
var range = /* @__PURE__ */ __name((from, to) => Array.from({ length: to - from }, (_, i) => from + i), "range");
var DEFAULT_RETRY_POLICY = {
  maxRetries: 2,
  backoffInitialMs: 500,
  backoffMaxMs: 5e3,
  backoffJitter: 0.25,
  /** HTTP 408, 429, and 5xx responses. */
  httpStatuses: /* @__PURE__ */ new Set([
    408,
    429,
    ...range(500, 600)
  ]),
  respectRetryAfter: true,
  /** Maximum server retry delay before falling back to backoff. */
  maxRetryAfterMs: 6e4,
  apiConnectionError: true,
  apiTimeoutError: true
};
DEFAULT_RETRY_POLICY.maxRetries;
var isRetryableStatus = /* @__PURE__ */ __name((status, policy2 = DEFAULT_RETRY_POLICY) => policy2.httpStatuses.has(status), "isRetryableStatus");
var parseRetryAfter = /* @__PURE__ */ __name((headers, now = Date.now()) => {
  const ms = Number(headers.get("retry-after-ms"));
  if (headers.has("retry-after-ms") && Number.isFinite(ms) && ms >= 0) return ms;
  const raw = headers.get("retry-after");
  if (raw === null) return void 0;
  const seconds = Number(raw);
  if (Number.isFinite(seconds)) return seconds >= 0 ? seconds * 1e3 : void 0;
  const date = Date.parse(raw);
  if (!Number.isNaN(date)) return Math.max(0, date - now);
}, "parseRetryAfter");
var retryDelayMs = /* @__PURE__ */ __name((attempt, headers, policy2 = DEFAULT_RETRY_POLICY, random = Math.random) => {
  if (policy2.respectRetryAfter && headers !== void 0) {
    const retryAfter = parseRetryAfter(headers);
    if (retryAfter !== void 0 && retryAfter <= policy2.maxRetryAfterMs) return retryAfter;
  }
  const exponential = Math.min(policy2.backoffInitialMs * 2 ** attempt, policy2.backoffMaxMs);
  return Math.round(exponential * (1 - random() * policy2.backoffJitter));
}, "retryDelayMs");
var sleep = /* @__PURE__ */ __name((ms, signal) => new Promise((resolve, reject) => {
  if (signal?.aborted) return reject(signal.reason);
  const onAbort = /* @__PURE__ */ __name(() => {
    clearTimeout(timer);
    reject(signal?.reason);
  }, "onAbort");
  const timer = setTimeout(() => {
    signal?.removeEventListener("abort", onAbort);
    resolve();
  }, ms);
  signal?.addEventListener("abort", onAbort, { once: true });
}), "sleep");
var TypeSafeError = class extends Error {
  static {
    __name(this, "TypeSafeError");
  }
  constructor(message, options) {
    super(message, options);
    this.name = new.target.name;
  }
};
var isRecord = /* @__PURE__ */ __name((value) => typeof value === "object" && value !== null, "isRecord");
var extractMessage = /* @__PURE__ */ __name((body) => {
  if (typeof body === "string") return body || void 0;
  if (!isRecord(body)) return void 0;
  const { error, message, detail } = body;
  if (typeof error === "string") return error;
  if (isRecord(error) && typeof error.message === "string") return error.message;
  if (typeof message === "string") return message;
  if (typeof detail === "string") return detail;
  if (isRecord(detail) && typeof detail.message === "string") return detail.message;
  if (Array.isArray(detail)) return describeValidationErrors(detail);
}, "extractMessage");
var describeValidationErrors = /* @__PURE__ */ __name((errors) => {
  const parts = errors.flatMap((e) => {
    if (!isRecord(e) || typeof e.msg !== "string") return [];
    const loc = Array.isArray(e.loc) ? e.loc.filter((x) => x !== "body").join(".") : "";
    return [loc ? `${loc}: ${e.msg}` : e.msg];
  });
  return parts.length > 0 ? parts.join("; ") : void 0;
}, "describeValidationErrors");
var MAX_RAW_BODY_IN_MESSAGE = 200;
var APIError = class APIError2 extends TypeSafeError {
  static {
    __name(this, "APIError");
  }
  /** HTTP response status code. */
  status;
  /** HTTP response headers. */
  headers;
  /** Parsed JSON, response text, or `undefined` for an empty body. */
  body;
  /** Request ID from `x-typesafe-request-id`, or `undefined` when absent. */
  requestId;
  constructor(status, body, headers, message) {
    super(message ?? APIError2.describe(status, body));
    this.status = status;
    this.body = body;
    this.headers = headers;
    this.requestId = requestIdFrom(headers);
  }
  static describe(status, body) {
    const detail = extractMessage(body);
    if (detail) return `${status} ${detail}`;
    if (body === void 0) return `${status} status code (no body)`;
    const raw = typeof body === "string" ? body : JSON.stringify(body);
    return `${status} ${raw.length > MAX_RAW_BODY_IN_MESSAGE ? `${raw.slice(0, MAX_RAW_BODY_IN_MESSAGE)}\u2026` : raw}`;
  }
  /** Create the error subclass for an HTTP status code. */
  static fromResponse(status, body, headers) {
    if (status === 400) return new BadRequestError(status, body, headers);
    if (status === 401) return new AuthenticationError(status, body, headers);
    if (status === 403) return new PermissionDeniedError(status, body, headers);
    if (status === 404) return new NotFoundError(status, body, headers);
    if (status === 422) return new UnprocessableEntityError(status, body, headers);
    if (status === 429) return new RateLimitError(status, body, headers);
    if (status >= 500) return new InternalServerError(status, body, headers);
    return new APIError2(status, body, headers);
  }
};
var BadRequestError = class extends APIError {
  static {
    __name(this, "BadRequestError");
  }
};
var AuthenticationError = class extends APIError {
  static {
    __name(this, "AuthenticationError");
  }
};
var PermissionDeniedError = class extends APIError {
  static {
    __name(this, "PermissionDeniedError");
  }
};
var NotFoundError = class extends APIError {
  static {
    __name(this, "NotFoundError");
  }
};
var UnprocessableEntityError = class extends APIError {
  static {
    __name(this, "UnprocessableEntityError");
  }
};
var RateLimitError = class extends APIError {
  static {
    __name(this, "RateLimitError");
  }
  /** Server retry delay in milliseconds, or `undefined` when absent or invalid. */
  retryAfterMs = parseRetryAfter(this.headers);
};
var InternalServerError = class extends APIError {
  static {
    __name(this, "InternalServerError");
  }
};
var APIConnectionError = class extends TypeSafeError {
  static {
    __name(this, "APIConnectionError");
  }
  constructor(message = "Connection error.", options) {
    super(message, options);
  }
};
var APITimeoutError = class extends APIConnectionError {
  static {
    __name(this, "APITimeoutError");
  }
  /** Configured timeout in milliseconds. */
  timeoutMs;
  constructor(timeoutMs, options) {
    super(`Request timed out after ${timeoutMs}ms.`, options);
    this.timeoutMs = timeoutMs;
  }
};
var APIUserAbortError = class extends TypeSafeError {
  static {
    __name(this, "APIUserAbortError");
  }
  constructor(message = "Request was aborted.", options) {
    super(message, options);
  }
};
var LOG_LEVELS = [
  "debug",
  "info",
  "warn",
  "error",
  "off"
];
var DEFAULT_LOG_LEVEL = "warn";
var isLogLevel = /* @__PURE__ */ __name((value) => LOG_LEVELS.includes(value), "isLogLevel");
var parseLogLevel = /* @__PURE__ */ __name((value, source) => {
  if (isLogLevel(value)) return value;
  throw new TypeSafeError(`Invalid log level "${value}" from ${source}. Expected one of: ${LOG_LEVELS.join(", ")}.`);
}, "parseLogLevel");
var PREFIX = "[typesafe-sdk]";
var consoleLogger = {
  debug: /* @__PURE__ */ __name((message, ...args) => console.debug(`${PREFIX} ${message}`, ...args), "debug"),
  info: /* @__PURE__ */ __name((message, ...args) => console.info(`${PREFIX} ${message}`, ...args), "info"),
  warn: /* @__PURE__ */ __name((message, ...args) => console.warn(`${PREFIX} ${message}`, ...args), "warn"),
  error: /* @__PURE__ */ __name((message, ...args) => console.error(`${PREFIX} ${message}`, ...args), "error")
};
var RANK = {
  debug: 0,
  info: 1,
  warn: 2,
  error: 3,
  off: 4
};
var drop = /* @__PURE__ */ __name(() => {
}, "drop");
var withLevel = /* @__PURE__ */ __name((sink, level) => {
  const enabled = /* @__PURE__ */ __name((at) => RANK[at] >= RANK[level], "enabled");
  return {
    debug: enabled("debug") ? (message, ...args) => sink.debug(message, ...args) : drop,
    info: enabled("info") ? (message, ...args) => sink.info(message, ...args) : drop,
    warn: enabled("warn") ? (message, ...args) => sink.warn(message, ...args) : drop,
    error: enabled("error") ? (message, ...args) => sink.error(message, ...args) : drop
  };
}, "withLevel");
var KEY_HEADERS = /* @__PURE__ */ new Set([
  "authorization",
  "proxy-authorization",
  "x-api-key"
]);
var OPAQUE_HEADERS = /* @__PURE__ */ new Set(["cookie", "set-cookie"]);
var redactKey = /* @__PURE__ */ __name((value) => {
  const [scheme, secret] = value.includes(" ") ? value.split(/\s+/, 2) : [void 0, value];
  const tail = secret && secret.length > 8 ? secret.slice(-4) : "";
  return `${scheme ? `${scheme} ` : ""}***${tail}`;
}, "redactKey");
var redact = /* @__PURE__ */ __name((name, value) => {
  const lower = name.toLowerCase();
  if (KEY_HEADERS.has(lower)) return redactKey(value);
  if (OPAQUE_HEADERS.has(lower)) return "***";
  return value;
}, "redact");
var redactHeaders = /* @__PURE__ */ __name((headers) => Object.fromEntries(Object.entries(headers).map(([name, value]) => [name, redact(name, value)])), "redactHeaders");
var noul = /* @__PURE__ */ __name((instructions = null, criteria) => ({
  type: "noul",
  instructions,
  criteria
}), "noul");
var choice = /* @__PURE__ */ __name((instructions, criteria) => {
  if (Array.isArray(criteria)) throw new TypeSafeError("Choice criteria must be a map of labels to descriptions, not a list.");
  return {
    type: "choice",
    instructions,
    criteria
  };
}, "choice");
var validateQuestions = /* @__PURE__ */ __name((questions) => {
  if (Object.keys(questions).length === 0) throw new TypeSafeError("At least one question is required.");
  for (const [name, question] of Object.entries(questions)) {
    if (question.type !== "score") continue;
    if (!Array.isArray(question.criteria)) throw new TypeSafeError(`Score question "${name}" has criteria that are not a list; score criteria must be a list of descriptions indexed by score from zero.`);
    if (question.criteria.length < 2) throw new TypeSafeError(`Score question "${name}" has ${question.criteria.length} criteria; at least two scores are required.`);
  }
}, "validateQuestions");
var Models = class {
  static {
    __name(this, "Models");
  }
  #transport;
  constructor(transport) {
    this.#transport = transport;
  }
  /** List the models available to the account. */
  list(options = {}) {
    return this.#transport.request("GET", "/v1/models", options).map(unwrapModels);
  }
};
var unwrapModels = /* @__PURE__ */ __name((wire) => {
  if (Array.isArray(wire?.models)) return wire.models;
  throw new TypeSafeError("Unexpected response shape from GET /v1/models; expected { models: [...] }.");
}, "unwrapModels");
var g = globalThis;
var isBrowser = /* @__PURE__ */ __name(() => typeof g.window !== "undefined" && typeof g.window.document !== "undefined" && typeof g.navigator !== "undefined", "isBrowser");
var describeRuntime = /* @__PURE__ */ __name(() => {
  const platform = g.process?.platform && g.process?.arch ? ` (${g.process.platform}; ${g.process.arch})` : "";
  if (g.Bun?.version) return `bun/${g.Bun.version}${platform}`;
  if (g.Deno?.version?.deno) return `deno/${g.Deno.version.deno}${platform}`;
  if (g.EdgeRuntime !== void 0) return "vercel-edge";
  if (g.navigator?.userAgent === "Cloudflare-Workers") return "cloudflare-workers";
  if (g.process?.versions?.node) return `node/${g.process.versions.node}${platform}`;
  if (isBrowser()) return "browser";
  return "unknown";
}, "describeRuntime");
var VERSION = "0.6.0";
var missingApiKey = /* @__PURE__ */ __name(() => {
  throw new TypeSafeError(`No API key was provided. Pass \`apiKey\` to the TypeSafeClient constructor or set the ${ENV.apiKey} environment variable.`);
}, "missingApiKey");
var missingFetch = /* @__PURE__ */ __name(() => {
  throw new TypeSafeError("No global `fetch` is available in this runtime. Pass a `fetch` implementation to the TypeSafeClient constructor.");
}, "missingFetch");
var refuseBrowser = /* @__PURE__ */ __name(() => {
  throw new TypeSafeError("TypeSafeClient is running in a browser, which would expose your API key to anyone using the page. Call the API from a server instead, or pass `dangerouslyAllowBrowser: true` if you understand the risk.");
}, "refuseBrowser");
var defaultFetch = /* @__PURE__ */ __name((input, init) => globalThis.fetch(input, init), "defaultFetch");
var assertNonNegativeInteger = /* @__PURE__ */ __name((name, value) => {
  if (!Number.isInteger(value) || value < 0) throw new TypeSafeError(`\`${name}\` must be a non-negative integer, got ${String(value)}.`);
  return value;
}, "assertNonNegativeInteger");
var assertPositiveMs = /* @__PURE__ */ __name((name, value) => {
  if (!Number.isFinite(value) || value <= 0) throw new TypeSafeError(`\`${name}\` must be a positive number of milliseconds, got ${String(value)}.`);
  return value;
}, "assertPositiveMs");
var assertNonNegativeMs = /* @__PURE__ */ __name((name, value) => {
  if (!Number.isFinite(value) || value < 0) throw new TypeSafeError(`\`${name}\` must be a non-negative number of milliseconds, got ${String(value)}.`);
  return value;
}, "assertNonNegativeMs");
var assertFraction = /* @__PURE__ */ __name((name, value) => {
  if (!Number.isFinite(value) || value < 0 || value > 1) throw new TypeSafeError(`\`${name}\` must be between 0 and 1, got ${String(value)}.`);
  return value;
}, "assertFraction");
var assertStatusSet = /* @__PURE__ */ __name((name, statuses) => {
  for (const status of statuses) if (!Number.isInteger(status) || status < 100 || status > 999) throw new TypeSafeError(`\`${name}\` must contain HTTP status codes, got ${String(status)}.`);
  return statuses;
}, "assertStatusSet");
var resolveRetryPolicy = /* @__PURE__ */ __name((base, overrides) => {
  const o = overrides ?? {};
  return {
    maxRetries: o.maxRetries === void 0 ? base.maxRetries : assertNonNegativeInteger("retry.maxRetries", o.maxRetries),
    backoffInitialMs: o.backoffInitialMs === void 0 ? base.backoffInitialMs : assertNonNegativeMs("retry.backoffInitialMs", o.backoffInitialMs),
    backoffMaxMs: o.backoffMaxMs === void 0 ? base.backoffMaxMs : assertNonNegativeMs("retry.backoffMaxMs", o.backoffMaxMs),
    backoffJitter: o.backoffJitter === void 0 ? base.backoffJitter : assertFraction("retry.backoffJitter", o.backoffJitter),
    httpStatuses: new Set(o.httpStatuses === void 0 ? base.httpStatuses : assertStatusSet("retry.httpStatuses", o.httpStatuses)),
    respectRetryAfter: o.respectRetryAfter ?? base.respectRetryAfter,
    maxRetryAfterMs: o.maxRetryAfterMs === void 0 ? base.maxRetryAfterMs : assertNonNegativeMs("retry.maxRetryAfterMs", o.maxRetryAfterMs),
    apiConnectionError: o.apiConnectionError ?? base.apiConnectionError,
    apiTimeoutError: o.apiTimeoutError ?? base.apiTimeoutError
  };
}, "resolveRetryPolicy");
var isRetryableError = /* @__PURE__ */ __name((err, policy2) => {
  if (err instanceof APITimeoutError) return policy2.apiTimeoutError;
  if (err instanceof APIConnectionError) return policy2.apiConnectionError;
  return false;
}, "isRetryableError");
var resolveLogLevel = /* @__PURE__ */ __name((fromCode) => {
  if (fromCode !== void 0) return parseLogLevel(fromCode, "the `logLevel` option");
  const fromEnv = readEnv(ENV.logLevel);
  if (fromEnv !== void 0) return parseLogLevel(fromEnv, ENV.logLevel);
  return DEFAULT_LOG_LEVEL;
}, "resolveLogLevel");
var stripTrailingSlashes = /* @__PURE__ */ __name((url) => url.replace(/\/+$/, ""), "stripTrailingSlashes");
var mergeHeaders = /* @__PURE__ */ __name((...sources) => {
  const entries = /* @__PURE__ */ new Map();
  for (const source of sources) for (const [name, value] of Object.entries(source)) if (value === void 0) entries.delete(name.toLowerCase());
  else entries.set(name.toLowerCase(), [name, value]);
  return Object.fromEntries(entries.values());
}, "mergeHeaders");
var bufferResponse = /* @__PURE__ */ __name(async (response, signal) => {
  const reader = response.clone().body?.getReader();
  if (!reader) return;
  const cancel = /* @__PURE__ */ __name(() => {
    reader.cancel(signal.reason).catch(() => {
    });
    response.body?.cancel(signal.reason).catch(() => {
    });
  }, "cancel");
  signal.addEventListener("abort", cancel, { once: true });
  try {
    if (signal.aborted) cancel();
    signal.throwIfAborted();
    while (!(await reader.read()).done) signal.throwIfAborted();
    signal.throwIfAborted();
  } finally {
    signal.removeEventListener("abort", cancel);
    reader.releaseLock();
  }
}, "bufferResponse");
var RUNTIME = describeRuntime();
var TypeSafeClient = class {
  static {
    __name(this, "TypeSafeClient");
  }
  /** API key excluded from serialization and public properties. */
  #apiKey;
  /** API root with trailing slashes removed. */
  baseURL;
  /** Model used when a request omits `model`. */
  defaultModel;
  /** Configured log verbosity. */
  logLevel;
  /** The configured logger, filtered to `logLevel`. */
  logger;
  /** Retry settings with constructor overrides applied. */
  retry;
  /** Timeout per attempt in milliseconds. */
  timeout;
  /** Additional headers sent with each request. */
  defaultHeaders;
  /** HTTP fetch implementation. */
  fetch;
  /** The models available to the account. */
  models;
  #requestCount = 0;
  /**
  * Create a client for the TypeSafe AI API.
  *
  * Explicit options take precedence over environment variables, then SDK defaults.
  * Empty or whitespace-only environment values are ignored.
  *
  * @throws {TypeSafeError} The API key is missing, configuration is invalid, or the runtime is unsupported.
  */
  constructor(config = {}) {
    if (isBrowser() && !config.dangerouslyAllowBrowser) refuseBrowser();
    this.#apiKey = fromCodeOrEnv(config.apiKey, ENV.apiKey) ?? missingApiKey();
    this.baseURL = stripTrailingSlashes(fromCodeOrEnv(config.baseURL, ENV.baseURL) ?? "https://api.typesafe.ai");
    this.defaultModel = fromCodeOrEnv(config.defaultModel, ENV.defaultModel) ?? "jev-latest";
    this.logLevel = resolveLogLevel(config.logLevel);
    this.logger = withLevel(config.logger ?? consoleLogger, this.logLevel);
    this.retry = resolveRetryPolicy(DEFAULT_RETRY_POLICY, config.retry);
    this.timeout = assertPositiveMs("timeout", config.timeout ?? 1e4);
    this.defaultHeaders = { ...config.defaultHeaders };
    if (config.fetch === void 0 && typeof globalThis.fetch !== "function") missingFetch();
    this.fetch = config.fetch ?? defaultFetch;
    const transport = {
      request: /* @__PURE__ */ __name((method, path5, options) => this.#request(method, path5, options), "request"),
      defaultModel: this.defaultModel
    };
    this.models = new Models(transport);
  }
  /**
  * Answer named questions about text or structured state.
  *
  * @param request - State, questions, and an optional model override.
  * @param options - Per-call timeout, retry, headers, and cancellation settings.
  * @returns Answers typed by question name and criteria, with model and token usage.
  * @throws {TypeSafeError} Questions are empty, or score criteria are not a list of at least two entries.
  * @throws {APIError} The server returns a non-2xx response after retries.
  * @throws {APIConnectionError} The request cannot connect or times out after retries.
  * @throws {APIUserAbortError} The caller aborts the request.
  *
  * @example
  * ```ts
  * const { answers } = await client.systemOne({
  *   state: "I was charged twice. Please help.",
  *   questions: { billing: noul("Is this about billing?") },
  * });
  * console.log(answers.billing.noul);
  * ```
  */
  systemOne(request, options = {}) {
    validateQuestions(request.questions);
    const body = {
      ...request,
      model: request.model ?? this.defaultModel
    };
    return this.#request("POST", "/v1/systemone", {
      ...options,
      body
    });
  }
  /** Send a request and parse its response body. */
  #request(method, path5, options = {}) {
    const resolved = {
      method,
      path: path5,
      body: options.body,
      headers: mergeHeaders(this.defaultHeaders, options.headers ?? {}),
      signal: options.signal,
      timeout: options.timeout === void 0 ? this.timeout : assertPositiveMs("timeout", options.timeout),
      retry: resolveRetryPolicy(this.retry, options.retry)
    };
    const tag = `#${++this.#requestCount} ${method} ${path5}`;
    return new APIPromise(this.fetchWithRetries(tag, resolved), async (res) => {
      const parsed = await parseBody(res);
      this.logger.debug(`${tag} <- body`, parsed);
      return parsed;
    });
  }
  /** Retry eligible failures, logging attempt summaries at `info` and headers and bodies at `debug`. */
  async fetchWithRetries(tag, req) {
    const url = `${this.baseURL}${req.path}`;
    const headers = mergeHeaders(req.headers, {
      Authorization: `Bearer ${this.#apiKey}`,
      Accept: "application/json",
      "User-Agent": `typesafe-sdk/${VERSION}`,
      "X-TypeSafe-SDK": `typesafe-sdk/${VERSION}`,
      "X-TypeSafe-Runtime": RUNTIME,
      "Content-Type": req.body === void 0 ? void 0 : "application/json",
      "X-TypeSafe-Retry-Count": void 0
    });
    const body = req.body === void 0 ? void 0 : JSON.stringify(req.body);
    for (let attempt = 0; ; attempt++) {
      const retriesLeft = req.retry.maxRetries - attempt;
      const attemptHeaders = attempt === 0 ? headers : {
        ...headers,
        "X-TypeSafe-Retry-Count": String(attempt)
      };
      this.logger.debug(`${tag} -> ${url}`, {
        headers: redactHeaders(attemptHeaders),
        body: req.body
      });
      const started = Date.now();
      let res;
      try {
        res = await this.attempt(tag, url, {
          method: req.method,
          headers: attemptHeaders,
          body
        }, req);
      } catch (err) {
        if (err instanceof APIUserAbortError || retriesLeft <= 0) throw err;
        if (!isRetryableError(err, req.retry)) throw err;
        await this.backOff(tag, attempt, retriesLeft, err.message, void 0, req);
        continue;
      }
      const requestId = requestIdFrom(res.headers);
      this.logger.info(`${tag} <- ${res.status} in ${Date.now() - started}ms${requestId ? ` (request ${requestId})` : ""}`);
      if (res.ok) return res;
      const errorBody = await parseBody(res);
      this.logger.debug(`${tag} <- error body`, errorBody);
      const error = APIError.fromResponse(res.status, errorBody, res.headers);
      if (retriesLeft <= 0 || !isRetryableStatus(res.status, req.retry)) throw error;
      await this.backOff(tag, attempt, retriesLeft, `${res.status}`, res.headers, req);
    }
  }
  /**
  * One HTTP round trip, including body delivery, with a timeout. The caller's signal and our
  * timer both abort the same controller; we check which fired to choose the error class.
  */
  async attempt(tag, url, init, { signal, timeout }) {
    const controller = new AbortController();
    const abortFromCaller = /* @__PURE__ */ __name(() => controller.abort(signal?.reason), "abortFromCaller");
    if (signal?.aborted) abortFromCaller();
    signal?.addEventListener("abort", abortFromCaller, { once: true });
    let timedOut = false;
    const timer = setTimeout(() => {
      timedOut = true;
      controller.abort();
    }, timeout);
    const started = Date.now();
    const elapsed = /* @__PURE__ */ __name(() => `${Date.now() - started}ms`, "elapsed");
    try {
      const response = await this.fetch(url, {
        ...init,
        signal: controller.signal
      });
      await bufferResponse(response, controller.signal);
      return response;
    } catch (err) {
      if (signal?.aborted) {
        this.logger.info(`${tag} aborted by caller after ${elapsed()}`);
        throw new APIUserAbortError(void 0, { cause: err });
      }
      if (timedOut) {
        this.logger.info(`${tag} timed out after ${elapsed()}`);
        throw new APITimeoutError(timeout, { cause: err });
      }
      this.logger.info(`${tag} connection error after ${elapsed()}`, err);
      throw new APIConnectionError(err instanceof Error ? `Connection error: ${err.message}` : void 0, { cause: err });
    } finally {
      clearTimeout(timer);
      signal?.removeEventListener("abort", abortFromCaller);
    }
  }
  /** Wait before retrying; caller cancellation throws `APIUserAbortError`. */
  async backOff(tag, attempt, retriesLeft, reason, headers, { retry, signal }) {
    const delay = retryDelayMs(attempt, headers, retry);
    const nth = attempt + 1;
    const total = attempt + retriesLeft;
    this.logger.info(`${tag} retrying in ${delay}ms (retry ${nth}/${total}) after ${reason}`);
    try {
      await sleep(delay, signal);
    } catch (err) {
      this.logger.info(`${tag} aborted by caller while waiting to retry`);
      throw new APIUserAbortError(void 0, { cause: err });
    }
  }
};
var parseBody = /* @__PURE__ */ __name(async (res) => {
  const text = await res.text();
  if (text.length === 0) return void 0;
  if ((res.headers.get("content-type") ?? "").includes("application/json")) try {
    return JSON.parse(text);
  } catch {
    return text;
  }
  try {
    return JSON.parse(text);
  } catch {
    return text;
  }
}, "parseBody");

// src/lib/jev.ts
function createJevAsk(apiKey) {
  const client = new TypeSafeClient({ apiKey, logLevel: "off" });
  return (request) => client.systemOne(request, {
    signal: AbortSignal.timeout(3e4),
    retry: { maxRetries: 1, maxRetryAfterMs: 5e3 }
  });
}
__name(createJevAsk, "createJevAsk");

// src/lib/pick.ts
var PickFailure = class extends Error {
  constructor(error, message) {
    super(message);
    this.error = error;
  }
  error;
  static {
    __name(this, "PickFailure");
  }
};
var SETUP_HINT = "Run better-agentics:setup to fix the agent definitions.";
function invalid(message) {
  throw new PickFailure("invalid-input", message);
}
__name(invalid, "invalid");
function isRecord2(value) {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
__name(isRecord2, "isRecord");
function summaryOf(value, field) {
  if (!isRecord2(value)) invalid(`${field} must be an object`);
  const summary = value.summary;
  if (typeof summary !== "string" || summary.trim() === "") {
    invalid(`${field}.summary must be a non-empty string`);
  }
  return summary;
}
__name(summaryOf, "summaryOf");
function commonOf(parsed) {
  const { parentModel, lang, excludeRoles } = parsed;
  if (parentModel !== void 0 && (typeof parentModel !== "string" || !isClaudeModel(parentModel))) {
    invalid("parentModel must be one of fable, opus, sonnet, haiku");
  }
  if (lang !== void 0) {
    if (typeof lang !== "string") invalid("lang must be a string");
    try {
      assertLang(lang);
    } catch (error) {
      invalid(error instanceof Error ? error.message : String(error));
    }
  }
  if (excludeRoles !== void 0 && (!Array.isArray(excludeRoles) || !excludeRoles.every((role) => typeof role === "string"))) {
    invalid("excludeRoles must be an array of role IDs");
  }
  const unknown = (excludeRoles ?? []).filter(
    (role) => roleById(role) === void 0
  );
  if (unknown.length > 0) {
    invalid(`excludeRoles contains unknown role IDs: ${unknown.join(", ")}`);
  }
  return {
    parentModel,
    lang: lang ?? "en",
    excludeRoles: excludeRoles ?? []
  };
}
__name(commonOf, "commonOf");
function parseInput(raw) {
  let parsed;
  try {
    parsed = JSON.parse(raw);
  } catch {
    invalid("input is not valid JSON");
  }
  if (!isRecord2(parsed)) invalid("input must be a JSON object");
  return { ...parseTask(parsed), ...commonOf(parsed) };
}
__name(parseInput, "parseInput");
function parseTask(parsed) {
  switch (parsed.reason) {
    case "review": {
      const summary = summaryOf(parsed.task, "task");
      const artifacts = parsed.task.artifacts;
      if (!Array.isArray(artifacts) || !artifacts.every((item) => typeof item === "string")) {
        invalid("task.artifacts must be an array of strings");
      }
      return { reason: "review", task: { summary, artifacts } };
    }
    case "split": {
      const tasks = parsed.tasks;
      if (!Array.isArray(tasks) || tasks.length === 0) {
        invalid("tasks must be a non-empty array");
      }
      const result = tasks.map((task, index) => {
        const summary = summaryOf(task, `tasks[${index}]`);
        const id = task.id;
        if (typeof id !== "string" || id === "") {
          invalid(`tasks[${index}].id must be a non-empty string`);
        }
        const needsContext = task.needsContext;
        if (needsContext !== void 0 && typeof needsContext !== "boolean") {
          invalid(`tasks[${index}].needsContext must be a boolean`);
        }
        return { id, summary, needsContext: needsContext ?? false };
      });
      const ids = result.map((task) => task.id);
      const duplicated = ids.find((id, index) => ids.indexOf(id) !== index);
      if (duplicated !== void 0)
        invalid(`tasks id "${duplicated}" is duplicated`);
      return { reason: "split", tasks: result };
    }
    case "stuck":
      return {
        reason: "stuck",
        task: { summary: summaryOf(parsed.task, "task") }
      };
    default:
      invalid('reason must be "review", "split" or "stuck"');
  }
}
__name(parseTask, "parseTask");
function candidatesFor(input, deps) {
  if (deps.config.kind === "invalid") {
    throw new PickFailure(
      "invalid-config",
      `${deps.config.message}. Run better-agentics:setup to rewrite ${CONFIG_FILE}.`
    );
  }
  const disabled = disabledRolesOf(deps.config);
  const enabled = rolesFor(input.reason).filter(
    (role) => !disabled.includes(role.id)
  );
  if (enabled.length === 0) {
    throw new PickFailure(
      "no-candidates",
      `Every role for "${input.reason}" is disabled in ${CONFIG_FILE}. Run better-agentics:setup to change the disabled roles.`
    );
  }
  const roles = enabled.filter((role) => !input.excludeRoles.includes(role.id));
  if (roles.length === 0) {
    throw new PickFailure(
      "no-candidates",
      `Every remaining role for "${input.reason}" was removed by excludeRoles.`
    );
  }
  const problems = [];
  const candidates = roles.map((role) => {
    const owners = deps.definitions.filter((entry) => entry.role === role.id);
    if (owners.length >= 2) {
      problems.push(
        `role ${role.id}: ${owners.map((entry) => entry.name).join(", ")}`
      );
    }
    const [definition] = owners;
    return {
      role,
      definition,
      criteria: definition === void 0 ? deps.standardCriteria(role.id) : definition.whenToInvoke
    };
  });
  const custom = candidates.flatMap(
    (candidate) => candidate.definition === void 0 ? [] : [candidate.definition]
  );
  for (const name of new Set(custom.map((entry) => entry.name))) {
    const owners = custom.filter((entry) => entry.name === name);
    if (owners.length >= 2) {
      problems.push(
        `name ${name} is shared by roles ${owners.map((entry) => entry.role).join(", ")}`
      );
    }
  }
  if (problems.length > 0) {
    throw new PickFailure(
      "duplicate-role",
      `Several agent definitions conflict (${problems.join("; ")}). ${SETUP_HINT}`
    );
  }
  return candidates;
}
__name(candidatesFor, "candidatesFor");
function withP(delegate, p) {
  return p === void 0 ? delegate : { ...delegate, p };
}
__name(withP, "withP");
function delegateOf(candidate, lang, deps, p) {
  const { role, definition } = candidate;
  if (definition !== void 0) {
    return withP(
      { role: role.id, mode: "custom", agentType: definition.name },
      p
    );
  }
  return withP(
    {
      role: role.id,
      mode: "standard",
      agentType: "general-purpose",
      model: role.model,
      effort: role.effort,
      preamble: deps.preambles.standard(role.id, lang)
    },
    p
  );
}
__name(delegateOf, "delegateOf");
function reviewQuestions(candidates) {
  return Object.fromEntries(
    candidates.map((candidate, index) => [
      `candidate_${index}`,
      noul(
        [
          "Decide whether the reviewer below should review the work described in the state.",
          "Answer yes only when the reviewer's criteria clearly match the work. Other reviewers are judged separately.",
          `Reviewer: ${candidate.role.id}`,
          "When to invoke:",
          candidate.criteria === "" ? "(no criteria)" : candidate.criteria
        ].join("\n")
      )
    ])
  );
}
__name(reviewQuestions, "reviewQuestions");
function splitQuestions(tasks, candidates) {
  const options = Object.fromEntries(
    candidates.map((candidate) => [
      candidate.role.id,
      candidate.criteria === "" ? null : candidate.criteria
    ])
  );
  return Object.fromEntries(
    tasks.map((task, index) => [
      `task_${index}`,
      choice(
        `Choose the agent that should take task "${task.id}": ${task.summary}`,
        options
      )
    ])
  );
}
__name(splitQuestions, "splitQuestions");
function probability(value, where) {
  if (typeof value !== "number" || !Number.isFinite(value) || value < 0 || value > 1) {
    throw new PickFailure("jev-failed", `Unexpected probability at ${where}`);
  }
  return value;
}
__name(probability, "probability");
function answerOf(answers, key) {
  const answer = isRecord2(answers) ? answers[key] : void 0;
  if (!isRecord2(answer)) {
    throw new PickFailure("jev-failed", `Jev returned no answer for ${key}`);
  }
  return answer;
}
__name(answerOf, "answerOf");
async function ask(deps, state, questions) {
  if (deps.apiKey === void 0) {
    throw new PickFailure(
      "no-api-key",
      "TYPESAFE_API_KEY is not set, so Jev cannot choose among several candidates."
    );
  }
  try {
    const result = await deps.createAsk(deps.apiKey)({ state, questions });
    return result.answers;
  } catch (error) {
    throw new PickFailure(
      "jev-failed",
      `Jev call failed: ${error instanceof Error ? error.message : String(error)}`
    );
  }
}
__name(ask, "ask");
async function review(input, deps) {
  const candidates = candidatesFor(input, deps);
  const [only] = candidates;
  if (candidates.length === 1 && only !== void 0) {
    return {
      ok: true,
      reason: "review",
      agents: [delegateOf(only, input.lang, deps)]
    };
  }
  const answers = await ask(
    deps,
    { summary: input.task.summary, artifacts: input.task.artifacts },
    reviewQuestions(candidates)
  );
  const scored = candidates.map((candidate, index) => {
    const key = `candidate_${index}`;
    return {
      candidate,
      p: probability(answerOf(answers, key).noul, `${key}.noul`)
    };
  });
  const yes = scored.filter((entry) => entry.p >= 0.5);
  if (yes.length > 0) {
    return {
      ok: true,
      reason: "review",
      agents: yes.map(
        (entry) => delegateOf(entry.candidate, input.lang, deps, entry.p)
      )
    };
  }
  const best = scored.reduce((top, entry) => entry.p > top.p ? entry : top);
  return {
    ok: true,
    reason: "review",
    agents: [delegateOf(best.candidate, input.lang, deps, best.p)],
    fallback: true
  };
}
__name(review, "review");
var FORK_ROLES = [
  "complex-impl",
  "normal-impl",
  "general"
];
function modelOf(candidate) {
  if (candidate.definition === void 0) return candidate.role.model;
  const model = candidate.definition.model;
  return model !== void 0 && isClaudeModel(model) ? model : void 0;
}
__name(modelOf, "modelOf");
function assignmentOf(task, candidate, input, deps, p) {
  if (!task.needsContext) {
    return { id: task.id, ...delegateOf(candidate, input.lang, deps, p) };
  }
  const { role } = candidate;
  if (!FORK_ROLES.includes(role.id) || input.parentModel === void 0 || modelOf(candidate) !== input.parentModel) {
    return { id: task.id, mode: "self" };
  }
  return {
    id: task.id,
    ...withP(
      {
        role: role.id,
        mode: "fork",
        agentType: "fork",
        preamble: deps.preambles.fork(role.id, input.lang)
      },
      p
    )
  };
}
__name(assignmentOf, "assignmentOf");
async function split(input, deps) {
  const candidates = candidatesFor(input, deps);
  const forkable = deps.forkEnabled && input.parentModel !== void 0;
  const asked = input.tasks.filter((task) => !task.needsContext || forkable);
  const chosen = /* @__PURE__ */ new Map();
  const [only] = candidates;
  if (candidates.length === 1 && only !== void 0) {
    for (const task of asked) chosen.set(task.id, { candidate: only });
  } else if (asked.length > 0) {
    const tasks = asked.map(({ id, summary }) => ({ id, summary }));
    const answers = await ask(
      deps,
      { tasks },
      splitQuestions(tasks, candidates)
    );
    tasks.forEach((task, index) => {
      const key = `task_${index}`;
      const answer = answerOf(answers, key);
      const candidate = candidates.find(
        (entry) => entry.role.id === answer.choice
      );
      if (candidate === void 0) {
        throw new PickFailure(
          "jev-failed",
          `Jev chose an unknown role for ${key}: ${String(answer.choice)}`
        );
      }
      const probabilities = answer.probabilities;
      const p = probability(
        isRecord2(probabilities) ? probabilities[candidate.role.id] : void 0,
        `${key}.probabilities`
      );
      chosen.set(task.id, { candidate, p });
    });
  }
  return {
    ok: true,
    reason: "split",
    assignments: input.tasks.map((task) => {
      const pick = chosen.get(task.id);
      return pick === void 0 ? { id: task.id, mode: "self" } : assignmentOf(task, pick.candidate, input, deps, pick.p);
    })
  };
}
__name(split, "split");
function stuck(input, deps) {
  return {
    ok: true,
    reason: "stuck",
    agents: candidatesFor(input, deps).map(
      (candidate) => delegateOf(candidate, input.lang, deps)
    )
  };
}
__name(stuck, "stuck");
async function pickDelegate(raw, deps) {
  try {
    const input = parseInput(raw);
    switch (input.reason) {
      case "review":
        return await review(input, deps);
      case "split":
        return await split(input, deps);
      case "stuck":
        return stuck(input, deps);
    }
  } catch (error) {
    if (error instanceof PickFailure) {
      return { ok: false, error: error.error, message: error.message };
    }
    return {
      ok: false,
      error: "jev-failed",
      message: error instanceof Error ? error.message : String(error)
    };
  }
}
__name(pickDelegate, "pickDelegate");

// src/lib/preamble.ts
import fs4 from "node:fs";
import path4 from "node:path";
var WHEN_TO_INVOKE2 = "## When to invoke";
var OUTPUT_FORMAT = "## Output Format";
var FORK_INSTRUCTION = {
  ja: /* @__PURE__ */ __name((roleId) => `split \u306E\u5206\u62C5\u3092\u62C5\u3046\u62C5\u3044\u624B\u3068\u3057\u3066\u3001\u4F9D\u983C\u6587\u306E\u4F5C\u696D\u3060\u3051\u3092\u884C\u3046\u3002\u4F1A\u8A71\u306E\u5C65\u6B74\u306B\u3042\u308B\u30AA\u30FC\u30B1\u30B9\u30C8\u30EC\u30FC\u30BF\u30FC\u306E\u898F\u5F8B\u306E\u3046\u3061\u3001\u59D4\u8B72\u3068 pick-delegate \u306B\u95A2\u3059\u308B\u3082\u306E\u306F\u5F53\u3066\u306A\u3044\u3002\u4F9D\u983C\u6587\u304C\u6307\u793A\u3057\u305F\u3068\u304D\u3092\u9664\u304D\u3001Agent \u30C4\u30FC\u30EB\u3067\u3055\u3089\u306B\u59D4\u8B72\u3057\u306A\u3044\u3002
\u5F79\u5272 ID: ${roleId}`, "ja"),
  en: /* @__PURE__ */ __name((roleId) => `As the worker for a split assignment, do only the work in the request. Do not apply the orchestrator rules in the conversation history that concern delegation and pick-delegate. Do not delegate further with the Agent tool unless the request tells you to.
Role ID: ${roleId}`, "en")
};
function languageFor(roleId, context) {
  const { lang } = context;
  if (lang === "ja" || lang === "en") return lang;
  const status = checkFragments(context.pluginRoot, context.projectDir, lang);
  return status.ready.includes(roleId) && status.ready.includes("_common") ? lang : "en";
}
__name(languageFor, "languageFor");
function policy(pluginRoot2) {
  return fs4.readFileSync(
    path4.join(pluginRoot2, "references", "subagent-policy.md"),
    "utf8"
  ).trim();
}
__name(policy, "policy");
function section(heading, lines) {
  return [heading, "", ...lines].join("\n");
}
__name(section, "section");
function standardPreamble(roleId, context) {
  const lang = languageFor(roleId, context);
  const fragment = loadFragments(
    context.pluginRoot,
    context.projectDir,
    lang
  ).get(roleId);
  if (fragment === void 0) throw new Error(`Unknown role id: ${roleId}`);
  const head = loadPreamble(context.pluginRoot, context.projectDir, lang).map(
    (line) => line.replaceAll("{{NAME}}", fragment.defaultName).replaceAll("{{ROLE_LABEL}}", fragment.label).replaceAll("{{ROLE_ID}}", roleId)
  ).join("\n").trim();
  const parts = [head];
  for (const heading of vocabularyFor(lang).bodyOrder) {
    if (heading === WHEN_TO_INVOKE2) continue;
    const lines = fragment.sections.get(heading);
    if (lines !== void 0 && lines.length > 0)
      parts.push(section(heading, lines));
  }
  parts.push(policy(context.pluginRoot));
  return parts.join("\n\n");
}
__name(standardPreamble, "standardPreamble");
function forkPreamble(roleId, context) {
  const lang = context.lang === "ja" ? "ja" : "en";
  const fragment = loadFragments(
    context.pluginRoot,
    context.projectDir,
    lang
  ).get(roleId);
  if (fragment === void 0) throw new Error(`Unknown role id: ${roleId}`);
  const parts = [FORK_INSTRUCTION[lang](roleId)];
  const output = fragment.sections.get(OUTPUT_FORMAT);
  if (output !== void 0 && output.length > 0)
    parts.push(section(OUTPUT_FORMAT, output));
  parts.push(policy(context.pluginRoot));
  return parts.join("\n\n");
}
__name(forkPreamble, "forkPreamble");

// src/pick-delegate.ts
function dirArg(argv) {
  const index = argv.indexOf("--dir");
  const value = index === -1 ? void 0 : argv[index + 1];
  return value === void 0 || value.startsWith("--") ? process.cwd() : value;
}
__name(dirArg, "dirArg");
async function readStdin() {
  const chunks = [];
  for await (const chunk of process.stdin) chunks.push(chunk);
  return Buffer.concat(chunks).toString("utf8");
}
__name(readStdin, "readStdin");
try {
  const raw = await readStdin();
  const projectDir = projectDirOf(process.env, dirArg(process.argv.slice(2)));
  const key = process.env.TYPESAFE_API_KEY?.trim() ?? "";
  const root = pluginRoot();
  const bundled = loadFragments(root, projectDir, "en");
  const output = await pickDelegate(raw, {
    definitions: scanDefinitions(projectDir),
    config: readConfig(projectDir),
    apiKey: key === "" ? void 0 : key,
    createAsk: createJevAsk,
    forkEnabled: process.env.CLAUDE_CODE_FORK_SUBAGENT !== "0",
    standardCriteria: /* @__PURE__ */ __name((roleId) => (bundled.get(roleId)?.sections.get("## When to invoke") ?? []).join("\n"), "standardCriteria"),
    preambles: {
      standard: /* @__PURE__ */ __name((roleId, lang) => standardPreamble(roleId, { pluginRoot: root, projectDir, lang }), "standard"),
      fork: /* @__PURE__ */ __name((roleId, lang) => forkPreamble(roleId, { pluginRoot: root, projectDir, lang }), "fork")
    }
  });
  process.stdout.write(`${JSON.stringify(output)}
`);
} catch (error) {
  process.stdout.write(
    `${JSON.stringify({
      ok: false,
      error: "jev-failed",
      message: error instanceof Error ? error.message : String(error)
    })}
`
  );
}
