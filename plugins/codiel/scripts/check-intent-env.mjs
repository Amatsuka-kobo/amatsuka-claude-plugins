#!/usr/bin/env node

// src/check-intent-env.ts
import { spawnSync as spawnSync2 } from "node:child_process";
import fs2 from "node:fs";
import path2 from "node:path";

// src/hooks/lib.ts
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
var DOC_CONFIG_FILENAME = "metatron.config.json";
var DOC_CONFIG_SUPPORTED_VERSION = 1;
var DEFAULT_ARCHITECTURE_PATH = "docs/ARCHITECTURE.md";
var DEFAULT_GOTCHAS_PATH = "docs/GOTCHAS.md";
var DEFAULT_RULES_DIR = ".claude/rules/metatron";
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
function findDocRoot(startDir2) {
  const start = realpathOrSelf(path.resolve(startDir2 ?? process.cwd()));
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
function resolveConfiguredPath(docRoot2, raw, fallback, label, warnings) {
  const useFallback = () => path.resolve(docRoot2, fallback);
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
  const absolute = path.resolve(docRoot2, value);
  const relative = path.relative(docRoot2, absolute);
  const escapes = relative === "" || relative === ".." || relative.startsWith(`..${path.sep}`) || path.isAbsolute(relative);
  if (escapes) {
    warnings.push(
      `paths.${label} \u304C\u30EB\u30FC\u30C8\u5916(${raw})\u3092\u6307\u3059\u305F\u3081\u3001\u65E2\u5B9A\u5024 ${fallback} \u3092\u4F7F\u7528\u3057\u307E\u3059\u3002`
    );
    return useFallback();
  }
  return absolute;
}
function fallbackDocRoot(startDir2) {
  try {
    return path.resolve(startDir2 ?? process.cwd());
  } catch {
    return startDir2 ?? ".";
  }
}
function loadPathsConfig(startDir2) {
  const warnings = [];
  let docRoot2;
  try {
    docRoot2 = findDocRoot(startDir2);
  } catch {
    docRoot2 = fallbackDocRoot(startDir2);
  }
  const configPath = path.join(docRoot2, DOC_CONFIG_FILENAME);
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
  return { docRoot: docRoot2, paths, warnings };
}
function resolveDocPaths(startDir2) {
  const { docRoot: docRoot2, paths, warnings } = loadPathsConfig(startDir2);
  return {
    docRoot: docRoot2,
    architecture: resolveConfiguredPath(
      docRoot2,
      paths?.architecture,
      DEFAULT_ARCHITECTURE_PATH,
      "architecture",
      warnings
    ),
    gotchas: resolveConfiguredPath(
      docRoot2,
      paths?.gotchas,
      DEFAULT_GOTCHAS_PATH,
      "gotchas",
      warnings
    ),
    warnings
  };
}
function resolveRulesDir(startDir2) {
  const { docRoot: docRoot2, paths, warnings } = loadPathsConfig(startDir2);
  return {
    docRoot: docRoot2,
    rulesDir: resolveConfiguredPath(
      docRoot2,
      paths?.rulesDir,
      DEFAULT_RULES_DIR,
      "rulesDir",
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
function readDomainsResult(startDir2) {
  try {
    const { architecture } = resolveDocPaths(startDir2);
    if (!fs.existsSync(architecture))
      return {
        domains: null,
        warnings: [],
        unreadable: "architecture_missing"
      };
    const { block, warnings } = findDomainsBlocks(
      fs.readFileSync(architecture, "utf8")
    );
    if (block === null)
      return { domains: null, warnings, unreadable: "block_missing" };
    let parsed;
    try {
      parsed = JSON.parse(block.content);
    } catch {
      return { domains: null, warnings, unreadable: "invalid_json" };
    }
    const domains2 = validateDomainsValue(parsed);
    return {
      domains: domains2,
      warnings,
      unreadable: domains2 === null ? "invalid_shape" : null
    };
  } catch {
    return { domains: null, warnings: [], unreadable: "read_error" };
  }
}

// src/check-intent-env.ts
var GIT_TIMEOUT_MS = 5e3;
function isFile(target) {
  try {
    return fs2.statSync(target).isFile();
  } catch {
    return false;
  }
}
function isDir(target) {
  try {
    return fs2.statSync(target).isDirectory();
  } catch {
    return false;
  }
}
function isReadableDir(target) {
  if (!isDir(target)) return false;
  try {
    fs2.accessSync(target, fs2.constants.R_OK | fs2.constants.X_OK);
    return true;
  } catch {
    return false;
  }
}
function readFileSafe(target) {
  try {
    return fs2.readFileSync(target, "utf8");
  } catch {
    return null;
  }
}
function readdirSafe(target) {
  try {
    return fs2.readdirSync(target).sort();
  } catch {
    return [];
  }
}
function resolveStartDir() {
  try {
    return path2.resolve(process.argv[2] ?? process.cwd());
  } catch {
    return process.argv[2] ?? ".";
  }
}
var startDir = resolveStartDir();
function git(...args) {
  try {
    const res = spawnSync2("git", args, {
      cwd: startDir,
      encoding: "utf8",
      timeout: GIT_TIMEOUT_MS,
      windowsHide: true
    });
    if (res.status !== 0) return null;
    const out = res.stdout?.trim();
    return out ? out : null;
  } catch {
    return null;
  }
}
var isGitRepo = git("rev-parse", "--is-inside-work-tree") === "true";
var gitToplevel2 = git("rev-parse", "--show-toplevel");
var repoRoot = isGitRepo && gitToplevel2 ? path2.resolve(gitToplevel2) : null;
var remoteUrl = isGitRepo ? git("remote", "get-url", "origin") : null;
var remoteMatch = remoteUrl?.match(
  /^(?:git@|ssh:\/\/git@|https?:\/\/)([^/:]+)[/:]([^/]+\/[^/]+?)(?:\.git)?\/?$/
);
var remoteHost = remoteMatch?.[1] ?? null;
var isGithubHost = remoteHost !== null && /^(?:github\.com|[^./]+\.ghe\.com)$/.test(remoteHost);
var repoSlug = isGithubHost ? remoteMatch?.[2] ?? null : null;
function ghExitZero(args) {
  try {
    return spawnSync2("gh", args, { encoding: "utf8" }).status === 0;
  } catch {
    return false;
  }
}
var ghInstalled = ghExitZero(["--version"]);
var ghAuthenticated = ghInstalled && ghExitZero(
  remoteHost ? ["auth", "status", "--hostname", remoteHost] : ["auth", "status"]
);
function ghVersionOf() {
  if (!ghInstalled) return null;
  try {
    const res = spawnSync2("gh", ["--version"], { encoding: "utf8" });
    return res.stdout?.match(/gh version (\d+\.\d+\.\d+)/)?.[1] ?? null;
  } catch {
    return null;
  }
}
var ghVersion = ghVersionOf();
function versionGte(a, b) {
  const pa = a.split(".").map(Number);
  const pb = b.split(".").map(Number);
  for (let i = 0; i < Math.max(pa.length, pb.length); i++) {
    const diff = (pa[i] ?? 0) - (pb[i] ?? 0);
    if (diff !== 0) return diff > 0;
  }
  return true;
}
var ghAttachSupported = ghVersion !== null && versionGte(ghVersion, "2.99.0") && isGithubHost;
var unquote = (v) => v.replace(/^(["'])(.*)\1$/, "$2");
function parseTopLevel(src) {
  const top = {};
  const lines = src.split("\n");
  for (let i = 0; i < lines.length; i++) {
    const m = lines[i].match(/^([A-Za-z_][\w-]*):\s*(.*)$/);
    if (!m) continue;
    let value = m[2].trim();
    if (!value) {
      const items = [];
      while (i + 1 < lines.length && /^\s+-\s+/.test(lines[i + 1])) {
        items.push(lines[++i].replace(/^\s+-\s+/, "").trim());
      }
      value = items.join(",");
    }
    top[m[1]] = value;
  }
  return top;
}
function parseTemplate(file, content) {
  let src = content;
  if (file.endsWith(".md")) {
    src = content.match(/^---\n([\s\S]*?)\n---/)?.[1] ?? "";
  }
  const top = parseTopLevel(src);
  const labelsRaw = top.labels?.match(/^\[(.*)\]$/)?.[1] ?? top.labels ?? "";
  return {
    file,
    name: unquote(top.name ?? ""),
    about: unquote(top.description ?? top.about ?? ""),
    title: unquote(top.title ?? ""),
    labels: labelsRaw.split(",").map((s) => unquote(s.trim())).filter(Boolean)
  };
}
var templates = [];
var blankIssuesEnabled = true;
var tplDir = repoRoot ? path2.join(repoRoot, ".github", "ISSUE_TEMPLATE") : null;
if (tplDir) {
  const files = readdirSafe(tplDir);
  const read = (f) => readFileSafe(path2.join(tplDir, f));
  templates = files.filter((f) => /\.(md|ya?ml)$/.test(f) && f !== "config.yml").map((f) => ({ f, content: read(f) })).filter(
    (entry) => entry.content !== null
  ).map(({ f, content }) => parseTemplate(f, content));
  const configRaw = files.includes("config.yml") ? read("config.yml") : null;
  if (configRaw !== null) {
    const config = parseTopLevel(configRaw);
    if (config.blank_issues_enabled !== void 0) {
      blankIssuesEnabled = config.blank_issues_enabled !== "false";
    }
  }
}
var docPaths = resolveDocPaths(startDir);
var docRoot = docPaths.docRoot;
var architecturePath = isFile(docPaths.architecture) ? docPaths.architecture : null;
var gotchasPath = isFile(docPaths.gotchas) ? docPaths.gotchas : null;
var metatronRules = isReadableDir(resolveRulesDir(startDir).rulesDir);
var domains = readDomainsResult(startDir);
var configWarnings = [...docPaths.warnings, ...domains.warnings];
var intentsDirPath = repoRoot ? path2.join(repoRoot, "docs", "intents") : null;
var intentsDir = intentsDirPath && isDir(intentsDirPath) ? intentsDirPath : null;
function parseIntentTopLevel(block) {
  const top = {};
  for (const line of block.split("\n")) {
    const m = line.match(/^([A-Za-z_][\w-]*):\s*(.*)$/);
    if (m) top[m[1]] = m[2].trim();
  }
  return top;
}
function parseIntentDoc(file, content) {
  const block = content.match(
    /^---\r?\n([\s\S]*?)\r?\n---[ \t]*(?:\r?\n|$)/
  )?.[1];
  if (block === void 0) return null;
  const top = parseIntentTopLevel(block.replace(/\r/g, ""));
  if (top.intent === void 0) return null;
  const title = content.match(/^# intent:\s*(.*)$/m)?.[1]?.trim() ?? null;
  return {
    file,
    title: title === "" ? null : title,
    slug: top.slug ?? "",
    status: top.status ?? "",
    issue: top.issue ?? "",
    intent: top.intent
  };
}
var existingIntents = [];
if (intentsDir) {
  for (const name of readdirSafe(intentsDir)) {
    if (!name.endsWith(".md")) continue;
    const content = readFileSafe(path2.join(intentsDir, name));
    if (content === null) continue;
    const parsed = parseIntentDoc(name, content);
    if (parsed) existingIntents.push(parsed);
  }
}
var contextDocs = [
  path2.join(docRoot, "CLAUDE.md"),
  path2.join(docRoot, "README.md")
].filter((p) => isFile(p));
console.log(
  JSON.stringify(
    {
      isGitRepo,
      repoRoot,
      remoteUrl,
      remoteHost,
      repoSlug,
      ghInstalled,
      ghVersion,
      ghAuthenticated,
      ghAttachSupported,
      templates,
      blankIssuesEnabled,
      docRoot,
      configWarnings,
      projectDocs: {
        architecture: architecturePath,
        gotchas: gotchasPath,
        metatronRules,
        domainsReadable: domains.domains !== null,
        domainCount: domains.domains ? Object.keys(domains.domains).length : 0
      },
      intentsDir,
      existingIntents,
      contextDocs
    },
    null,
    2
  )
);
