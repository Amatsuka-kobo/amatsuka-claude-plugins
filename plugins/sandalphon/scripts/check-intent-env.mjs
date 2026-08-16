#!/usr/bin/env node

// src/check-intent-env.ts
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
var CONFIG_FILENAME = "metatron.config.json";
var SUPPORTED_CONFIG_VERSION = 1;
var DEFAULT_ARCHITECTURE_PATH = "docs/ARCHITECTURE.md";
var DEFAULT_GOTCHAS_PATH = "docs/GOTCHAS.md";
var DOMAINS_MARKER = "metatron:domains";
var TEST_FILE_SCAN_LIMIT = 200;
var GIT_TIMEOUT_MS = 5e3;
function existsSafe(target) {
  try {
    return fs.existsSync(target);
  } catch {
    return false;
  }
}
function isFile(target) {
  try {
    return fs.statSync(target).isFile();
  } catch {
    return false;
  }
}
function isDir(target) {
  try {
    return fs.statSync(target).isDirectory();
  } catch {
    return false;
  }
}
function readFileSafe(target) {
  try {
    return fs.readFileSync(target, "utf8");
  } catch {
    return null;
  }
}
function readdirSafe(target) {
  try {
    return fs.readdirSync(target).sort();
  } catch {
    return [];
  }
}
function readdirEntriesSafe(target) {
  try {
    return fs.readdirSync(target, { withFileTypes: true }).sort((a, b) => a.name < b.name ? -1 : a.name > b.name ? 1 : 0);
  } catch {
    return [];
  }
}
function realpathOrSelf(dir) {
  try {
    return fs.realpathSync(dir);
  } catch {
    return dir;
  }
}
function cwdSafe() {
  try {
    return process.cwd();
  } catch {
    return ".";
  }
}
function resolveSafe(value) {
  try {
    return path.resolve(value);
  } catch {
    return value;
  }
}
var startDir = realpathOrSelf(resolveSafe(process.argv[2] ?? cwdSafe()));
function git(...args) {
  try {
    const res = spawnSync("git", args, {
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
var gitToplevelRaw = git("rev-parse", "--show-toplevel");
var gitToplevel = gitToplevelRaw ? resolveSafe(gitToplevelRaw) : null;
var repoRoot = isGitRepo ? gitToplevel : null;
var remoteUrl = isGitRepo ? git("remote", "get-url", "origin") : null;
var repoSlug = remoteUrl?.match(
  /^(?:git@|ssh:\/\/git@|https?:\/\/)github\.com[/:]([^/]+\/[^/]+?)(?:\.git)?\/?$/
)?.[1] ?? null;
function ghExitZero(args) {
  try {
    return spawnSync("gh", args, { encoding: "utf8" }).status === 0;
  } catch {
    return false;
  }
}
var ghInstalled = ghExitZero(["--version"]);
var ghAuthenticated = ghInstalled && ghExitZero(["auth", "status"]);
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
var tplDir = repoRoot ? path.join(repoRoot, ".github", "ISSUE_TEMPLATE") : null;
if (tplDir) {
  const files = readdirSafe(tplDir);
  const read = (f) => readFileSafe(path.join(tplDir, f));
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
function findDocRoot() {
  let dir = startDir;
  while (true) {
    if (existsSafe(path.join(dir, CONFIG_FILENAME))) return dir;
    const parent = path.dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }
  if (gitToplevel) return gitToplevel;
  return startDir;
}
var docRoot = findDocRoot();
var configWarnings = [];
function isPlainObject(value) {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
function normalizeSeparators(value) {
  return value.replace(/\\/g, "/");
}
function looksAbsolute(value) {
  return path.isAbsolute(value) || /^[A-Za-z]:\//.test(value) || value.startsWith("//");
}
function resolveConfiguredPath(raw, fallback, label) {
  const useFallback = () => path.resolve(docRoot, fallback);
  if (raw === void 0) return useFallback();
  if (typeof raw !== "string" || raw.trim() === "") {
    configWarnings.push(
      `paths.${label} \u304C\u7A7A\u3067\u306A\u3044\u6587\u5B57\u5217\u3067\u306A\u3044\u305F\u3081\u3001\u65E2\u5B9A\u5024 ${fallback} \u3092\u4F7F\u7528\u3057\u307E\u3059\u3002`
    );
    return useFallback();
  }
  const value = normalizeSeparators(raw);
  if (looksAbsolute(value)) {
    configWarnings.push(
      `paths.${label} \u304C\u7D76\u5BFE\u30D1\u30B9(${raw})\u306E\u305F\u3081\u3001\u65E2\u5B9A\u5024 ${fallback} \u3092\u4F7F\u7528\u3057\u307E\u3059\u3002`
    );
    return useFallback();
  }
  const absolute = path.resolve(docRoot, value);
  const relative = path.relative(docRoot, absolute);
  const escapes = relative === "" || relative === ".." || relative.startsWith(`..${path.sep}`) || path.isAbsolute(relative);
  if (escapes) {
    configWarnings.push(
      `paths.${label} \u304C\u30EB\u30FC\u30C8\u5916(${raw})\u3092\u6307\u3059\u305F\u3081\u3001\u65E2\u5B9A\u5024 ${fallback} \u3092\u4F7F\u7528\u3057\u307E\u3059\u3002`
    );
    return useFallback();
  }
  return absolute;
}
function loadConfigPaths() {
  const configPath = path.join(docRoot, CONFIG_FILENAME);
  let source;
  if (existsSafe(configPath)) {
    const raw = readFileSafe(configPath);
    if (raw === null) {
      configWarnings.push("\u8A2D\u5B9A\u3092\u8AAD\u3081\u306A\u304B\u3063\u305F\u305F\u3081\u65E2\u5B9A\u5024\u3092\u4F7F\u7528\u3057\u307E\u3059\u3002");
    } else {
      let parsed;
      let parseOk = false;
      try {
        parsed = JSON.parse(raw);
        parseOk = true;
      } catch {
        configWarnings.push("\u8A2D\u5B9A\u306E JSON \u304C\u58CA\u308C\u3066\u3044\u308B\u305F\u3081\u65E2\u5B9A\u5024\u3092\u4F7F\u7528\u3057\u307E\u3059\u3002");
      }
      if (parseOk) {
        if (isPlainObject(parsed)) {
          source = parsed;
        } else {
          configWarnings.push(
            "\u8A2D\u5B9A\u306E\u30C8\u30C3\u30D7\u30EC\u30D9\u30EB\u304C\u30AA\u30D6\u30B8\u30A7\u30AF\u30C8\u3067\u306A\u3044\u305F\u3081\u65E2\u5B9A\u5024\u3092\u4F7F\u7528\u3057\u307E\u3059\u3002"
          );
        }
      }
    }
  }
  if (source !== void 0) {
    const version = source.version;
    if (version !== void 0 && version !== SUPPORTED_CONFIG_VERSION) {
      configWarnings.push(
        `\u8A2D\u5B9A\u306E version(${JSON.stringify(version)})\u304C\u672A\u77E5\u306E\u305F\u3081\u3001\u5168\u9805\u76EE\u306B\u65E2\u5B9A\u5024\u3092\u4F7F\u7528\u3057\u307E\u3059\u3002`
      );
      source = void 0;
    }
  }
  const pathsRaw = source?.paths;
  const paths = isPlainObject(pathsRaw) ? pathsRaw : void 0;
  if (pathsRaw !== void 0 && paths === void 0) {
    configWarnings.push(
      "paths \u304C\u30AA\u30D6\u30B8\u30A7\u30AF\u30C8\u3067\u306A\u3044\u305F\u3081\u3001\u6587\u66F8\u30D1\u30B9\u306B\u65E2\u5B9A\u5024\u3092\u4F7F\u7528\u3057\u307E\u3059\u3002"
    );
  }
  return {
    architecture: resolveConfiguredPath(
      paths?.architecture,
      DEFAULT_ARCHITECTURE_PATH,
      "architecture"
    ),
    gotchas: resolveConfiguredPath(
      paths?.gotchas,
      DEFAULT_GOTCHAS_PATH,
      "gotchas"
    )
  };
}
var resolvedDocPaths = loadConfigPaths();
var architecturePath = isFile(resolvedDocPaths.architecture) ? resolvedDocPaths.architecture : null;
var gotchasPath = isFile(resolvedDocPaths.gotchas) ? resolvedDocPaths.gotchas : null;
var FENCE_OPEN_RE = /^ {0,3}(`{3,}|~{3,})(.*)$/;
var FENCE_CLOSE_RE = /^ {0,3}(`+|~+)[ \t]*$/;
function isDomainsInfo(info) {
  const tokens = info.trim().split(/[ \t]+/).filter(Boolean);
  return tokens.length === 2 && tokens[0] === "json" && tokens[1] === DOMAINS_MARKER;
}
function findDomainsContent(text) {
  const lines = text.split("\n").map((line) => line.replace(/\r$/, ""));
  let fence = null;
  let isTarget = false;
  let openIndex = -1;
  for (let i = 0; i < lines.length; i++) {
    const t = lines[i];
    if (fence) {
      const m = FENCE_CLOSE_RE.exec(t);
      if (m && m[1][0] === fence.char && m[1].length >= fence.count) {
        if (isTarget) return lines.slice(openIndex + 1, i).join("\n");
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
  if (fence && isTarget) return lines.slice(openIndex + 1).join("\n");
  return null;
}
function readDomains(file) {
  const unreadable = { domainsReadable: false, domainCount: 0 };
  if (!file) return unreadable;
  const text = readFileSafe(file);
  if (text === null) return unreadable;
  const content = findDomainsContent(text);
  if (content === null) return unreadable;
  let parsed;
  try {
    parsed = JSON.parse(content);
  } catch {
    return unreadable;
  }
  if (!isPlainObject(parsed)) return unreadable;
  const entries = Object.entries(parsed);
  if (entries.length === 0) return unreadable;
  for (const [, globs] of entries) {
    if (!Array.isArray(globs) || globs.length === 0) return unreadable;
    if (globs.some((g) => typeof g !== "string")) return unreadable;
  }
  return { domainsReadable: true, domainCount: entries.length };
}
var domains = readDomains(architecturePath);
function findCodielRoot() {
  let dir = startDir;
  while (true) {
    if (isDir(path.join(dir, ".codiel"))) return dir;
    const parent = path.dirname(dir);
    if (parent === dir) return null;
    dir = parent;
  }
}
var codielRoot = findCodielRoot();
var codielDirExists = codielRoot !== null;
var runDirs = codielRoot ? readdirEntriesSafe(path.join(codielRoot, ".codiel", "runs")).filter((entry) => entry.isDirectory()).map((entry) => entry.name) : [];
var codielReady = codielDirExists && domains.domainsReadable;
var intentsDirPath = repoRoot ? path.join(repoRoot, "docs", "intents") : null;
var intentsDir = intentsDirPath && isDir(intentsDirPath) ? intentsDirPath : null;
function parseIntentDoc(file, content) {
  const block = content.match(/^---\r?\n([\s\S]*?)\r?\n---/)?.[1];
  if (block === void 0) return null;
  const top = parseTopLevel(block.replace(/\r/g, ""));
  if (top.intent === void 0) return null;
  const title = content.match(/^# intent:\s*(.*)$/m)?.[1]?.trim() ?? null;
  return {
    file,
    title: title === "" ? null : title,
    slug: top.slug ?? "",
    status: top.status ?? "",
    issue: top.issue ?? ""
  };
}
var existingIntents = [];
if (intentsDir) {
  for (const name of readdirSafe(intentsDir)) {
    if (!name.endsWith(".md")) continue;
    const content = readFileSafe(path.join(intentsDir, name));
    if (content === null) continue;
    const parsed = parseIntentDoc(name, content);
    if (parsed) existingIntents.push(parsed);
  }
}
var contextDocs = [
  architecturePath,
  path.join(docRoot, "CLAUDE.md"),
  gotchasPath,
  path.join(docRoot, "README.md")
].filter((p) => p !== null && isFile(p));
function detectPackageManager() {
  if (existsSafe(path.join(docRoot, "pnpm-lock.yaml"))) return "pnpm";
  if (existsSafe(path.join(docRoot, "yarn.lock"))) return "yarn";
  if (existsSafe(path.join(docRoot, "bun.lockb")) || existsSafe(path.join(docRoot, "bun.lock"))) {
    return "bun";
  }
  return "npm";
}
var TEST_FILE_RE = /\.(test|spec)\.[^.]+$/;
var PY_TEST_RE = /^test_.*\.py$/;
var GO_TEST_RE = /_test\.go$/;
function looksLikeTestFile(name) {
  return TEST_FILE_RE.test(name) || PY_TEST_RE.test(name) || GO_TEST_RE.test(name);
}
function findTestFiles(limit, maxMatches) {
  const matches = [];
  const queue = [docRoot];
  let visited = 0;
  for (let i = 0; i < queue.length; i++) {
    if (visited >= limit || matches.length >= maxMatches) break;
    const dir = queue[i];
    for (const entry of readdirEntriesSafe(dir)) {
      if (entry.isDirectory()) {
        if (entry.name === "node_modules" || entry.name === ".git") continue;
        queue.push(path.join(dir, entry.name));
        continue;
      }
      if (!entry.isFile()) continue;
      visited++;
      if (visited > limit) break;
      if (looksLikeTestFile(entry.name)) {
        matches.push(
          path.relative(docRoot, path.join(dir, entry.name)).split(path.sep).join("/")
        );
        if (matches.length >= maxMatches) break;
      }
    }
  }
  return matches;
}
function detectTestRunner() {
  const evidence = [];
  let command = null;
  const pkgRaw = readFileSafe(path.join(docRoot, "package.json"));
  if (pkgRaw !== null) {
    let pkg;
    try {
      pkg = JSON.parse(pkgRaw);
    } catch {
      pkg = void 0;
    }
    const scripts = isPlainObject(pkg) ? pkg.scripts : void 0;
    if (isPlainObject(scripts) && typeof scripts.test === "string") {
      evidence.push("package.json:scripts.test");
      const pm = detectPackageManager();
      command = pm === "bun" ? "bun run test" : `${pm} test`;
    }
  }
  const configEvidence = [];
  for (const name of readdirSafe(docRoot)) {
    if (/^vitest\.config\.[cm]?[jt]s$/.test(name)) {
      configEvidence.push({ file: name, command: null });
    } else if (/^jest\.config\.([cm]?[jt]s|json)$/.test(name)) {
      configEvidence.push({ file: name, command: null });
    } else if (name === "pytest.ini") {
      configEvidence.push({ file: name, command: "pytest" });
    } else if (name === "go.mod") {
      configEvidence.push({ file: name, command: "go test ./..." });
    } else if (name === "Cargo.toml") {
      configEvidence.push({ file: name, command: "cargo test" });
    }
  }
  const pyprojectRaw = readFileSafe(path.join(docRoot, "pyproject.toml"));
  if (pyprojectRaw !== null && /^\s*\[tool\.pytest/m.test(pyprojectRaw)) {
    configEvidence.push({
      file: "pyproject.toml:[tool.pytest]",
      command: "pytest"
    });
  }
  for (const entry of configEvidence) {
    evidence.push(entry.file);
    if (command === null && entry.command !== null) command = entry.command;
  }
  for (const file of findTestFiles(TEST_FILE_SCAN_LIMIT, 3)) evidence.push(file);
  return { detected: evidence.length > 0, evidence, command };
}
var testRunner = detectTestRunner();
console.log(
  JSON.stringify(
    {
      isGitRepo,
      repoRoot,
      remoteUrl,
      repoSlug,
      ghInstalled,
      ghAuthenticated,
      templates,
      blankIssuesEnabled,
      docRoot,
      configWarnings,
      projectDocs: {
        architecture: architecturePath,
        gotchas: gotchasPath,
        domainsReadable: domains.domainsReadable,
        domainCount: domains.domainCount
      },
      codielReady,
      codielHarness: {
        dirExists: codielDirExists,
        codielRoot,
        runDirs
      },
      intentsDir,
      existingIntents,
      contextDocs,
      testRunner
    },
    null,
    2
  )
);
