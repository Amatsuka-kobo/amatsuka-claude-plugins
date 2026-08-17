#!/usr/bin/env node

// src/guard-docs.ts
import fs2 from "node:fs";
import path2 from "node:path";
import { fileURLToPath } from "node:url";

// src/lib/config.ts
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
var CONFIG_FILENAME = "metatron.config.json";
var SUPPORTED_VERSION = 1;
var DEFAULT_ARCHITECTURE_PATH = "docs/ARCHITECTURE.md";
var DEFAULT_GOTCHAS_PATH = "docs/GOTCHAS.md";
var DEFAULT_INJECTION_ENABLED = true;
var DEFAULT_GOTCHAS_RECENT_COUNT = 5;
var DEFAULT_MAX_CHARS = 9e3;
function isPlainObject(value) {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
function realpathOrSelf(dir) {
  try {
    return fs.realpathSync(dir);
  } catch {
    return dir;
  }
}
function hasConfigFile(dir) {
  try {
    return fs.existsSync(path.join(dir, CONFIG_FILENAME));
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
    return path.resolve(out);
  } catch {
    return null;
  }
}
function findDocRoot(startDir) {
  const start = realpathOrSelf(path.resolve(startDir ?? process.cwd()));
  let dir = start;
  while (true) {
    if (hasConfigFile(dir)) return dir;
    const parent = path.dirname(dir);
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
  return path.isAbsolute(value) || /^[A-Za-z]:\//.test(value) || value.startsWith("//");
}
function toPosix(value) {
  return value.split(path.sep).join("/");
}
function resolveConfiguredPath(docRoot, raw, fallback, label, warnings) {
  const useFallback = () => ({
    relative: fallback,
    absolute: path.resolve(docRoot, fallback)
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
  const absolute = path.resolve(docRoot, value);
  const relative = path.relative(docRoot, absolute);
  const escapes = relative === "" || relative === ".." || relative.startsWith(`..${path.sep}`) || path.isAbsolute(relative);
  if (escapes) {
    warnings.push(
      `paths.${label} \u304C\u30EB\u30FC\u30C8\u5916(${raw})\u3092\u6307\u3059\u305F\u3081\u3001\u65E2\u5B9A\u5024 ${fallback} \u3092\u4F7F\u7528\u3057\u307E\u3059\u3002`
    );
    return useFallback();
  }
  return { relative: toPosix(relative), absolute };
}
function resolveBoolean(raw, fallback, label, warnings) {
  if (raw === void 0) return fallback;
  if (typeof raw !== "boolean") {
    warnings.push(
      `${label} \u304C\u771F\u507D\u5024\u3067\u306A\u3044\u305F\u3081\u3001\u65E2\u5B9A\u5024 ${String(fallback)} \u3092\u4F7F\u7528\u3057\u307E\u3059\u3002`
    );
    return fallback;
  }
  return raw;
}
function resolveNumber(raw, fallback, label, min, warnings) {
  if (raw === void 0) return fallback;
  if (typeof raw !== "number" || !Number.isFinite(raw) || !Number.isInteger(raw) || raw < min) {
    warnings.push(
      `${label} \u304C ${min} \u4EE5\u4E0A\u306E\u6574\u6570\u3067\u306A\u3044\u305F\u3081\u3001\u65E2\u5B9A\u5024 ${String(fallback)} \u3092\u4F7F\u7528\u3057\u307E\u3059\u3002`
    );
    return fallback;
  }
  return raw;
}
function defaultsFor(docRoot, warnings) {
  return {
    docRoot,
    configPath: path.join(docRoot, CONFIG_FILENAME),
    configExists: false,
    architecturePath: path.resolve(docRoot, DEFAULT_ARCHITECTURE_PATH),
    gotchasPath: path.resolve(docRoot, DEFAULT_GOTCHAS_PATH),
    architectureRelative: DEFAULT_ARCHITECTURE_PATH,
    gotchasRelative: DEFAULT_GOTCHAS_PATH,
    injection: {
      enabled: DEFAULT_INJECTION_ENABLED,
      gotchasRecentCount: DEFAULT_GOTCHAS_RECENT_COUNT,
      maxChars: DEFAULT_MAX_CHARS
    },
    warnings
  };
}
function loadConfigInner(startDir) {
  const warnings = [];
  const docRoot = findDocRoot(startDir);
  const configPath = path.join(docRoot, CONFIG_FILENAME);
  let configExists = false;
  let parsed;
  let parseOk = false;
  try {
    if (fs.existsSync(configPath)) {
      configExists = true;
      parsed = JSON.parse(fs.readFileSync(configPath, "utf8"));
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
  const injectionRaw = source?.injection;
  const injection = isPlainObject(injectionRaw) ? injectionRaw : void 0;
  if (injectionRaw !== void 0 && injection === void 0) {
    warnings.push("injection \u304C\u30AA\u30D6\u30B8\u30A7\u30AF\u30C8\u3067\u306A\u3044\u305F\u3081\u3001\u65E2\u5B9A\u5024\u3092\u4F7F\u7528\u3057\u307E\u3059\u3002");
  }
  return {
    docRoot,
    configPath,
    configExists,
    architecturePath: architecture.absolute,
    gotchasPath: gotchas.absolute,
    architectureRelative: architecture.relative,
    gotchasRelative: gotchas.relative,
    injection: {
      enabled: resolveBoolean(
        injection?.enabled,
        DEFAULT_INJECTION_ENABLED,
        "injection.enabled",
        warnings
      ),
      gotchasRecentCount: resolveNumber(
        injection?.gotchasRecentCount,
        DEFAULT_GOTCHAS_RECENT_COUNT,
        "injection.gotchasRecentCount",
        0,
        warnings
      ),
      maxChars: resolveNumber(
        injection?.maxChars,
        DEFAULT_MAX_CHARS,
        "injection.maxChars",
        1,
        warnings
      )
    },
    warnings
  };
}
function loadConfig(startDir) {
  try {
    return loadConfigInner(startDir);
  } catch {
    let docRoot;
    try {
      docRoot = path.resolve(startDir ?? process.cwd());
    } catch {
      docRoot = startDir ?? ".";
    }
    return defaultsFor(docRoot, [
      "\u8A2D\u5B9A\u306E\u89E3\u6C7A\u306B\u5931\u6557\u3057\u305F\u305F\u3081\u65E2\u5B9A\u5024\u3092\u4F7F\u7528\u3057\u307E\u3059\u3002"
    ]);
  }
}

// src/lib/emit.ts
async function readStdin() {
  let data = "";
  for await (const chunk of process.stdin) data += chunk;
  return JSON.parse(data);
}
function emit(decision, reason) {
  process.stdout.write(
    `${JSON.stringify({
      hookSpecificOutput: {
        hookEventName: "PreToolUse",
        permissionDecision: decision,
        permissionDecisionReason: reason
      }
    })}
`
  );
  process.exit(0);
}
function pass() {
  process.exit(0);
}

// src/guard-docs.ts
function metatronCliPath() {
  const self = fileURLToPath(import.meta.url);
  return path2.join(path2.dirname(path2.dirname(self)), "scripts", "metatron.mjs");
}
function toSlash(value) {
  return value.replace(/\\/g, "/");
}
function realpathOrParent(abs) {
  try {
    return fs2.realpathSync(abs);
  } catch {
    try {
      return path2.join(fs2.realpathSync(path2.dirname(abs)), path2.basename(abs));
    } catch {
      return abs;
    }
  }
}
var MAX_SYMLINK_HOPS = 40;
function followDanglingLink(abs) {
  let current = abs;
  for (let hop = 0; hop <= MAX_SYMLINK_HOPS; hop++) {
    let isLink;
    try {
      isLink = fs2.lstatSync(current).isSymbolicLink();
    } catch {
      return current;
    }
    if (!isLink) return current;
    if (hop === MAX_SYMLINK_HOPS) return abs;
    let target;
    try {
      target = fs2.readlinkSync(current);
    } catch {
      return current;
    }
    current = realpathOrParent(path2.resolve(path2.dirname(current), target));
  }
  return abs;
}
function flipCase(value) {
  return value.replace(
    /[A-Za-z]/g,
    (c) => c >= "a" && c <= "z" ? c.toUpperCase() : c.toLowerCase()
  );
}
function deepestExisting(abs) {
  let dir = abs;
  for (; ; ) {
    if (fs2.existsSync(dir)) return dir;
    const parent = path2.dirname(dir);
    if (parent === dir) return null;
    dir = parent;
  }
}
function isCaseInsensitiveFs(probe) {
  if (process.platform === "win32") return true;
  let dir = deepestExisting(probe);
  while (dir !== null) {
    const base = path2.basename(dir);
    const flipped = flipCase(base);
    if (flipped !== base) {
      try {
        const a = fs2.statSync(dir);
        const b = fs2.statSync(path2.join(path2.dirname(dir), flipped));
        return a.ino === b.ino && a.dev === b.dev;
      } catch {
        return false;
      }
    }
    const parent = path2.dirname(dir);
    dir = parent === dir ? null : parent;
  }
  return false;
}
function comparisonKey(abs, caseInsensitive) {
  const resolved = followDanglingLink(realpathOrParent(abs));
  const key = toSlash(resolved).normalize("NFC");
  return caseInsensitive ? key.toLowerCase() : key;
}
function architectureReason(relative, cli) {
  return [
    `${relative} \u306F metatron \u306E\u7BA1\u7406\u4E0B\u306B\u3042\u308A\u3001\u76F4\u63A5\u7DE8\u96C6\u3067\u304D\u307E\u305B\u3093(\u30BB\u30AF\u30B7\u30E7\u30F3\u5358\u4F4D\u306E\u5DEE\u5206\u78BA\u8A8D\u3068\u66F8\u5F0F\u691C\u8A3C\u306E\u305F\u3081)\u3002`,
    "\u66F4\u65B0\u3059\u308B\u30BB\u30AF\u30B7\u30E7\u30F3\u306E JSON \u3092\u4E00\u6642\u30D5\u30A1\u30A4\u30EB\u306B\u66F8\u304D\u3001\u6B21\u306E 2 \u6BB5\u968E\u3067\u53CD\u6620\u3057\u3066\u304F\u3060\u3055\u3044:",
    `  node ${cli} stage-architecture --input /tmp/metatron-architecture.json`,
    `  node ${cli} commit-architecture --staging-id <stage-architecture \u304C\u767A\u884C\u3057\u305F id>`,
    "ADR \u306E\u8FFD\u52A0\u30FB\u72B6\u614B\u5909\u66F4\u306F stage-adr \u3092\u4F7F\u3063\u3066\u304F\u3060\u3055\u3044(stage-architecture \u3067\u306F\u62D2\u5426\u3055\u308C\u307E\u3059):",
    `  node ${cli} stage-adr --input /tmp/metatron-adr.json`,
    `\u5165\u529B\u306E\u66F8\u5F0F: node ${cli} get config`
  ].join("\n");
}
function gotchasReason(relative, cli) {
  return [
    `${relative} \u306F metatron \u306E\u7BA1\u7406\u4E0B\u306B\u3042\u308A\u3001\u76F4\u63A5\u7DE8\u96C6\u3067\u304D\u307E\u305B\u3093(\u8FFD\u8A18\u306E\u307F\u30FB\u63A1\u756A\u30FB\u66F8\u5F0F\u691C\u8A3C\u306E\u305F\u3081)\u3002`,
    "\u30A8\u30F3\u30C8\u30EA\u306E JSON \u3092\u4E00\u6642\u30D5\u30A1\u30A4\u30EB\u306B\u66F8\u304D\u3001\u6B21\u306E\u30B3\u30DE\u30F3\u30C9\u3067\u8FFD\u8A18\u3057\u3066\u304F\u3060\u3055\u3044:",
    `  node ${cli} append-gotcha --input /tmp/metatron-gotcha.json`,
    "\u65E2\u5B58\u30A8\u30F3\u30C8\u30EA\u3078\u306E\u30BF\u30B0\u4ED8\u4E0E(\u89E3\u6C7A\u6E08\u307F / \u5BFE\u8C61\u5916):",
    `  node ${cli} tag-gotcha --id GOTCHA-003 --tag \u89E3\u6C7A\u6E08\u307F --reason "<\u7406\u7531>"`,
    `\u5165\u529B\u306E\u66F8\u5F0F: node ${cli} get config`
  ].join("\n");
}
try {
  const input = await readStdin();
  const candidates = [
    input.tool_input?.file_path,
    input.tool_input?.notebook_path
  ].filter(
    (value) => typeof value === "string" && value !== ""
  );
  if (candidates.length === 0) pass();
  const cwd = input.cwd ?? process.cwd();
  const config = loadConfig(cwd);
  const caseInsensitive = isCaseInsensitiveFs(config.docRoot);
  const architectureKey = comparisonKey(
    config.architecturePath,
    caseInsensitive
  );
  const gotchasKey = comparisonKey(config.gotchasPath, caseInsensitive);
  const cli = metatronCliPath();
  let hitArchitecture = false;
  let hitGotchas = false;
  for (const raw of candidates) {
    const key = comparisonKey(path2.resolve(cwd, toSlash(raw)), caseInsensitive);
    if (key === architectureKey) hitArchitecture = true;
    if (key === gotchasKey) hitGotchas = true;
  }
  if (hitArchitecture)
    emit("deny", architectureReason(config.architectureRelative, cli));
  if (hitGotchas) emit("deny", gotchasReason(config.gotchasRelative, cli));
  pass();
} catch {
  pass();
}
