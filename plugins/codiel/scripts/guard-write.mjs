#!/usr/bin/env node

// src/hooks/guard-write.ts
import fs4 from "node:fs";
import path4 from "node:path";

// src/codiel-state.ts
import fs3 from "node:fs";
import path3 from "node:path";

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
function findRepoRoot(startDir) {
  const start = realpathOrSelf(path.resolve(startDir));
  return gitToplevel(start) ?? start;
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
function loadPathsConfig(startDir) {
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
  return { docRoot, paths, warnings };
}
function resolveDocPaths(startDir) {
  const { docRoot, paths, warnings } = loadPathsConfig(startDir);
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
    const domains = validateDomainsValue(parsed);
    return {
      domains,
      warnings,
      unreadable: domains === null ? "invalid_shape" : null
    };
  } catch {
    return { domains: null, warnings: [], unreadable: "read_error" };
  }
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
var CODIEL_WORKTREES_RE = /[/\\]\.codiel[/\\]worktrees[/\\]/;
function findMainRoot(startDir) {
  const m = CODIEL_WORKTREES_RE.exec(startDir);
  if (m) return startDir.slice(0, m.index) || startDir.slice(0, 1);
  return findProjectRoot(startDir);
}

// src/raguel-records.ts
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import fs2 from "node:fs";
import os from "node:os";
import path2 from "node:path";
var DEFAULT_CASES_DIR = "~/.raguel";
function isObject(v) {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}
function readJsonObject(file) {
  let parsed;
  try {
    parsed = JSON.parse(fs2.readFileSync(file, "utf8"));
  } catch {
    throw new Error(`Raguel \u306E\u8A2D\u5B9A ${file} \u3092 JSON \u3068\u3057\u3066\u8AAD\u3081\u307E\u305B\u3093`);
  }
  if (!isObject(parsed))
    throw new Error(
      `Raguel \u306E\u8A2D\u5B9A ${file} \u306F JSON \u306E\u30AA\u30D6\u30B8\u30A7\u30AF\u30C8\u306B\u3057\u3066\u304F\u3060\u3055\u3044`
    );
  return parsed;
}
function readStorage(mainRoot) {
  let raguel;
  const env = process.env.RAGUEL_CONFIG;
  if (env) raguel = readJsonObject(env);
  else {
    const file = path2.join(mainRoot, ".codiel", "config.json");
    if (!fs2.existsSync(file)) return {};
    raguel = readJsonObject(file).raguel;
    if (raguel === void 0) return {};
    if (!isObject(raguel))
      throw new Error(`${file} \u306E raguel \u306F JSON \u306E\u30AA\u30D6\u30B8\u30A7\u30AF\u30C8\u306B\u3057\u3066\u304F\u3060\u3055\u3044`);
  }
  const storage = raguel.storage;
  if (storage === void 0) return {};
  if (!isObject(storage))
    throw new Error("raguel.storage \u306F JSON \u306E\u30AA\u30D6\u30B8\u30A7\u30AF\u30C8\u306B\u3057\u3066\u304F\u3060\u3055\u3044");
  const text = (key) => {
    const v = storage[key];
    if (v === void 0) return void 0;
    if (typeof v !== "string")
      throw new Error(`raguel.storage.${key} \u306F\u6587\u5B57\u5217\u306B\u3057\u3066\u304F\u3060\u3055\u3044`);
    return v;
  };
  return { casesDir: text("casesDir"), projectId: text("projectId") };
}
function resolveCasesDir(mainRoot, configured) {
  const dir = configured || DEFAULT_CASES_DIR;
  if (dir === "~") return path2.resolve(os.homedir());
  if (dir.startsWith("~/") || dir.startsWith("~\\"))
    return path2.resolve(os.homedir(), dir.slice(2));
  return path2.resolve(mainRoot, dir);
}
function realpathOrResolve(p) {
  try {
    return fs2.realpathSync(p);
  } catch {
    return path2.resolve(p);
  }
}
function gitCommonDir(dir) {
  try {
    const out = execFileSync(
      "git",
      ["-C", dir, "rev-parse", "--path-format=absolute", "--git-common-dir"],
      { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] }
    ).trim();
    return out ? realpathOrResolve(out) : null;
  } catch {
    return null;
  }
}
function resolveProjectId(projectRoot, storageProjectId) {
  if (storageProjectId) return storageProjectId;
  const common = gitCommonDir(projectRoot);
  const base = common ?? realpathOrResolve(projectRoot);
  let name;
  if (common === null) name = path2.basename(base);
  else if (path2.basename(base) === ".git")
    name = path2.basename(path2.dirname(base));
  else name = path2.basename(base).replace(/\.git$/, "");
  const hash = createHash("sha256").update(base).digest("hex").slice(0, 12);
  return `${name}-${hash}`;
}
function resolveRaguelStore(mainRoot) {
  const storage = readStorage(mainRoot);
  const casesDir = resolveCasesDir(mainRoot, storage.casesDir);
  const projectId = resolveProjectId(mainRoot, storage.projectId);
  return {
    casesDir,
    projectId,
    projectDir: path2.join(casesDir, "cases", projectId)
  };
}

// src/codiel-state.ts
var STAGES = [
  ["intent"],
  ["discuss"],
  ["design"],
  ["test-spec", "dev-plan"],
  ["test-code"],
  ["implement"],
  ["test-loop"],
  ["intent-sync"],
  ["pr"],
  ["review"],
  ["fix-loop"],
  ["triage"],
  ["finalize"]
];
var PHASES = STAGES.flat();
var DEFAULT_TESTS_DIR = "docs/codiel/tests";
var DEFAULT_RUNS_DIR = "docs/codiel/runs";
function readState(p) {
  return JSON.parse(fs3.readFileSync(p, "utf8"));
}
function runDir(root, slug) {
  return path3.join(root, ".codiel", "runs", slug);
}
function tries(dir) {
  if (!fs3.existsSync(dir)) return [];
  return fs3.readdirSync(dir).filter((d) => /^try-\d+$/.test(d)).map((d) => Number(d.slice(4))).sort((a, b) => a - b);
}
function latestTry(root, slug) {
  const dir = runDir(root, slug);
  for (const n of tries(dir).reverse()) {
    const p = path3.join(dir, `try-${n}`, "state.json");
    if (fs3.existsSync(p)) return { tryN: n, statePath: p, state: readState(p) };
  }
  return null;
}
function latestTries(root) {
  const runsRoot = path3.join(root, ".codiel", "runs");
  if (!fs3.existsSync(runsRoot)) return [];
  return fs3.readdirSync(runsRoot, { withFileTypes: true }).filter((d) => d.isDirectory()).map((d) => latestTry(root, d.name)).filter((t) => t !== null);
}
function findActiveRun(root) {
  let best = null;
  for (const latest of latestTries(root)) {
    const st = latest.state;
    if (isLegacy(st)) continue;
    if (st.status !== "active" && st.status !== "awaiting_human") continue;
    if (!best || st.updatedAt > best.state.updatedAt)
      best = {
        dir: path3.dirname(latest.statePath),
        statePath: latest.statePath,
        state: st
      };
  }
  return best;
}
function isLegacy(st) {
  return st.version !== 2 || !("test-code" in st.phases);
}
function readCodielConfig(codielRoot) {
  const file = path3.join(codielRoot, ".codiel", "config.json");
  if (!fs3.existsSync(file))
    return { testsDir: DEFAULT_TESTS_DIR, runsDir: DEFAULT_RUNS_DIR };
  let cfg;
  try {
    cfg = JSON.parse(fs3.readFileSync(file, "utf8"));
  } catch {
    throw new Error(`${file} \u3092 JSON \u3068\u3057\u3066\u8AAD\u3081\u307E\u305B\u3093`);
  }
  if (typeof cfg !== "object" || cfg === null || Array.isArray(cfg))
    throw new Error(`${file} \u306F JSON \u306E\u30AA\u30D6\u30B8\u30A7\u30AF\u30C8\u306B\u3057\u3066\u304F\u3060\u3055\u3044`);
  const obj = cfg;
  return {
    testsDir: configDir(obj, "testsDir", DEFAULT_TESTS_DIR),
    runsDir: configDir(obj, "runsDir", DEFAULT_RUNS_DIR)
  };
}
function configDir(cfg, key, fallback) {
  if (!(key in cfg)) return fallback;
  const v = cfg[key];
  if (typeof v !== "string") throw new Error(`${key} \u306F\u6587\u5B57\u5217\u306B\u3057\u3066\u304F\u3060\u3055\u3044`);
  if (v === "") throw new Error(`${key} \u306B\u7A7A\u6587\u5B57\u5217\u306F\u6307\u5B9A\u3067\u304D\u307E\u305B\u3093`);
  if (path3.posix.isAbsolute(v) || path3.win32.isAbsolute(v))
    throw new Error(`${key} \u306B\u306F repoRoot \u76F8\u5BFE\u306E\u30D1\u30B9\u3092\u66F8\u3044\u3066\u304F\u3060\u3055\u3044: ${v}`);
  if (v.split(/[/\\]/).includes(".."))
    throw new Error(`${key} \u306B .. \u306E\u30BB\u30B0\u30E1\u30F3\u30C8\u306F\u4F7F\u3048\u307E\u305B\u3093: ${v}`);
  return normalizeRel(v);
}
function normalizeRel(p) {
  return path3.posix.normalize(p.replaceAll("\\", "/")).replace(/\/+$/, "");
}

// src/hooks/guard-write.ts
var DOC_PHASES = /* @__PURE__ */ new Set([
  "intent",
  "discuss",
  "design",
  "test-spec",
  "dev-plan",
  "intent-sync"
]);
var CODE_PHASES2 = /* @__PURE__ */ new Set([
  "test-code",
  "implement",
  "test-loop",
  "fix-loop"
]);
var TEST_GUARD_PHASES = /* @__PURE__ */ new Set([
  "implement",
  "test-loop",
  "fix-loop"
]);
var WORKTREE_REL_RE = /^(\.codiel\/worktrees\/[^/]+\/[^/]+)(?:\/(.*))?$/;
var INTENT_DOC_RE = /^docs\/intents\/[^/]+\.md$/i;
var INTENT_DOC_PHASES = /* @__PURE__ */ new Set([
  null,
  "intent",
  "intent-sync",
  "triage"
]);
var INTENT_DOMAIN_RE = /^docs\/intents\/domains\/.+/i;
function toDomainMap(value) {
  if (value === null) return null;
  const map = /* @__PURE__ */ Object.create(null);
  for (const [name, globs] of Object.entries(value)) map[name] = globs;
  return map;
}
function realpathOrAncestor(abs) {
  let dir = abs;
  let rest = "";
  while (true) {
    try {
      return path4.join(fs4.realpathSync(dir), rest);
    } catch {
      const parent = path4.dirname(dir);
      if (parent === dir) return abs;
      rest = path4.join(path4.basename(dir), rest);
      dir = parent;
    }
  }
}
function withDomainWarnings(reason, warnings) {
  if (warnings.length === 0) return reason;
  return `${reason}
[\u30C9\u30E1\u30A4\u30F3\u30DE\u30C3\u30D7\u306E\u8B66\u544A] ${warnings.join(" / ")}`;
}
function toPosix(p) {
  return p.replaceAll("\\", "/");
}
function normalizeRel2(p) {
  return path4.posix.normalize(toPosix(p)).replace(/\/+$/, "");
}
function underDir(repoRel, dir) {
  return dir === "." || repoRel.startsWith(`${dir}/`);
}
function isE2eReport(repoRel, testsDir) {
  if (!underDir(repoRel, testsDir)) return false;
  const rest = testsDir === "." ? repoRel : repoRel.slice(testsDir.length + 1);
  return /(^|\/)reports\//.test(rest);
}
function frontmatterTests(text) {
  const lines = text.split(/\r?\n/);
  if (lines[0]?.trim() !== "---") return [];
  const unquote = (s) => s.trim().replace(/^(["'])(.*)\1$/, "$2");
  const tests = [];
  let inTests = false;
  for (const line of lines.slice(1)) {
    if (line.trim() === "---") break;
    const item = /^\s*-\s+(.+)$/.exec(line);
    if (inTests && (item || line.trim() === "")) {
      if (item) tests.push(unquote(item[1]));
      continue;
    }
    const key = /^tests:\s*(.*)$/.exec(line);
    inTests = key !== null;
    const flow = key && /^\[(.*)\]$/.exec(key[1].trim());
    if (flow) tests.push(...flow[1].split(",").map(unquote).filter(Boolean));
  }
  return tests;
}
function recordedTests(testsRoot) {
  const found = /* @__PURE__ */ new Set();
  const walk = (dir) => {
    if (!fs4.existsSync(dir)) return;
    for (const e of fs4.readdirSync(dir, { withFileTypes: true })) {
      const p = path4.join(dir, e.name);
      if (e.isDirectory()) walk(p);
      else if (e.name === "spec.md")
        for (const t of frontmatterTests(fs4.readFileSync(p, "utf8")))
          found.add(normalizeRel2(t));
    }
  };
  walk(testsRoot);
  return found;
}
function worktreeElements(st, wtRel) {
  const tables = [
    ["implement.steps", st.implement?.steps],
    ["testCode.units", st.testCode?.units],
    ["testLoop.units", st.testLoop?.units]
  ];
  const hits = [];
  for (const [name, table] of tables)
    for (const [id, step] of Object.entries(table ?? {}))
      if (step.worktree && normalizeRel2(step.worktree) === wtRel)
        hits.push({ label: `${name}[${id}]`, step });
  return hits;
}
var CODIEL_CONFIG_RE = /[/\\]\.codiel[/\\]config\.json$/i;
function isUnder(p, dir) {
  const rel = path4.relative(dir, p);
  return rel === "" || rel !== ".." && !rel.startsWith(`..${path4.sep}`) && !path4.isAbsolute(rel);
}
function raguelTarget(abs, mainRoot) {
  const absReal = realpathOrAncestor(abs);
  if (CODIEL_CONFIG_RE.test(abs) || CODIEL_CONFIG_RE.test(absReal))
    return ".codiel/config.json";
  const env = process.env.RAGUEL_CONFIG;
  if (env) {
    const file = path4.resolve(env);
    if (abs === file || absReal === realpathOrAncestor(file))
      return `RAGUEL_CONFIG \u304C\u6307\u3059 ${file}`;
  }
  let casesDir;
  try {
    casesDir = resolveRaguelStore(mainRoot).casesDir;
  } catch {
    return null;
  }
  if (isUnder(abs, casesDir) || isUnder(absReal, realpathOrAncestor(casesDir)))
    return `casesDir ${casesDir} \u306E\u914D\u4E0B`;
  return null;
}
try {
  const input = await readStdin();
  const cwd = input.cwd ?? process.cwd();
  const filePath = input.tool_input?.file_path;
  if (!filePath) pass();
  const abs = path4.resolve(cwd, filePath);
  if (/[/\\]\.codiel[/\\]runs[/\\].+[/\\]state\.json$/i.test(abs))
    emit(
      "deny",
      "state.json \u306F codiel-state \u30B9\u30AF\u30EA\u30D7\u30C8\u7D4C\u7531\u3067\u306E\u307F\u5909\u66F4\u3067\u304D\u307E\u3059(\u30D5\u30A7\u30FC\u30BA\u98DB\u3070\u3057\u30FB\u30B2\u30FC\u30C8\u507D\u88C5\u306E\u9632\u6B62)"
    );
  const mainRoot = findMainRoot(cwd);
  const run = findActiveRun(mainRoot);
  if (run) {
    const target = raguelTarget(abs, mainRoot);
    if (target)
      emit(
        "deny",
        `run \u306E\u9593(active\u30FBawaiting_human)\u306F Raguel \u306E\u8A2D\u5B9A\u3068\u8A18\u9332(${target})\u3092\u66F8\u304D\u63DB\u3048\u3089\u308C\u307E\u305B\u3093\u3002\u30B2\u30FC\u30C8\u306E\u507D\u88C5\u3092\u9632\u3050\u305F\u3081\u3067\u3059\u3002\u5909\u66F4\u3059\u308B\u3068\u304D\u306F run \u3092\u6B62\u3081\u308B\u304B\u3001\u5229\u7528\u8005\u304C\u81EA\u5206\u3067\u5909\u66F4\u3057\u3066\u304F\u3060\u3055\u3044`
      );
  }
  if (run?.state.status !== "active") pass();
  const phase = run.state.phase;
  const repoRoot = findRepoRoot(mainRoot);
  const mainReal = realpathOrAncestor(mainRoot);
  const absReal = realpathOrAncestor(abs);
  const wt = WORKTREE_REL_RE.exec(toPosix(path4.relative(mainReal, absReal)));
  const worktreeRoot = wt ? path4.join(mainReal, wt[1]) : null;
  const codielRel = wt ? wt[2] ?? "" : toPosix(path4.relative(mainRoot, abs));
  const repoRel = wt ? wt[2] ?? "" : toPosix(path4.relative(repoRoot, absReal));
  if (run.state.intent === repoRel) pass();
  let config = null;
  let configError = "";
  try {
    config = readCodielConfig(mainRoot);
  } catch (e) {
    configError = e.message;
  }
  if (INTENT_DOMAIN_RE.test(repoRel)) {
    if (phase === "intent-sync") pass();
    if (run.state.phases.triage?.status === "passed") pass();
    emit(
      "ask",
      `\u6301\u7D9A\u5C64(${repoRel})\u3078\u306E\u66F8\u304D\u8FBC\u307F\u306F intent-sync \u30D5\u30A7\u30FC\u30BA\u306E\u62C5\u5F53\u3067\u3059(\u73FE\u5728\u306E\u30D5\u30A7\u30FC\u30BA: ${phase})`
    );
  }
  if (INTENT_DOC_RE.test(repoRel)) {
    if (INTENT_DOC_PHASES.has(phase)) pass();
    emit(
      "ask",
      `intent \u6587\u66F8(${repoRel})\u3078\u306E\u66F8\u304D\u8FBC\u307F\u306F\u3053\u306E\u30D5\u30A7\u30FC\u30BA\u3067\u306F\u60F3\u5B9A\u3057\u3066\u3044\u307E\u305B\u3093(\u73FE\u5728\u306E\u30D5\u30A7\u30FC\u30BA: ${phase})`
    );
  }
  if (DOC_PHASES.has(phase)) {
    if (codielRel.startsWith(".codiel/") || codielRel.startsWith("docs/"))
      pass();
    if (config && (underDir(repoRel, config.testsDir) || underDir(repoRel, config.runsDir)))
      pass();
    emit(
      "ask",
      `\u6587\u66F8\u30D5\u30A7\u30FC\u30BA(${phase})\u4E2D\u306B\u30B3\u30FC\u30C9\u9818\u57DF ${codielRel} \u3078\u66F8\u304D\u8FBC\u3082\u3046\u3068\u3057\u3066\u3044\u307E\u3059`
    );
  }
  if (CODE_PHASES2.has(phase)) {
    if (TEST_GUARD_PHASES.has(phase)) {
      if (!config)
        emit(
          "ask",
          `.codiel/config.json \u304C\u4E0D\u6B63\u306A\u305F\u3081\u3001${phase} \u4E2D\u306E\u66F8\u304D\u8FBC\u307F\u304C\u30C6\u30B9\u30C8\u306E\u4FDD\u8B77\u306B\u5F53\u305F\u308B\u304B\u5224\u5B9A\u3067\u304D\u307E\u305B\u3093(${configError})`
        );
      const testsDir = config.testsDir;
      const testEdit = phase === "fix-loop" && run.state.testEdit === true;
      if (!testEdit && (underDir(repoRel, testsDir) && /(^|\/)(spec|cases)\.md$/.test(repoRel) || recordedTests(path4.join(repoRoot, testsDir)).has(repoRel)))
        emit(
          "ask",
          `\u30C6\u30B9\u30C8(${repoRel})\u306E\u5909\u66F4\u306F test-spec \u3068 test-code \u30D5\u30A7\u30FC\u30BA\u306E\u62C5\u5F53\u3067\u3059(${phase} \u4E2D\u306E\u5909\u66F4\u306F\u6539\u7AC4\u306E\u7591\u3044)`
        );
    }
    if (!config)
      emit(
        "ask",
        `.codiel/config.json \u304C\u4E0D\u6B63\u306A\u305F\u3081\u3001${phase} \u4E2D\u306E\u66F8\u304D\u8FBC\u307F\u304C run \u306E\u6587\u66F8(runsDir)\u306B\u5F53\u305F\u308B\u304B\u5224\u5B9A\u3067\u304D\u307E\u305B\u3093(${configError})`
      );
    if (underDir(repoRel, config.runsDir) && !isE2eReport(repoRel, config.testsDir))
      emit(
        "ask",
        `run \u306E\u6587\u66F8(${repoRel})\u306F\u6587\u66F8\u30D5\u30A7\u30FC\u30BA\u3067\u66F8\u304D\u307E\u3059(${phase} \u4E2D\u306E\u5909\u66F4\u306F\u60F3\u5B9A\u5916)`
      );
    let domain = run.state.domain;
    if (worktreeRoot) {
      const wtRel = normalizeRel2(path4.relative(repoRoot, worktreeRoot));
      const hits = worktreeElements(run.state, wtRel);
      if (hits.length >= 2)
        emit(
          "ask",
          `worktree ${wtRel} \u3092\u8A18\u9332\u3057\u305F\u8981\u7D20\u304C ${hits.length} \u500B\u3042\u308A(${hits.map((h) => h.label).join(", ")})\u3001\u5883\u754C\u306B\u4F7F\u3046\u30C9\u30E1\u30A4\u30F3\u3092 1 \u3064\u306B\u6C7A\u3081\u3089\u308C\u307E\u305B\u3093(worktree \u306E\u30D1\u30B9\u306F run \u306E\u4E2D\u3067\u4E00\u610F\u306E\u306F\u305A\u3067\u3059)`
        );
      domain = hits[0]?.step.domain ?? null;
    }
    if (domain && !codielRel.startsWith(".codiel/") && !isE2eReport(repoRel, config.testsDir)) {
      const cwdWt = WORKTREE_REL_RE.exec(
        toPosix(path4.relative(mainReal, realpathOrAncestor(cwd)))
      );
      const docStart = cwdWt ? path4.join(repoRoot, cwdWt[2] ?? "") : cwd;
      const mainDocRoot = findDocRoot(docStart);
      const docRoot = worktreeRoot ? path4.join(worktreeRoot, path4.relative(repoRoot, mainDocRoot)) : mainDocRoot;
      const docRel = toPosix(path4.relative(docRoot, absReal));
      const { domains: rawDomains, warnings } = readDomainsResult(docStart);
      const domains = toDomainMap(rawDomains);
      if (domains) {
        const globs = domains[domain];
        if (!globs)
          emit(
            "ask",
            withDomainWarnings(
              `\u30C9\u30E1\u30A4\u30F3 ${domain} \u304C ARCHITECTURE \u306E\u30C9\u30E1\u30A4\u30F3\u30DE\u30C3\u30D7\u306B\u7121\u3044\u305F\u3081\u3001${docRel} \u3078\u306E\u66F8\u304D\u8FBC\u307F\u304C\u62C5\u5F53\u7BC4\u56F2\u5185\u304B\u5224\u5B9A\u3067\u304D\u307E\u305B\u3093(\u30C9\u30E1\u30A4\u30F3\u540D\u306E\u8AA4\u308A\u3001\u307E\u305F\u306F\u30C9\u30E1\u30A4\u30F3\u30DE\u30C3\u30D7\u306E\u8A18\u8FF0\u6F0F\u308C)`,
              warnings
            )
          );
        if (!globs.some((g) => globToRegExp(g).test(docRel)))
          emit(
            "ask",
            withDomainWarnings(
              `${docRel} \u306F\u30C9\u30E1\u30A4\u30F3 ${domain} \u306E\u62C5\u5F53\u7BC4\u56F2\u5916\u3067\u3059(${domain} \u306E\u7BC4\u56F2: ${globs.join(", ")})`,
              warnings
            )
          );
      }
    }
    pass();
  }
  if (codielRel.startsWith(".codiel/")) pass();
  emit("ask", `\u30D5\u30A7\u30FC\u30BA ${phase} \u4E2D\u306E ${codielRel} \u3078\u306E\u66F8\u304D\u8FBC\u307F\u306F\u60F3\u5B9A\u5916\u3067\u3059`);
} catch (e) {
  emit(
    "ask",
    `guard-write \u306E\u5185\u90E8\u30A8\u30E9\u30FC(\u30D5\u30A7\u30A4\u30EB\u30AF\u30ED\u30FC\u30BA\u30C9): ${e.message}`
  );
}
export {
  isE2eReport
};
