#!/usr/bin/env node

// src/hooks/guard-write.ts
import path3 from "node:path";

// src/codiel-state.ts
import fs from "node:fs";
import path from "node:path";
var STAGES = [
  ["init"],
  ["discuss"],
  ["design"],
  ["test-spec", "dev-plan"],
  ["implement"],
  ["test-loop"],
  ["pr"],
  ["review"],
  ["fix-loop"],
  ["triage"],
  ["finalize"]
];
var PHASES = STAGES.flat();
function readState(p) {
  return JSON.parse(fs.readFileSync(p, "utf8"));
}
function runDir(root, issue) {
  return path.join(root, ".codiel", "runs", `issue-${issue}`);
}
function tries(dir) {
  if (!fs.existsSync(dir)) return [];
  return fs.readdirSync(dir).filter((d) => /^try-\d+$/.test(d)).map((d) => Number(d.slice(4))).sort((a, b) => a - b);
}
function latestTry(root, issue) {
  const dir = runDir(root, issue);
  const ts = tries(dir);
  if (ts.length === 0) return null;
  const n = ts[ts.length - 1];
  const p = path.join(dir, `try-${n}`, "state.json");
  return { tryN: n, statePath: p, state: readState(p) };
}
function findActiveRun(root) {
  const runsRoot = path.join(root, ".codiel", "runs");
  if (!fs.existsSync(runsRoot)) return null;
  let best = null;
  for (const r of fs.readdirSync(runsRoot).filter((d) => /^issue-\d+$/.test(d))) {
    const latest = latestTry(root, Number(r.slice(6)));
    if (!latest) continue;
    if (latest.state.status === "active" || latest.state.status === "awaiting_human") {
      if (!best || latest.state.updatedAt > best.state.updatedAt) {
        best = {
          dir: path.dirname(latest.statePath),
          statePath: latest.statePath,
          state: latest.state
        };
      }
    }
  }
  return best;
}

// src/hooks/lib.ts
import { spawnSync } from "node:child_process";
import fs2 from "node:fs";
import path2 from "node:path";
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
    return fs2.realpathSync(dir);
  } catch {
    return dir;
  }
}
function existsSafe(target) {
  try {
    return fs2.existsSync(target);
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
    if (existsSafe(path2.join(dir, DOC_CONFIG_FILENAME))) return dir;
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
function resolveConfiguredPath(docRoot, raw, fallback, label, warnings) {
  const useFallback = () => path2.resolve(docRoot, fallback);
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
  const absolute = path2.resolve(docRoot, value);
  const relative = path2.relative(docRoot, absolute);
  const escapes = relative === "" || relative === ".." || relative.startsWith(`..${path2.sep}`) || path2.isAbsolute(relative);
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
    return path2.resolve(startDir ?? process.cwd());
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
  const configPath = path2.join(docRoot, DOC_CONFIG_FILENAME);
  let parsed;
  let parseOk = false;
  try {
    if (existsSafe(configPath)) {
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
    if (!fs2.existsSync(architecture)) return { domains: null, warnings: [] };
    const { block, warnings } = findDomainsBlocks(
      fs2.readFileSync(architecture, "utf8")
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
    if (fs2.existsSync(path2.join(dir, ".codiel"))) return dir;
    const parent = path2.dirname(dir);
    if (parent === dir) return startDir;
    dir = parent;
  }
}

// src/hooks/guard-write.ts
var DOC_PHASES = /* @__PURE__ */ new Set([
  "init",
  "discuss",
  "design",
  "test-spec",
  "dev-plan"
]);
var CODE_PHASES = /* @__PURE__ */ new Set([
  "implement",
  "test-loop",
  "fix-loop"
]);
function toDomainMap(value) {
  if (value === null) return null;
  const map = /* @__PURE__ */ Object.create(null);
  for (const [name, globs] of Object.entries(value)) map[name] = globs;
  return map;
}
try {
  const input = await readStdin();
  const cwd = input.cwd ?? process.cwd();
  const filePath = input.tool_input?.file_path;
  if (!filePath) pass();
  const abs = path3.resolve(cwd, filePath);
  if (/[/\\]\.codiel[/\\]runs[/\\].+[/\\]state\.json$/i.test(abs))
    emit(
      "deny",
      "state.json \u306F codiel-state \u30B9\u30AF\u30EA\u30D7\u30C8\u7D4C\u7531\u3067\u306E\u307F\u5909\u66F4\u3067\u304D\u307E\u3059(\u30D5\u30A7\u30FC\u30BA\u98DB\u3070\u3057\u30FB\u30B2\u30FC\u30C8\u507D\u88C5\u306E\u9632\u6B62)"
    );
  const codielRoot = findProjectRoot(cwd);
  const codielRel = path3.relative(codielRoot, abs).replaceAll("\\", "/");
  const run = findActiveRun(codielRoot);
  if (run?.state.status !== "active") pass();
  const phase = run.state.phase;
  if (DOC_PHASES.has(phase)) {
    if (codielRel.startsWith(".codiel/") || codielRel.startsWith("docs/"))
      pass();
    emit(
      "ask",
      `\u6587\u66F8\u30D5\u30A7\u30FC\u30BA(${phase})\u4E2D\u306B\u30B3\u30FC\u30C9\u9818\u57DF ${codielRel} \u3078\u66F8\u304D\u8FBC\u3082\u3046\u3068\u3057\u3066\u3044\u307E\u3059`
    );
  }
  if (CODE_PHASES.has(phase)) {
    if (/^\.codiel\/specs\/.+\/(spec|cases)\.md$/.test(codielRel))
      emit(
        "ask",
        `\u30C6\u30B9\u30C8\u4ED5\u69D8\u30FB\u671F\u5F85\u5024(${codielRel})\u306E\u5909\u66F4\u306F test-designer \u306E\u62C5\u5F53\u3067\u3059(${phase} \u4E2D\u306E\u5909\u66F4\u306F\u6539\u7AC4\u306E\u7591\u3044)`
      );
    const domain = run.state.domain;
    if (domain && !codielRel.startsWith(".codiel/")) {
      const docRoot = findDocRoot(cwd);
      const docRel = path3.relative(docRoot, abs).replaceAll("\\", "/");
      const domains = toDomainMap(readDomains(cwd));
      if (domains) {
        const globs = domains[domain];
        if (!globs)
          emit(
            "ask",
            `\u30C9\u30E1\u30A4\u30F3 ${domain} \u304C ARCHITECTURE \u306E\u30C9\u30E1\u30A4\u30F3\u30DE\u30C3\u30D7\u306B\u7121\u3044\u305F\u3081\u3001${docRel} \u3078\u306E\u66F8\u304D\u8FBC\u307F\u304C\u62C5\u5F53\u7BC4\u56F2\u5185\u304B\u5224\u5B9A\u3067\u304D\u307E\u305B\u3093(\u30C9\u30E1\u30A4\u30F3\u540D\u306E\u8AA4\u308A\u3001\u307E\u305F\u306F\u30C9\u30E1\u30A4\u30F3\u30DE\u30C3\u30D7\u306E\u8A18\u8FF0\u6F0F\u308C)`
          );
        if (!globs.some((g) => globToRegExp(g).test(docRel)))
          emit(
            "ask",
            `${docRel} \u306F\u30C9\u30E1\u30A4\u30F3 ${domain} \u306E\u62C5\u5F53\u7BC4\u56F2\u5916\u3067\u3059(${domain} \u306E\u7BC4\u56F2: ${globs.join(", ")})`
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
