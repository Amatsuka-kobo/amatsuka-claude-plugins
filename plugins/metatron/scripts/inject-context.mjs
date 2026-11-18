#!/usr/bin/env node

// src/inject-context.ts
import fs3 from "node:fs";
import path3 from "node:path";
import { fileURLToPath } from "node:url";

// src/lib/claude-md.ts
import fs from "node:fs";
import path from "node:path";
var CLAUDE_MD_CANDIDATES = ["CLAUDE.md", ".claude/CLAUDE.md"];
function readOrNull(filePath) {
  try {
    return fs.readFileSync(filePath, "utf8");
  } catch {
    return null;
  }
}
function isMentionablePath(rel) {
  return rel !== "" && ![...rel].some((c) => {
    const code = c.charCodeAt(0);
    return /\s/.test(c) || code < 32 || code === 127;
  });
}
function mentions(text) {
  const found = /* @__PURE__ */ new Set();
  let fence = null;
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.replace(/^﻿/, "");
    const marker = /^\s{0,3}(`{3,}|~{3,})/.exec(line);
    if (marker) {
      if (fence === null) fence = marker[1][0];
      else if (marker[1][0] === fence) fence = null;
      continue;
    }
    if (fence !== null) continue;
    const outsideCode = line.replace(/`[^`]*`/g, " ");
    for (const match of outsideCode.matchAll(/(?:^|\s)@(\S+)/g)) {
      const token = match[1].replace(/[.,;:)\]、。」]+$/, "");
      if (token !== "") found.add(path.posix.normalize(token));
    }
  }
  return found;
}
function existingMentions(docRoot) {
  const existing = /* @__PURE__ */ new Set();
  for (const rel of CLAUDE_MD_CANDIDATES) {
    const text = readOrNull(path.join(docRoot, rel));
    if (text === null) continue;
    for (const m of mentions(text)) {
      existing.add(
        rel === "CLAUDE.md" ? m : path.posix.normalize(`.claude/${m}`)
      );
    }
  }
  return existing;
}

// src/lib/config.ts
import { spawnSync } from "node:child_process";
import fs2 from "node:fs";
import path2 from "node:path";
var CONFIG_FILENAME = "metatron.config.json";
var SUPPORTED_VERSION = 1;
var DEFAULT_ARCHITECTURE_PATH = "docs/ARCHITECTURE.md";
var DEFAULT_GOTCHAS_PATH = "docs/GOTCHAS.md";
function isPlainObject(value) {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
function realpathOrSelf(dir) {
  try {
    return fs2.realpathSync(dir);
  } catch {
    return dir;
  }
}
function hasConfigFile(dir) {
  try {
    return fs2.existsSync(path2.join(dir, CONFIG_FILENAME));
  } catch {
    return false;
  }
}
function gitToplevel(cwd) {
  try {
    const res = spawnSync("git", ["rev-parse", "--show-toplevel"], {
      cwd,
      encoding: "utf8",
      timeout: 5e3,
      windowsHide: true
    });
    if (res.status !== 0) return null;
    const out = res.stdout?.trim();
    if (!out) return null;
    return path2.resolve(out);
  } catch {
    return null;
  }
}
function findDocRoot(startDir) {
  const start = realpathOrSelf(path2.resolve(startDir ?? process.cwd()));
  let dir = start;
  while (true) {
    if (hasConfigFile(dir)) return dir;
    const parent = path2.dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }
  const top = gitToplevel(start);
  if (top) return top;
  return start;
}
function normalizeSeparators(value) {
  return value.replace(/\\/g, "/");
}
function looksAbsolute(value) {
  return path2.isAbsolute(value) || /^[A-Za-z]:\//.test(value) || value.startsWith("//");
}
function toPosix(value) {
  return value.split(path2.sep).join("/");
}
function resolveConfiguredPath(docRoot, raw, fallback, label, warnings) {
  const useFallback = () => ({
    relative: fallback,
    absolute: path2.resolve(docRoot, fallback)
  });
  if (raw === void 0) return useFallback();
  if (typeof raw !== "string" || raw.trim() === "") {
    warnings.push(
      `paths.${label} \u304C\u7A7A\u3067\u306A\u3044\u6587\u5B57\u5217\u3067\u306A\u3044\u305F\u3081\u3001\u65E2\u5B9A\u5024 ${fallback} \u3092\u4F7F\u7528\u3057\u307E\u3059\u3002`
    );
    return useFallback();
  }
  const value = normalizeSeparators(raw);
  if (looksAbsolute(value)) {
    warnings.push(
      `paths.${label} \u304C\u7D76\u5BFE\u30D1\u30B9(${raw})\u306E\u305F\u3081\u3001\u65E2\u5B9A\u5024 ${fallback} \u3092\u4F7F\u7528\u3057\u307E\u3059\u3002\u30DE\u30B7\u30F3\u56FA\u6709\u306E\u7D76\u5BFE\u30D1\u30B9\u306F\u30EA\u30DD\u30B8\u30C8\u30EA\u306E\u53EF\u642C\u6027\u3092\u5931\u308F\u305B\u308B\u305F\u3081\u53D7\u3051\u4ED8\u3051\u307E\u305B\u3093\u3002`
    );
    return useFallback();
  }
  const absolute = path2.resolve(docRoot, value);
  const relative = path2.relative(docRoot, absolute);
  const escapes = relative === "" || relative === ".." || relative.startsWith(`..${path2.sep}`) || path2.isAbsolute(relative);
  if (escapes) {
    warnings.push(
      `paths.${label} \u304C\u30EB\u30FC\u30C8\u5916(${raw})\u3092\u6307\u3059\u305F\u3081\u3001\u65E2\u5B9A\u5024 ${fallback} \u3092\u4F7F\u7528\u3057\u307E\u3059\u3002`
    );
    return useFallback();
  }
  return { relative: toPosix(relative), absolute };
}
function defaultsFor(docRoot, warnings) {
  return {
    docRoot,
    configPath: path2.join(docRoot, CONFIG_FILENAME),
    configExists: false,
    architecturePath: path2.resolve(docRoot, DEFAULT_ARCHITECTURE_PATH),
    gotchasPath: path2.resolve(docRoot, DEFAULT_GOTCHAS_PATH),
    architectureRelative: DEFAULT_ARCHITECTURE_PATH,
    gotchasRelative: DEFAULT_GOTCHAS_PATH,
    warnings
  };
}
function loadConfigInner(startDir) {
  const warnings = [];
  const docRoot = findDocRoot(startDir);
  const configPath = path2.join(docRoot, CONFIG_FILENAME);
  let configExists = false;
  let parsed;
  let parseOk = false;
  try {
    if (fs2.existsSync(configPath)) {
      configExists = true;
      parsed = JSON.parse(fs2.readFileSync(configPath, "utf8"));
      parseOk = true;
    }
  } catch {
    warnings.push("\u8A2D\u5B9A\u3092\u8AAD\u3081\u306A\u304B\u3063\u305F\u305F\u3081\u65E2\u5B9A\u5024\u3092\u4F7F\u7528\u3057\u307E\u3059\u3002");
  }
  let source;
  if (parseOk) {
    if (isPlainObject(parsed)) {
      source = parsed;
    } else {
      warnings.push(
        "\u8A2D\u5B9A\u306E\u30C8\u30C3\u30D7\u30EC\u30D9\u30EB\u304C\u30AA\u30D6\u30B8\u30A7\u30AF\u30C8\u3067\u306A\u3044\u305F\u3081\u65E2\u5B9A\u5024\u3092\u4F7F\u7528\u3057\u307E\u3059\u3002"
      );
    }
  }
  if (source !== void 0) {
    const version = source.version;
    if (version !== void 0 && version !== SUPPORTED_VERSION) {
      warnings.push(
        `\u8A2D\u5B9A\u306E version(${JSON.stringify(version)})\u304C\u672A\u77E5\u306E\u305F\u3081\u3001\u5168\u9805\u76EE\u306B\u65E2\u5B9A\u5024\u3092\u4F7F\u7528\u3057\u307E\u3059\u3002`
      );
      source = void 0;
    }
  }
  const pathsRaw = source?.paths;
  const paths = isPlainObject(pathsRaw) ? pathsRaw : void 0;
  if (pathsRaw !== void 0 && paths === void 0) {
    warnings.push(
      "paths \u304C\u30AA\u30D6\u30B8\u30A7\u30AF\u30C8\u3067\u306A\u3044\u305F\u3081\u3001\u6587\u66F8\u30D1\u30B9\u306B\u65E2\u5B9A\u5024\u3092\u4F7F\u7528\u3057\u307E\u3059\u3002"
    );
  }
  const architecture = resolveConfiguredPath(
    docRoot,
    paths?.architecture,
    DEFAULT_ARCHITECTURE_PATH,
    "architecture",
    warnings
  );
  const gotchas = resolveConfiguredPath(
    docRoot,
    paths?.gotchas,
    DEFAULT_GOTCHAS_PATH,
    "gotchas",
    warnings
  );
  return {
    docRoot,
    configPath,
    configExists,
    architecturePath: architecture.absolute,
    gotchasPath: gotchas.absolute,
    architectureRelative: architecture.relative,
    gotchasRelative: gotchas.relative,
    warnings
  };
}
function loadConfig(startDir) {
  try {
    return loadConfigInner(startDir);
  } catch {
    let docRoot;
    try {
      docRoot = path2.resolve(startDir ?? process.cwd());
    } catch {
      docRoot = startDir ?? ".";
    }
    return defaultsFor(docRoot, [
      "\u8A2D\u5B9A\u306E\u89E3\u6C7A\u306B\u5931\u6557\u3057\u305F\u305F\u3081\u65E2\u5B9A\u5024\u3092\u4F7F\u7528\u3057\u307E\u3059\u3002"
    ]);
  }
}

// src/lib/emit.ts
function injectContext(content, systemMessage) {
  process.stdout.write(
    `${JSON.stringify({
      ...systemMessage === void 0 ? {} : { systemMessage },
      hookSpecificOutput: {
        hookEventName: "SessionStart",
        additionalContext: content
      }
    })}
`
  );
}

// src/lib/features.ts
var ADR_ENV = "AMATSUKA_METATRON_ENABLE_ADR";
var GOTCHAS_ENV = "AMATSUKA_METATRON_ENABLE_GOTCHAS";
function enabled(value) {
  const normalized = value?.trim().toLowerCase();
  return normalized === "1" || normalized === "true" || normalized === "on";
}
function readFeatures(env) {
  return { adr: enabled(env[ADR_ENV]), gotchas: enabled(env[GOTCHAS_ENV]) };
}

// src/inject-context.ts
var MAX_WARNING_LINES = 3;
var STDIN_TIMEOUT_MS = 2e3;
var LEGACY_RULES_DIR = ".claude/rules/metatron";
function legacyRulesDir(config) {
  try {
    const raw = JSON.parse(fs3.readFileSync(config.configPath, "utf8"));
    const dir = raw?.paths?.rulesDir;
    if (typeof dir === "string" && dir !== "" && !path3.isAbsolute(dir) && !dir.split(/[\\/]/).includes("..")) {
      return dir.replace(/\/+$/, "");
    }
  } catch {
  }
  return LEGACY_RULES_DIR;
}
function metatronCliPath(env) {
  const fromEnv = env.CLAUDE_PLUGIN_ROOT;
  const root = typeof fromEnv === "string" && fromEnv !== "" ? path3.resolve(fromEnv) : path3.resolve(path3.dirname(fileURLToPath(import.meta.url)), "..");
  return path3.join(root, "scripts", "metatron.mjs");
}
function hasContent(filePath) {
  try {
    return fs3.readFileSync(filePath, "utf8").trim() !== "";
  } catch {
    return false;
  }
}
function cliLines(cli, features) {
  const reads = [
    features.gotchas ? "node M get gotchas --query <\u8A9E>" : null,
    features.adr ? "node M get adr" : null,
    "node M get architecture"
  ].filter((part) => part !== null);
  return [
    `\u8A18\u9332\u30FB\u5168\u6587\u53D6\u5F97\u306F\u6B21\u306E CLI \u3092\u4F7F\u3046(\u7D76\u5BFE\u30D1\u30B9\u3002M = ${cli}):`,
    `  \u8AAD\u3080:     ${reads.join(" / ")}`,
    ...features.gotchas ? [
      "  \u8A18\u9332:     node M append-gotcha --input <\u4E00\u6642\u30D5\u30A1\u30A4\u30EB>",
      '  \u30BF\u30B0:     node M tag-gotcha --id GOTCHA-003 --tag \u89E3\u6C7A\u6E08\u307F --reason "..."'
    ] : [],
    "\u203B\u9577\u3044\u5165\u529B\u306F\u4E00\u6642\u30D5\u30A1\u30A4\u30EB\u3078\u66F8\u304D\u3001--input <path> \u3067\u6E21\u3059(CLI \u306E\u547C\u3073\u51FA\u3057\u898F\u7D04)\u3002"
  ];
}
function updateLines(features) {
  const targets = features.adr ? "ARCHITECTURE\u30FBADR" : "ARCHITECTURE";
  return [
    `${targets} \u306E\u66F4\u65B0\u306F\u3001Skill \u30C4\u30FC\u30EB\u3067 metatron:updating-architecture \u3092\u8D77\u52D5\u3057\u3066\u884C\u3046\u3002`,
    "\u8A08\u753B\u66F8\u306B stage-* \u306E\u624B\u9806\u304C\u66F8\u304B\u308C\u3066\u3044\u3066\u3082\u3001\u5148\u306B\u30B9\u30AD\u30EB\u3092\u8D77\u52D5\u3059\u308B\u3002"
  ];
}
function recordingLines(features) {
  if (!features.adr && !features.gotchas) return [];
  const head = features.adr ? features.gotchas ? [
    "\u4F9D\u983C\u306E\u5B8C\u4E86\u5831\u544A\u306E\u524D\u306B\u3001\u5224\u65AD\u3068\u5931\u6557\u306B ADR\u30FBGOTCHAS \u3078\u6B8B\u3059\u3082\u306E\u304C\u7121\u3044\u304B\u78BA\u304B\u3081\u308B\u3002",
    "\u6B8B\u3059\u306A\u3089 updating-architecture \u304B recording-gotchas \u306E\u627F\u8A8D\u624B\u9806\u3067\u8A18\u9332\u3059\u308B\u3002"
  ] : [
    "\u4F9D\u983C\u306E\u5B8C\u4E86\u5831\u544A\u306E\u524D\u306B\u3001\u5224\u65AD\u306B ADR \u3078\u6B8B\u3059\u3082\u306E\u304C\u7121\u3044\u304B\u78BA\u304B\u3081\u308B\u3002",
    "\u6B8B\u3059\u306A\u3089 updating-architecture \u306E\u627F\u8A8D\u624B\u9806\u3067\u8A18\u9332\u3059\u308B\u3002"
  ] : [
    "\u4F9D\u983C\u306E\u5B8C\u4E86\u5831\u544A\u306E\u524D\u306B\u3001\u5931\u6557\u306B GOTCHAS \u3078\u6B8B\u3059\u3082\u306E\u304C\u7121\u3044\u304B\u78BA\u304B\u3081\u308B\u3002",
    "\u6B8B\u3059\u306A\u3089 recording-gotchas \u306E\u627F\u8A8D\u624B\u9806\u3067\u8A18\u9332\u3059\u308B\u3002"
  ];
  return [
    ...head,
    "codiel run \u306E\u5831\u544A\u306B\u51FA\u305F\u5019\u88DC\u306F\u3001run \u306E\u4E2D\u3067\u306A\u304F\u6B21\u306E\u30BF\u30FC\u30F3\u306E\u521D\u3081\u306B\u78BA\u304B\u3081\u308B\u3002",
    "docs/intents/domains/ \u306E\u5019\u88DC\u306F /metatron:update \u3067\u53D6\u308A\u8FBC\u3081\u308B\u3002"
  ];
}
function migrationLines(config, docs, hasArchitecture) {
  const lines = [];
  const rulesDir = legacyRulesDir(config);
  if (fs3.existsSync(path3.join(config.docRoot, rulesDir))) {
    lines.push(
      `\u5EC3\u6B62\u3057\u305F rules(${rulesDir}/)\u304C\u6B8B\u3063\u3066\u3044\u308B\u3002/metatron:update \u3067 ARCHITECTURE \u3068 CLAUDE.md \u3078\u79FB\u884C\u3059\u308B\u3002`
    );
  }
  if (!hasArchitecture) return lines;
  const existing = existingMentions(config.docRoot);
  const missing = docs.filter((rel) => !existing.has(rel));
  const unlinkable = missing.filter((rel) => !isMentionablePath(rel));
  const linkable = missing.filter((rel) => isMentionablePath(rel));
  if (linkable.length > 0) {
    lines.push(
      `CLAUDE.md \u306B ${linkable.map((rel) => `@${rel}`).join(" \u3068 ")} \u304C\u7121\u304F\u3001\u6587\u66F8\u304C\u8AAD\u307F\u8FBC\u307E\u308C\u306A\u3044\u3002/metatron:update \u3067\u8FFD\u8A18\u3059\u308B\u3002`
    );
  }
  if (unlinkable.length > 0) {
    lines.push(
      `${unlinkable.join(" \u3068 ")} \u306F\u7A7A\u767D\u304B\u5236\u5FA1\u6587\u5B57\u3092\u542B\u3080\u305F\u3081\u3001@\u30E1\u30F3\u30B7\u30E7\u30F3\u3067\u8AAD\u307F\u8FBC\u3081\u306A\u3044\u3002metatron.config.json \u306E paths \u3092\u7A7A\u767D\u306E\u7121\u3044\u30D1\u30B9\u306B\u5909\u3048\u308B\u3002`
    );
  }
  return lines;
}
function build(config, env) {
  const features = readFeatures(env);
  const cli = metatronCliPath(env);
  const hasArchitecture = hasContent(config.architecturePath);
  const hasGotchas = features.gotchas && hasContent(config.gotchasPath);
  const docs = [
    config.architectureRelative,
    ...hasGotchas ? [config.gotchasRelative] : []
  ];
  const lines = ["# metatron: \u6848\u5185", ""];
  if (!hasArchitecture) {
    lines.push(
      "\u3053\u306E\u30D7\u30ED\u30B8\u30A7\u30AF\u30C8\u306B\u306F\u307E\u3060 ARCHITECTURE \u304C\u7121\u3044\u3002**`/metatron:init` \u3067\u4F5C\u6210\u3059\u308B\u3002**",
      ...cliLines(cli, features)
    );
  } else {
    lines.push(
      `${docs.join(" \u3068 ")} \u306F metatron \u306E\u7BA1\u7406\u4E0B\u306B\u3042\u308A\u3001CLAUDE.md \u306E @\u30E1\u30F3\u30B7\u30E7\u30F3\u3067\u8AAD\u307F\u8FBC\u307E\u308C\u308B\u3002**\u76F4\u63A5\u7DE8\u96C6\u306F PreToolUse hook \u304C\u62D2\u5426\u3059\u308B\u3002**`,
      ...cliLines(cli, features),
      ...updateLines(features),
      ...recordingLines(features),
      "\u30B5\u30D6\u30A8\u30FC\u30B8\u30A7\u30F3\u30C8\u3082 CLAUDE.md \u7D4C\u7531\u3067\u540C\u3058\u6587\u66F8\u3092\u8AAD\u3080\u3002\u59D4\u8B72\u306E\u4F9D\u983C\u6587\u306B\u306F\u3001\u6587\u66F8\u306E\u539F\u6587\u3082\u8981\u7D04\u3082\u66F8\u304D\u5199\u3055\u306A\u3044\u3002"
    );
  }
  const migration = migrationLines(config, docs, hasArchitecture);
  lines.push(...migration);
  for (const warning of config.warnings.slice(0, MAX_WARNING_LINES)) {
    lines.push(`\u203B\u6CE8\u610F: ${warning}`);
  }
  return {
    content: `${lines.join("\n")}
`,
    ...migration.length === 0 ? {} : { systemMessage: `metatron: ${migration.join(" ")}` }
  };
}
function readHookInput() {
  return new Promise((resolve) => {
    let data = "";
    let settled = false;
    const finish = (value) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      resolve(value);
    };
    const timer = setTimeout(() => {
      process.stdin.destroy();
      finish({});
    }, STDIN_TIMEOUT_MS);
    process.stdin.setEncoding("utf8");
    process.stdin.on("data", (chunk) => {
      data += chunk;
    });
    process.stdin.on("end", () => {
      try {
        const parsed = JSON.parse(data);
        finish(typeof parsed === "object" && parsed !== null ? parsed : {});
      } catch {
        finish({});
      }
    });
    process.stdin.on("error", () => finish({}));
  });
}
try {
  const hookInput = await readHookInput();
  const startDir = typeof hookInput.cwd === "string" && hookInput.cwd !== "" ? hookInput.cwd : process.cwd();
  const { content, systemMessage } = build(loadConfig(startDir), process.env);
  injectContext(content, systemMessage);
} catch {
}
