// src/hooks/lib.ts
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
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
function globToRegExp(glob) {
  let re = "";
  for (let i = 0; i < glob.length; i++) {
    const c = glob[i];
    if (c === "*") {
      if (glob[i + 1] === "*") {
        re += ".*";
        i++;
        if (glob[i + 1] === "/") i++;
      } else re += "[^/]*";
    } else if (c === "?") re += "[^/]";
    else re += c.replace(/[.+^${}()|[\]\\]/g, "\\$&");
  }
  return new RegExp(`^${re}$`);
}
var DOC_CONFIG_FILENAME = "metatron.config.json";
var DOC_CONFIG_SUPPORTED_VERSION = 1;
var DEFAULT_ARCHITECTURE_PATH = "docs/ARCHITECTURE.md";
var DEFAULT_GOTCHAS_PATH = "docs/GOTCHAS.md";
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
function existsSafe(target) {
  try {
    return fs.existsSync(target);
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
    if (existsSafe(path.join(dir, DOC_CONFIG_FILENAME))) return dir;
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
function resolveConfiguredPath(docRoot, raw, fallback, label, warnings) {
  const useFallback = () => path.resolve(docRoot, fallback);
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
      `paths.${label} \u304C\u7D76\u5BFE\u30D1\u30B9(${raw})\u306E\u305F\u3081\u3001\u65E2\u5B9A\u5024 ${fallback} \u3092\u4F7F\u7528\u3057\u307E\u3059\u3002`
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
  return absolute;
}
function fallbackDocRoot(startDir) {
  try {
    return path.resolve(startDir ?? process.cwd());
  } catch {
    return startDir ?? ".";
  }
}
function resolveDocPaths(startDir) {
  const warnings = [];
  let docRoot;
  try {
    docRoot = findDocRoot(startDir);
  } catch {
    docRoot = fallbackDocRoot(startDir);
  }
  const configPath = path.join(docRoot, DOC_CONFIG_FILENAME);
  let parsed;
  let parseOk = false;
  try {
    if (existsSafe(configPath)) {
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
    if (version !== void 0 && version !== DOC_CONFIG_SUPPORTED_VERSION) {
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
  return {
    docRoot,
    architecture: resolveConfiguredPath(
      docRoot,
      paths?.architecture,
      DEFAULT_ARCHITECTURE_PATH,
      "architecture",
      warnings
    ),
    gotchas: resolveConfiguredPath(
      docRoot,
      paths?.gotchas,
      DEFAULT_GOTCHAS_PATH,
      "gotchas",
      warnings
    ),
    warnings
  };
}
var DOMAINS_MARKER = "metatron:domains";
var FENCE_OPEN_RE = /^ {0,3}(`{3,}|~{3,})(.*)$/;
var FENCE_CLOSE_RE = /^ {0,3}(`+|~+)[ \t]*$/;
function isDomainsInfo(info) {
  const tokens = info.trim().split(/[ \t]+/).filter(Boolean);
  return tokens.length === 2 && tokens[0] === "json" && tokens[1] === DOMAINS_MARKER;
}
function findDomainsBlocks(text) {
  const lines = text.split("\n").map((line) => line.replace(/\r$/, ""));
  const blocks = [];
  const warnings = [];
  let fence = null;
  let isTarget = false;
  let openIndex = -1;
  for (let i = 0; i < lines.length; i++) {
    const t = lines[i];
    if (fence) {
      const m = FENCE_CLOSE_RE.exec(t);
      if (m && m[1][0] === fence.char && m[1].length >= fence.count) {
        if (isTarget)
          blocks.push({
            content: lines.slice(openIndex + 1, i).join("\n"),
            closed: true
          });
        fence = null;
        isTarget = false;
      }
      continue;
    }
    const open = FENCE_OPEN_RE.exec(t);
    if (open) {
      fence = { char: open[1][0], count: open[1].length };
      isTarget = isDomainsInfo(open[2]);
      openIndex = i;
    }
  }
  if (fence && isTarget)
    blocks.push({
      content: lines.slice(openIndex + 1).join("\n"),
      closed: false
    });
  if (blocks.length > 1)
    warnings.push(
      `\`${DOMAINS_MARKER}\` \u30D6\u30ED\u30C3\u30AF\u304C ${blocks.length} \u500B\u3042\u308A\u307E\u3059\u3002\u6700\u521D\u306E\u3082\u306E\u3060\u3051\u3092\u4F7F\u7528\u3057\u307E\u3059\u3002`
    );
  if (blocks.length > 0 && !blocks[0].closed)
    warnings.push(
      `\`${DOMAINS_MARKER}\` \u30D6\u30ED\u30C3\u30AF\u304C\u9589\u3058\u3066\u3044\u307E\u305B\u3093\u3002\u30D5\u30A1\u30A4\u30EB\u7D42\u7AEF\u307E\u3067\u3092\u5185\u5BB9\u3068\u3057\u3066\u6271\u3044\u307E\u3057\u305F\u3002`
    );
  else if (fence !== null)
    warnings.push(
      `\`${DOMAINS_MARKER}\` \u306E\u8D70\u67FB\u4E2D\u306B\u9589\u3058\u3066\u3044\u306A\u3044\u30B3\u30FC\u30C9\u30D5\u30A7\u30F3\u30B9\u3092\u691C\u51FA\u3057\u307E\u3057\u305F\u3002\u30DE\u30FC\u30AB\u30FC\u304C\u30D5\u30A7\u30F3\u30B9\u5185\u306B\u53D6\u308A\u8FBC\u307E\u308C\u3066\u3044\u306A\u3044\u304B\u78BA\u8A8D\u3057\u3066\u304F\u3060\u3055\u3044\u3002`
    );
  return { block: blocks[0] ?? null, warnings };
}
function validateDomainsValue(value) {
  if (!isPlainObject(value)) return null;
  const entries = Object.entries(value);
  if (entries.length === 0) return null;
  for (const [, globs] of entries) {
    if (!Array.isArray(globs) || globs.length === 0) return null;
    if (globs.some((g) => typeof g !== "string")) return null;
  }
  return value;
}
function readDomainsResult(startDir) {
  try {
    const { architecture } = resolveDocPaths(startDir);
    if (!fs.existsSync(architecture)) return { domains: null, warnings: [] };
    const { block, warnings } = findDomainsBlocks(
      fs.readFileSync(architecture, "utf8")
    );
    if (block === null) return { domains: null, warnings };
    let parsed;
    try {
      parsed = JSON.parse(block.content);
    } catch {
      return { domains: null, warnings };
    }
    return { domains: validateDomainsValue(parsed), warnings };
  } catch {
    return { domains: null, warnings: [] };
  }
}
function readDomains(startDir) {
  return readDomainsResult(startDir).domains;
}
function findProjectRoot(startDir) {
  let dir = startDir;
  while (true) {
    if (fs.existsSync(path.join(dir, ".codiel"))) return dir;
    const parent = path.dirname(dir);
    if (parent === dir) return startDir;
    dir = parent;
  }
}
export {
  DEFAULT_ARCHITECTURE_PATH,
  DEFAULT_GOTCHAS_PATH,
  DOC_CONFIG_FILENAME,
  DOC_CONFIG_SUPPORTED_VERSION,
  DOMAINS_MARKER,
  emit,
  findDocRoot,
  findProjectRoot,
  globToRegExp,
  pass,
  readDomains,
  readDomainsResult,
  readStdin,
  resolveDocPaths
};
