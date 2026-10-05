#!/usr/bin/env node

// src/codiel-state.ts
import fs3 from "node:fs";
import path3 from "node:path";

// src/hooks/lib.ts
import fs from "node:fs";
import path from "node:path";
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
var EVALUATIONS_FILE = "evaluations.jsonl";
var OUTCOMES_FILE = "outcomes.jsonl";
var VERDICT_FILE = "verdict.json";
var CODE_PHASES = /* @__PURE__ */ new Set([
  "carry-over",
  "test-code",
  "implement",
  "test-loop",
  "fix-loop"
]);
var DOC_PHASES = /* @__PURE__ */ new Set([
  "design",
  "test-spec",
  "dev-plan",
  "intent-sync"
]);
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
function readJsonl(file) {
  if (!fs2.existsSync(file)) return [];
  const rows = [];
  fs2.readFileSync(file, "utf8").split("\n").forEach((line, i) => {
    if (!line.trim()) return;
    try {
      rows.push(JSON.parse(line));
    } catch {
      throw new Error(`Raguel \u306E\u8A18\u9332\u306E\u884C\u304C\u8AAD\u3081\u307E\u305B\u3093: ${file}:${i + 1}`);
    }
  });
  return rows;
}
function readEvaluationIndex(store) {
  return readJsonl(path2.join(store.projectDir, EVALUATIONS_FILE));
}
function readOutcomes(store) {
  const map = /* @__PURE__ */ new Map();
  for (const r of readJsonl(
    path2.join(store.projectDir, OUTCOMES_FILE)
  ))
    map.set(r.evaluationId, r);
  return map;
}
function readVerdictRecord(casePath) {
  try {
    const v = JSON.parse(
      fs2.readFileSync(path2.join(casePath, VERDICT_FILE), "utf8")
    );
    return isObject(v) ? v : void 0;
  } catch {
    return void 0;
  }
}
function findEvaluation(index, evaluationId) {
  return index.findLast((e) => e.evaluationId === evaluationId);
}
function gitHead(dir) {
  try {
    return execFileSync("git", ["-C", dir, "rev-parse", "HEAD"], {
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"]
    }).trim();
  } catch {
    return null;
  }
}
function gitMergeBase(dir, a, b) {
  try {
    return execFileSync("git", ["-C", dir, "merge-base", a, b], {
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"]
    }).trim();
  } catch {
    return null;
  }
}
function isAncestor(dir, ancestor, descendant) {
  try {
    execFileSync(
      "git",
      ["-C", dir, "merge-base", "--is-ancestor", ancestor, descendant],
      { stdio: "ignore" }
    );
    return true;
  } catch {
    return false;
  }
}
function changedPathsSince(dir, base) {
  try {
    return execFileSync(
      "git",
      ["-C", dir, "diff", "--name-only", "--no-renames", "-z", base, "HEAD"],
      { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] }
    ).split("\0").filter(Boolean);
  } catch {
    return null;
  }
}
function evaluatedFiles(store, evaluationId) {
  const row = findEvaluation(readEvaluationIndex(store), evaluationId);
  const v = row && readVerdictRecord(row.casePath);
  if (!v || !isObject(v.subject) || !Array.isArray(v.subject.files)) return null;
  return v.subject.files.map((f) => path2.posix.normalize(f.path));
}
function sha256OfFile(file) {
  try {
    return createHash("sha256").update(fs2.readFileSync(file)).digest("hex");
  } catch {
    return null;
  }
}
function missingExpectedDoc(input, files) {
  const paths = files.map((f) => path2.posix.normalize(f.path));
  const listed = paths.length > 0 ? paths.join(", ") : "\u306A\u3057";
  const need = (expected, found) => found ? null : `${input.phase} \u306E\u8A55\u4FA1\u306B ${expected} \u304C\u542B\u307E\u308C\u3066\u3044\u307E\u305B\u3093(\u8A55\u4FA1\u3057\u305F\u30D5\u30A1\u30A4\u30EB: ${listed})\u3002${expected} \u3092 paths \u306B\u5165\u308C\u3066\u8A55\u4FA1\u3057\u76F4\u3057\u3066\u304F\u3060\u3055\u3044`;
  if (input.phase === "design" || input.phase === "dev-plan") {
    const expected = path2.posix.join(input.runDocsDir, `${input.phase}.md`);
    return need(expected, paths.includes(expected));
  }
  if (input.phase === "test-spec") {
    const underTests = (p) => input.testsDir === "." || p.startsWith(`${input.testsDir}/`);
    return need(
      `${input.testsDir}/ \u914D\u4E0B\u306E spec.md \u304B cases.md`,
      paths.some(
        (p) => underTests(p) && ["spec.md", "cases.md"].includes(path2.posix.basename(p))
      )
    );
  }
  return null;
}
function checkEvaluationRow(row, input) {
  if (!row)
    return `Raguel \u306E\u8A55\u4FA1\u306E\u7D22\u5F15\u306B evaluationId ${input.evaluationId} \u306E\u884C\u304C\u3042\u308A\u307E\u305B\u3093(\u8A55\u4FA1\u306E\u8A18\u9332\u304C\u7121\u3044\u3002\u6383\u9664\u6E08\u307F\u304B\u3001\u5B58\u5728\u3057\u306A\u3044)`;
  if (row.runId !== input.runId || row.phase !== input.phase)
    return `evaluationId ${input.evaluationId} \u306F\u5225\u306E run \u304B\u30D5\u30A7\u30FC\u30BA\u306E\u8A55\u4FA1\u3067\u3059(\u7D22\u5F15: runId ${row.runId}\u30FBphase ${row.phase}\u3001\u3053\u306E run: runId ${input.runId}\u30FBphase ${input.phase})`;
  if (row.verdict !== input.verdict)
    return `--verdict ${input.verdict} \u304C Raguel \u306E\u8A55\u4FA1\u306E verdict ${row.verdict} \u3068\u5408\u3044\u307E\u305B\u3093(evaluationId: ${input.evaluationId})`;
  return null;
}
function checkGate(input) {
  const index = readEvaluationIndex(input.store);
  const row = findEvaluation(index, input.evaluationId);
  const rowProblem = checkEvaluationRow(row, input);
  if (rowProblem || !row) return rowProblem;
  const last = index.findLast(
    (e) => e.runId === input.runId && e.phase === input.phase
  );
  if (last && last.evaluationId !== input.evaluationId)
    return `evaluationId ${input.evaluationId} \u306F ${input.phase} \u306E\u6700\u65B0\u306E\u8A55\u4FA1\u3067\u306F\u3042\u308A\u307E\u305B\u3093(\u6700\u65B0: ${last.evaluationId}\u3001verdict: ${last.verdict})`;
  const v = readVerdictRecord(row.casePath);
  if (!v) return `verdict.json \u3092\u8AAD\u3081\u307E\u305B\u3093: ${row.casePath}`;
  for (const key of ["evaluationId", "runId", "phase", "verdict"])
    if (v[key] !== row[key])
      return `verdict.json \u306E ${key}(${String(v[key])})\u304C\u8A55\u4FA1\u306E\u7D22\u5F15(${row[key]})\u3068\u5408\u3044\u307E\u305B\u3093: ${row.casePath}`;
  if (input.humanApproved) {
    const outcome = readOutcomes(input.store).get(input.evaluationId);
    if (!outcome)
      return `--human-approved \u306B\u306F Raguel \u306E\u88C1\u5B9A\u306E\u8A18\u9332\u304C\u8981\u308A\u307E\u3059(evaluationId ${input.evaluationId} \u306E\u884C\u304C\u3042\u308A\u307E\u305B\u3093)\u3002record_outcome \u3067\u4EBA\u306E\u88C1\u5B9A\u3092\u8A18\u9332\u3057\u3066\u304F\u3060\u3055\u3044`;
    const want = row.verdict === "ASK" ? "as-is" : row.verdict === "STOP" ? "false-positive" : null;
    if (want && outcome.ruling !== want)
      return `${row.verdict} \u3092 --human-approved \u3067\u901A\u3059\u306B\u306F\u88C1\u5B9A\u306E ruling \u304C ${want} \u3067\u3042\u308B\u3053\u3068\u304C\u8981\u308A\u307E\u3059(\u8A18\u9332: ${outcome.ruling})`;
  }
  const subject = isObject(v.subject) ? v.subject : void 0;
  if (!subject) return `verdict.json \u306B subject \u304C\u3042\u308A\u307E\u305B\u3093: ${row.casePath}`;
  if (CODE_PHASES.has(input.phase)) {
    const head = gitHead(input.root);
    if (!head || subject.head !== head)
      return `\u8A55\u4FA1\u3057\u305F HEAD(${subject.head})\u304C\u73FE\u5728\u306E HEAD(${head})\u3068\u5408\u3044\u307E\u305B\u3093\u3002\u4ECA\u306E HEAD \u3067\u8A55\u4FA1\u3057\u76F4\u3057\u3066\u304F\u3060\u3055\u3044`;
    if (!input.startHead || subject.base !== input.startHead)
      return `\u8A55\u4FA1\u306E\u8D77\u70B9(${subject.base})\u304C\u30D5\u30A7\u30FC\u30BA\u306E\u958B\u59CB\u306E HEAD(${input.startHead ?? "\u8A18\u9332\u306A\u3057"})\u3068\u5408\u3044\u307E\u305B\u3093\u3002baseRef \u306B\u30D5\u30A7\u30FC\u30BA\u306E\u958B\u59CB\u306E HEAD \u3092\u6E21\u3057\u3066\u8A55\u4FA1\u3057\u76F4\u3057\u3066\u304F\u3060\u3055\u3044`;
    if (subject.paths !== void 0)
      return `\u8A55\u4FA1\u306E\u7BC4\u56F2\u304C paths(${JSON.stringify(subject.paths)})\u3067\u7D5E\u3089\u308C\u3066\u3044\u307E\u3059\u3002code \u7CFB\u30D5\u30A7\u30FC\u30BA\u306F paths \u3092\u6E21\u3055\u305A\u306B\u3001\u30D5\u30A7\u30FC\u30BA\u306E\u5DEE\u5206\u306E\u5168\u4F53\u3092\u8A55\u4FA1\u3057\u76F4\u3057\u3066\u304F\u3060\u3055\u3044`;
  }
  if (DOC_PHASES.has(input.phase)) {
    const files = Array.isArray(subject.files) ? subject.files : [];
    for (const f of files) {
      const now = sha256OfFile(path2.join(input.root, f.path));
      if (now !== f.sha256)
        return `${f.path} \u304C\u8A55\u4FA1\u306E\u5F8C\u306B\u5909\u308F\u3063\u3066\u3044\u307E\u3059(\u8A18\u9332: ${f.sha256}\u3001\u73FE\u5728: ${now})\u3002\u4ECA\u306E\u4E2D\u8EAB\u3067\u8A55\u4FA1\u3057\u76F4\u3057\u3066\u304F\u3060\u3055\u3044`;
    }
    return missingExpectedDoc(input, files);
  }
  return null;
}
function resubmitNote(stopEvaluationId) {
  return `STOP(evaluationId: ${stopEvaluationId})\u306E\u5F8C\u306E\u518D\u63D0\u51FA\u3067\u901A\u3057\u305F`;
}
function unresolvedStops(store, runId, resubmitNotes = []) {
  const outcomes = readOutcomes(store);
  return readEvaluationIndex(store).filter(
    (e) => e.runId === runId && e.verdict === "STOP" && e.judgeStatus === "ok" && outcomes.get(e.evaluationId)?.ruling !== "false-positive" && !resubmitNotes.some((n) => n?.includes(resubmitNote(e.evaluationId)))
  ).map((e) => e.evaluationId);
}

// src/codiel-state.ts
var STAGES = [
  ["intent"],
  ["carry-over"],
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
var GATED = /* @__PURE__ */ new Set([
  "intent",
  "carry-over",
  "design",
  "test-spec",
  "dev-plan",
  "test-code",
  "implement",
  "test-loop",
  "intent-sync",
  "fix-loop"
]);
var SKIPPABLE = /* @__PURE__ */ new Set(["discuss", "design", "fix-loop"]);
var LIGHT_ONLY_SKIPPABLE = /* @__PURE__ */ new Set(["discuss", "design"]);
var TERMINAL = /* @__PURE__ */ new Set([
  "stopped",
  "awaiting_outcome",
  "completed",
  "rejected"
]);
var SLUG_RE = /^[a-z0-9]+(-[a-z0-9]+)*$/;
var SLUG_MAX = 40;
var V1_RUN_RE = /^issue-\d+$/;
var INTENT_PATH_RE = /^docs\/intents\/[^/]+\.md$/;
var INTEGRATIONS = ["github", "local"];
var VERDICTS = ["PROCEED", "ASK", "STOP"];
var BOOL_FLAGS = [
  "active",
  "human-approved",
  "intent-only",
  "final",
  "abandon-waits"
];
var LOCKFILES = /* @__PURE__ */ new Set([
  "pnpm-lock.yaml",
  "package-lock.json",
  "npm-shrinkwrap.json",
  "yarn.lock",
  "bun.lockb",
  "bun.lock",
  "Cargo.lock",
  "poetry.lock",
  "uv.lock",
  "Gemfile.lock",
  "composer.lock",
  "go.sum"
]);
var PARALLEL_MAX = 4;
var STEP_STATUSES = [
  "pending",
  "running",
  "reviewing",
  "merged",
  "failed"
];
var STEP_TRANSITIONS = {
  "pending>running": ["worktree", "branch", "base"],
  "running>reviewing": [],
  "reviewing>running": [],
  "reviewing>merged": ["head"],
  "running>failed": [],
  "reviewing>failed": [],
  "failed>pending": []
};
var STEP_RECORD_FLAGS = ["worktree", "branch", "base", "head"];
var STEP_KINDS = ["step", "test-code", "test-loop"];
var SPEC_ID_RE = /^(units\/.+|e2e\/backend\/.+|e2e\/(frontend|cli)\/[^/]+)$/;
var DEFAULT_TESTS_DIR = "docs/codiel/tests";
var DEFAULT_RUNS_DIR = "docs/codiel/runs";
var fail = (msg, code = 1) => {
  process.stderr.write(`${msg}
`);
  process.exit(code);
};
var ok = (obj) => {
  process.stdout.write(`${JSON.stringify(obj, null, 2)}
`);
  return void 0;
};
function readState(p) {
  const st = JSON.parse(fs3.readFileSync(p, "utf8"));
  if (st.version === 2 && st.phases && !("carry-over" in st.phases)) {
    const { intent, ...rest } = st.phases;
    st.phases = {
      intent,
      "carry-over": {
        status: "passed",
        attempts: 0,
        evaluationId: null,
        verdict: "SKIPPED",
        note: "carry-over \u306E\u5C0E\u5165\u524D\u306E run"
      },
      ...rest
    };
  }
  return st;
}
function writeState(p, state) {
  state.updatedAt = (/* @__PURE__ */ new Date()).toISOString();
  const tmp = `${p}.tmp`;
  fs3.writeFileSync(tmp, `${JSON.stringify(state, null, 2)}
`);
  fs3.renameSync(tmp, p);
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
function isLegacy(st) {
  return st.version !== 2 || !("test-code" in st.phases);
}
function legacyMessage(st) {
  if (st.version !== 2) {
    const n = st.issue;
    return `codiel: .codiel/runs/issue-${n} \u306F codiel 0.x \u306E run(state version 1\u3001status: ${st.status})\u3067\u3042\u308A\u3001\u3053\u306E\u7248\u3067\u306F\u518D\u958B\u3067\u304D\u306A\u3044\u3002codiel 0.x \u3067\u5B8C\u4E86\u3055\u305B\u308B\u304B\u3001\`codiel-state stop --slug issue-${n} --reason migrate\` \u3067\u6B62\u3081\u3066\u304B\u3089\u3001\`/codiel:run ${n}\` \u3067\u65B0\u3057\u3044 run \u3092\u59CB\u3081\u308B\u3002`;
  }
  return `codiel: .codiel/runs/${st.runId} \u306F test-code \u30D5\u30A7\u30FC\u30BA\u3092\u6301\u305F\u306A\u3044 state \u306E run(status: ${st.status})\u3067\u3042\u308A\u3001\u3053\u306E\u7248\u3067\u306F\u518D\u958B\u3067\u304D\u306A\u3044\u3002\`codiel-state stop --slug ${st.runId} --reason migrate\` \u3067\u6B62\u3081\u3066\u304B\u3089\u3001\`/codiel:run ${st.intent}\` \u3067\u540C\u3058 intent \u306E\u65B0\u3057\u3044 try \u3092\u59CB\u3081\u308B\u3002`;
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
function gitignoreLines(testsDir) {
  const base = normalizeRel(testsDir);
  const prefix = base === "." ? "" : `${base}/`;
  const reports = `${prefix}e2e/**/reports/[0-9]*-try[0-9]*`;
  return [
    ".codiel/runs/",
    ".codiel/reports/",
    `${reports}/**`,
    `!${reports}/results.json`,
    `!${reports}/summary.md`,
    `!${reports}/failure.md`
  ];
}
function missingGitignoreLines(codielRoot, required) {
  const file = path3.join(codielRoot, ".gitignore");
  const present = new Set(
    fs3.existsSync(file) ? fs3.readFileSync(file, "utf8").split(/\r?\n/).map((l) => l.trim()).filter((l) => l !== "" && !l.startsWith("#")) : []
  );
  return required.filter((l) => !present.has(l));
}
function parseArgs(argv) {
  const pos = [];
  const flags = {};
  const bools = /* @__PURE__ */ new Set();
  for (let i = 0; i < argv.length; i++) {
    const name = argv[i].slice(2);
    if (!argv[i].startsWith("--")) pos.push(argv[i]);
    else if (BOOL_FLAGS.includes(name)) bools.add(name);
    else {
      flags[name] = argv[i + 1];
      i++;
    }
  }
  return { pos, flags, bools };
}
function escapeRegExp(s) {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
function expandBraces(glob) {
  const open = glob.indexOf("{");
  if (open === -1) return [glob];
  const cuts = [];
  let depth = 0;
  for (let i = open; i < glob.length; i++) {
    const c = glob[i];
    if (c === "{") depth++;
    else if (c === "," && depth === 1) cuts.push(i);
    else if (c === "}" && --depth === 0) {
      const head = glob.slice(0, open);
      const tail = glob.slice(i + 1);
      const alts = [];
      let from = open + 1;
      for (const cut of [...cuts, i]) {
        alts.push(glob.slice(from, cut));
        from = cut + 1;
      }
      return alts.flatMap((alt) => expandBraces(head + alt + tail));
    }
  }
  return [glob];
}
function fixedSegments(glob) {
  const segs = glob.split("/").filter((s) => s !== "" && s !== ".");
  const i = segs.findIndex((s) => /[*?[{]/.test(s));
  return i === -1 ? segs : segs.slice(0, i);
}
function globsOverlap(a, b) {
  for (const x of expandBraces(a).map(fixedSegments))
    for (const y of expandBraces(b).map(fixedSegments)) {
      const n = Math.min(x.length, y.length);
      if (x.slice(0, n).every((s, i) => s === y[i])) return true;
    }
  return false;
}
function touchesLockfile(files) {
  return files.flatMap(expandBraces).some((f) => LOCKFILES.has(f.split("/").pop() ?? ""));
}
function planWaves(steps) {
  const ids = Object.keys(steps);
  for (const id of ids)
    for (const d of steps[id].deps) {
      if (!(d in steps))
        throw new Error(
          `\u30B9\u30C6\u30C3\u30D7 ${id} \u306E\u524D\u63D0\u30B9\u30C6\u30C3\u30D7 ${d} \u306F\u767B\u9332\u3055\u308C\u3066\u3044\u307E\u305B\u3093`
        );
      if (steps[d].final && !steps[id].final)
        throw new Error(
          `\u30B9\u30C6\u30C3\u30D7 ${id} \u306F\u6700\u7D42\u30B9\u30C6\u30C3\u30D7 ${d} \u3092\u524D\u63D0\u306B\u3067\u304D\u307E\u305B\u3093(\u6700\u7D42\u30B9\u30C6\u30C3\u30D7\u306F\u5168\u30B0\u30EB\u30FC\u30D7\u306E\u5F8C\u306B\u5B9F\u884C\u3059\u308B)`
        );
    }
  const placed = /* @__PURE__ */ new Set();
  const readyOf = (rest2) => {
    const ready = rest2.filter(
      (id) => steps[id].deps.every((d) => placed.has(d))
    );
    if (ready.length === 0)
      throw new Error(`\u5FAA\u74B0\u4F9D\u5B58\u304C\u3042\u308A\u307E\u3059: ${rest2.join(", ")}`);
    return ready;
  };
  const groups = [];
  let rest = ids.filter((id) => !steps[id].final);
  while (rest.length > 0) {
    const ready = readyOf(rest);
    const group = touchesLockfile(steps[ready[0]].files) ? { steps: [ready[0]], mode: "serial" } : { steps: [], mode: "parallel" };
    if (group.mode === "parallel")
      for (const id of ready) {
        if (group.steps.length === PARALLEL_MAX) break;
        const { files } = steps[id];
        if (touchesLockfile(files)) continue;
        const clash = group.steps.some(
          (m) => steps[m].files.some((a) => files.some((b) => globsOverlap(a, b)))
        );
        if (!clash) group.steps.push(id);
      }
    for (const id of group.steps) placed.add(id);
    rest = rest.filter((id) => !placed.has(id));
    groups.push(group);
  }
  const final = [];
  let finals = ids.filter((id) => steps[id].final);
  while (finals.length > 0) {
    const id = readyOf(finals)[0];
    final.push(id);
    placed.add(id);
    finals = finals.filter((f) => f !== id);
  }
  return { groups, final };
}
function oneOf(flags, name, values) {
  const v = flags[name];
  if (v === void 0) fail(`--${name} \u304C\u5FC5\u8981\u3067\u3059`);
  if (!values.includes(v))
    fail(`\u4E0D\u6B63\u306A --${name}: ${v}\u3002\u8A31\u3055\u308C\u308B\u5024\u306F ${values.join(", ")} \u3067\u3059`);
  return v;
}
function imageUpload(flags, integration) {
  const v = oneOf(flags, "image-upload", [
    "gh-attach",
    "chrome",
    "gh-attach,chrome",
    "none"
  ]);
  const github = integration === "github";
  return {
    ghAttach: github && v.includes("gh-attach"),
    chrome: github && v.includes("chrome")
  };
}
function jsonList(flags, name, required) {
  const raw = flags[name];
  if (raw === void 0) {
    if (required) fail(`--${name} \u304C\u5FC5\u8981\u3067\u3059`);
    return [];
  }
  let v = null;
  try {
    v = JSON.parse(raw);
  } catch {
    fail(`--${name} \u306F JSON \u306E\u914D\u5217\u3067\u6E21\u3057\u3066\u304F\u3060\u3055\u3044: ${raw}`);
  }
  if (!Array.isArray(v) || !v.every((s) => typeof s === "string" && s !== ""))
    fail(`--${name} \u306F\u7A7A\u3067\u306A\u3044\u6587\u5B57\u5217\u306E JSON \u914D\u5217\u3067\u6E21\u3057\u3066\u304F\u3060\u3055\u3044: ${raw}`);
  return v;
}
function stepKind(flags) {
  return "kind" in flags ? oneOf(flags, "kind", STEP_KINDS) : "step";
}
function stepTable(st, kind) {
  if (kind === "test-code") {
    st.testCode ??= { units: {} };
    return st.testCode.units;
  }
  if (kind === "test-loop") {
    st.testLoop ??= { units: {} };
    return st.testLoop.units;
  }
  st.implement ??= { steps: {} };
  return st.implement.steps;
}
function isSpecDirId(id) {
  return SPEC_ID_RE.test(id) && !/[:\\]/.test(id) && id.split("/").every((s) => s !== "" && s !== "." && s !== "..");
}
function normalizeRel(p) {
  return path3.posix.normalize(p.replaceAll("\\", "/")).replace(/\/+$/, "");
}
function newState(slug, tryN, fields) {
  const phases = {};
  for (const ph of PHASES)
    phases[ph] = {
      status: "pending",
      attempts: 0,
      evaluationId: null,
      verdict: null,
      note: null
    };
  const now = (/* @__PURE__ */ new Date()).toISOString();
  return {
    version: 2,
    runId: slug,
    try: tryN,
    ...fields,
    raguelRunId: `${slug}-try-${tryN}`,
    status: "active",
    phase: null,
    phases,
    pr: { url: null },
    limits: { maxFixAttempts: 5 },
    stopReason: null,
    incidents: [],
    createdAt: now,
    updatedAt: now,
    raguelContract: 2
  };
}
function raguelStore(root) {
  try {
    return resolveRaguelStore(findMainRoot(root));
  } catch (e) {
    return fail(`Raguel \u306E\u8A18\u9332\u3092\u8AAD\u3081\u307E\u305B\u3093: ${e.message}`);
  }
}
function oldContractMessage(st) {
  return `codiel: \u3053\u306E run \u306F Raguel \u306E\u8A18\u9332\u306E\u5F62\u5F0F\u304C\u53E4\u3044(raguelContract \u306A\u3057)\u305F\u3081\u3001\u3053\u306E\u7248\u3067\u306F\u30B2\u30FC\u30C8\u3092\u901A\u305B\u306A\u3044\u3002\`codiel-state stop --slug ${st.runId} --reason migrate\` \u3067\u6B62\u3081\u3066\u304B\u3089\u3001\`/codiel:run ${st.intent}\` \u3067\u540C\u3058 intent \u306E\u65B0\u3057\u3044 try \u3092\u59CB\u3081\u308B\u3002`;
}
function continuityProblem(root, st, phase, head) {
  const stageIdx = STAGES.findIndex((s) => s.includes(phase));
  for (let i = stageIdx - 1; i >= 0; i--) {
    const gated = STAGES[i].filter((p) => GATED.has(p));
    if (gated.length === 0) continue;
    const found = gated.flatMap((p) => {
      const h = st.phases[p].passedHead;
      return h ? [{ phase: p, passedHead: h }] : [];
    });
    if (found.length === 0) return null;
    const names = found.map((c) => c.phase).join("\u30FB");
    if (found.some((c) => CODE_PHASES.has(c.phase))) {
      const { passedHead } = found[0];
      return passedHead === head ? null : `\u8A55\u4FA1\u306E\u5F8C\u306B\u30B3\u30DF\u30C3\u30C8\u304C\u3042\u308B(${passedHead}..${head})\u3002${names} \u3092\u8A55\u4FA1\u3057\u76F4\u3057\u3066\u304F\u3060\u3055\u3044`;
    }
    const base = found.find(
      (c) => found.every((o) => isAncestor(root, c.passedHead, o.passedHead))
    ) ?? found[0];
    const allowed = /* @__PURE__ */ new Set();
    for (const c of found) {
      const files = evaluatedFiles(
        raguelStore(root),
        st.phases[c.phase].evaluationId ?? ""
      );
      if (!files)
        return `${c.phase} \u306E\u8A55\u4FA1\u306E\u8A18\u9332(evaluationId: ${st.phases[c.phase].evaluationId})\u304B\u3089\u8A55\u4FA1\u3057\u305F\u6587\u66F8\u3092\u8AAD\u3081\u307E\u305B\u3093`;
      for (const f of files) allowed.add(f);
    }
    const changed = changedPathsSince(root, base.passedHead);
    if (!changed)
      return `\u8A55\u4FA1\u306E\u5F8C\u306E\u5909\u66F4\u3092\u8AAD\u3081\u307E\u305B\u3093(git diff ${base.passedHead} HEAD \u304C\u5931\u6557\u3057\u305F)`;
    const extra = changed.filter((p) => !allowed.has(p));
    return extra.length === 0 ? null : `\u8A55\u4FA1\u306E\u5F8C\u306B\u3001\u8A55\u4FA1\u3057\u305F\u6587\u66F8\u306E\u307B\u304B\u306E\u30D5\u30A1\u30A4\u30EB\u306E\u30B3\u30DF\u30C3\u30C8\u304C\u3042\u308B(${base.passedHead}..${head}: ${extra.join(", ")})\u3002${names} \u3092\u8A55\u4FA1\u3057\u76F4\u3057\u3066\u304F\u3060\u3055\u3044`;
  }
  return null;
}
function loadRun(root, flags, allowLegacy = false) {
  const slug = flags.slug;
  if (!slug) fail("--slug \u304C\u5FC5\u8981\u3067\u3059");
  if (!SLUG_RE.test(slug)) fail(`\u4E0D\u6B63\u306A --slug: ${slug}`);
  const latest = latestTry(root, slug);
  if (!latest) fail(`run \u304C\u5B58\u5728\u3057\u307E\u305B\u3093: ${slug}`);
  if (isLegacy(latest.state) && !allowLegacy) fail(legacyMessage(latest.state));
  return latest;
}
function waitReport(latest, id) {
  return path3.join(path3.dirname(latest.statePath), "waits", `${id}.md`);
}
function main(argv, root = process.cwd()) {
  const { pos, flags, bools } = parseArgs(argv);
  const cmd = pos[0];
  if (cmd === "init") {
    const slug = flags.slug;
    if (!slug) fail("--slug \u304C\u5FC5\u8981\u3067\u3059");
    if (!SLUG_RE.test(slug) || slug.length > SLUG_MAX)
      fail(
        `\u4E0D\u6B63\u306A --slug: ${slug}\u3002\u82F1\u5C0F\u6587\u5B57\u3068\u6570\u5B57\u3092\u30CF\u30A4\u30D5\u30F3\u3067\u3064\u306A\u3044\u3060 ${SLUG_MAX} \u6587\u5B57\u4EE5\u5185\u306B\u3057\u3066\u304F\u3060\u3055\u3044`
      );
    if (V1_RUN_RE.test(slug))
      fail(
        `--slug \u306B issue-<N> \u306E\u5F62\u306F\u4F7F\u3048\u307E\u305B\u3093(codiel 0.x \u306E run \u30C7\u30A3\u30EC\u30AF\u30C8\u30EA\u3068\u91CD\u306A\u308B\u305F\u3081): ${slug}`
      );
    const rawIntent = flags.intent;
    if (!rawIntent) fail("--intent \u304C\u5FC5\u8981\u3067\u3059");
    if (path3.isAbsolute(rawIntent))
      fail(`--intent \u306B\u306F repoRoot \u76F8\u5BFE\u306E\u30D1\u30B9\u3092\u6E21\u3057\u3066\u304F\u3060\u3055\u3044: ${rawIntent}`);
    const intent = path3.posix.normalize(rawIntent.replaceAll("\\", "/"));
    if (!INTENT_PATH_RE.test(intent))
      fail(
        `--intent \u306B\u306F docs/intents/ \u76F4\u4E0B\u306E .md \u3092 repoRoot \u76F8\u5BFE\u3067\u6E21\u3057\u3066\u304F\u3060\u3055\u3044: ${rawIntent}`
      );
    if ("issue" in flags && !/^[1-9]\d*$/.test(flags.issue ?? ""))
      fail(`\u4E0D\u6B63\u306A --issue: ${flags.issue}`);
    const integration = oneOf(flags, "integration", INTEGRATIONS);
    const scale = oneOf(flags, "scale", ["standard", "light"]);
    const knowledgeTarget = oneOf(flags, "knowledge-target", [
      "metatron",
      "intents"
    ]);
    const upload = imageUpload(flags, integration);
    const domainMode = "domain-mode" in flags ? oneOf(flags, "domain-mode", ["mapped", "unscoped"]) : void 0;
    const latest = latestTry(root, slug);
    if (latest && !TERMINAL.has(latest.state.status))
      fail(
        isLegacy(latest.state) ? legacyMessage(latest.state) : `\u672A\u5B8C\u4E86\u306E try \u304C\u3042\u308A\u307E\u3059: ${latest.statePath}(status: ${latest.state.status})\u3002resume \u3059\u308B\u304B stop \u3057\u3066\u304F\u3060\u3055\u3044`
      );
    if (latest?.state.status === "stopped" && !bools.has("human-approved")) {
      const st = latest.state;
      const stopPhases = Object.entries(st.phases).filter(([, ph]) => ph.verdict === "STOP" && !ph.humanApproved).map(([name, ph]) => `${name}(evaluationId: ${ph.evaluationId})`);
      if (st.stopReason === "raguel-stop" || stopPhases.length > 0)
        fail(
          `\u524D\u306E try(${latest.statePath})\u306F Raguel \u306E STOP \u3067\u6B62\u307E\u3063\u3066\u3044\u307E\u3059(stopReason: ${st.stopReason}` + (stopPhases.length > 0 ? `\u3001STOP \u306E\u30D5\u30A7\u30FC\u30BA: ${stopPhases.join(", ")}` : "") + ")\u3002\u65B0\u3057\u3044 try \u3092\u4F5C\u3063\u3066\u3088\u3044\u304B\u4EBA\u306B\u78BA\u304B\u3081\u3001\u627F\u8A8D\u3055\u308C\u305F\u3089 --human-approved \u3092\u4ED8\u3051\u3066 init \u3057\u76F4\u3057\u3066\u304F\u3060\u3055\u3044"
        );
    }
    if (latest && !bools.has("human-approved")) {
      let stops = [];
      try {
        stops = unresolvedStops(
          raguelStore(root),
          latest.state.raguelRunId,
          Object.values(latest.state.phases).map((p2) => p2.note)
        );
      } catch (e) {
        fail(`Raguel \u306E\u8A18\u9332\u3092\u8AAD\u3081\u307E\u305B\u3093: ${e.message}`);
      }
      if (stops.length > 0)
        fail(
          `\u524D\u306E try(${latest.statePath})\u306B\u306F\u3001\u8AA4\u691C\u77E5\u306E\u88C1\u5B9A\u306E\u7121\u3044 Raguel \u306E STOP \u304C\u3042\u308A\u307E\u3059(evaluationId: ${stops.join(", ")})\u3002\u65B0\u3057\u3044 try \u3092\u4F5C\u3063\u3066\u3088\u3044\u304B\u4EBA\u306B\u78BA\u304B\u3081\u3001\u627F\u8A8D\u3055\u308C\u305F\u3089 --human-approved \u3092\u4ED8\u3051\u3066 init \u3057\u76F4\u3057\u3066\u304F\u3060\u3055\u3044`
        );
    }
    const prevBase = latest?.state.baseBranch;
    const baseBranch = flags["base-branch"] || prevBase;
    if (prevBase && baseBranch !== prevBase)
      fail(
        `--base-branch(${baseBranch})\u304C\u524D\u306E try \u306E\u30D9\u30FC\u30B9\u30D6\u30E9\u30F3\u30C1(${prevBase})\u3068\u9055\u3044\u307E\u3059\u3002\u540C\u3058 run \u30D6\u30E9\u30F3\u30C1\u306E try \u306F\u30D9\u30FC\u30B9\u30D6\u30E9\u30F3\u30C1\u3092\u5909\u3048\u3089\u308C\u307E\u305B\u3093`
      );
    const tryN = latest ? latest.tryN + 1 : 1;
    const dir = path3.join(runDir(root, slug), `try-${tryN}`);
    fs3.mkdirSync(path3.join(dir, "reports"), { recursive: true });
    const state = newState(slug, tryN, {
      issue: "issue" in flags ? Number(flags.issue) : null,
      intent,
      branch: bools.has("intent-only") ? null : `codiel/${slug}`,
      integration,
      scale,
      imageUpload: upload,
      knowledgeTarget
    });
    if (baseBranch) state.baseBranch = baseBranch;
    if (tryN === 1)
      Object.assign(state.phases["carry-over"], {
        status: "passed",
        verdict: "SKIPPED",
        note: "try-1"
      });
    if (domainMode) state.domainMode = domainMode;
    const p = path3.join(dir, "state.json");
    writeState(p, state);
    return ok({ statePath: p, state });
  }
  if (cmd === "get") {
    if (bools.has("active")) {
      const runs = [];
      for (const { statePath, state } of latestTries(root)) {
        if (["completed", "rejected", "stopped"].includes(state.status))
          continue;
        if (!isLegacy(state) || state.status === "awaiting_outcome")
          runs.push({ statePath, state });
        else process.stderr.write(`${legacyMessage(state)}
`);
      }
      return ok({ runs });
    }
    const latest = loadRun(root, flags, true);
    return ok({ statePath: latest.statePath, state: latest.state });
  }
  if (cmd === "stop") {
    const latest = loadRun(root, flags, true);
    if (TERMINAL.has(latest.state.status))
      fail(`\u3059\u3067\u306B\u7D42\u7AEF\u72B6\u614B\u3067\u3059: ${latest.state.status}`);
    const waits = latest.state.waits ?? [];
    if (waits.length > 0 && !bools.has("abandon-waits"))
      fail(
        `\u5F85\u3061\u304C\u6B8B\u3063\u3066\u3044\u307E\u3059: ${waits.map((w) => w.id).join(", ")}\u3002\u59D4\u8B72\u3092\u6B62\u3081\u308B\u304B\u5B8C\u4E86\u3092\u5F85\u3063\u3066\u7247\u4ED8\u3051\u3066\u304F\u3060\u3055\u3044\u3002\u6B62\u3081\u3089\u308C\u305A\u5F85\u3066\u306A\u3044\u3068\u304D\u3060\u3051\u3001\u4EBA\u306B\u78BA\u304B\u3081\u3066\u304B\u3089 --abandon-waits \u3092\u4ED8\u3051\u307E\u3059`
      );
    if (bools.has("abandon-waits")) delete latest.state.waits;
    latest.state.status = "stopped";
    latest.state.stopReason = flags.reason ?? null;
    writeState(latest.statePath, latest.state);
    return ok({ statePath: latest.statePath, state: latest.state });
  }
  if (cmd === "start-phase") {
    const phase = pos[1];
    if (!PHASES.includes(phase)) fail(`\u4E0D\u6B63\u306A\u30D5\u30A7\u30FC\u30BA: ${phase}`);
    const latest = loadRun(root, flags);
    const st = latest.state;
    if (st.status !== "active")
      fail(`run \u304C active \u3067\u306F\u3042\u308A\u307E\u305B\u3093(${st.status})\u3002resume \u3057\u3066\u304F\u3060\u3055\u3044`);
    if (st.branch === null && phase !== "intent")
      fail(
        `branch \u304C null \u306E run(init --intent-only)\u3067\u306F intent \u4EE5\u5916\u306E\u30D5\u30A7\u30FC\u30BA\u3092\u958B\u59CB\u3067\u304D\u307E\u305B\u3093: ${phase}`
      );
    const stageIdx = STAGES.findIndex((s) => s.includes(phase));
    for (let i = 0; i < stageIdx; i++)
      for (const prev of STAGES[i])
        if (st.phases[prev].status !== "passed")
          fail(`\u524D\u30D5\u30A7\u30FC\u30BA\u304C\u672A\u5B8C\u4E86\u3067\u3059: ${prev}(${st.phases[prev].status})`);
    if (!["pending", "in_progress"].includes(st.phases[phase].status))
      fail(
        `\u30D5\u30A7\u30FC\u30BA ${phase} \u306F ${st.phases[phase].status} \u306E\u305F\u3081\u958B\u59CB\u3067\u304D\u307E\u305B\u3093`
      );
    if (phase === "carry-over" && !st.phases[phase].startHead) {
      if (!st.baseBranch)
        fail(
          "carry-over \u3092\u958B\u59CB\u3067\u304D\u307E\u305B\u3093\u3002state \u306B baseBranch \u304C\u3042\u308A\u307E\u305B\u3093(init \u3067 --base-branch \u3092\u6E21\u3057\u3066\u304F\u3060\u3055\u3044)"
        );
      const base = gitMergeBase(root, st.baseBranch, "HEAD");
      if (!base)
        fail(
          `carry-over \u306E\u8D77\u70B9\u3092\u8AAD\u3081\u307E\u305B\u3093(git merge-base ${st.baseBranch} HEAD \u304C\u5931\u6557\u3057\u305F): ${root}`
        );
      st.phases[phase].startHead = base;
    } else if (CODE_PHASES.has(phase) && !st.phases[phase].startHead) {
      const head = gitHead(root);
      if (!head)
        fail(
          `\u30D5\u30A7\u30FC\u30BA ${phase} \u306E\u958B\u59CB\u306E HEAD \u3092\u8AAD\u3081\u307E\u305B\u3093(git rev-parse HEAD \u304C\u5931\u6557\u3057\u305F): ${root}`
        );
      const problem = continuityProblem(root, st, phase, head);
      if (problem) fail(problem);
      st.phases[phase].startHead = head;
    }
    st.phases[phase].status = "in_progress";
    st.phase = phase;
    writeState(latest.statePath, st);
    return ok({ statePath: latest.statePath, state: st });
  }
  if (cmd === "skip-phase") {
    const phase = pos[1];
    if (!PHASES.includes(phase)) fail(`\u4E0D\u6B63\u306A\u30D5\u30A7\u30FC\u30BA: ${phase}`);
    if (!SKIPPABLE.has(phase))
      fail(
        `${phase} \u306F\u30B9\u30AD\u30C3\u30D7\u3067\u304D\u307E\u305B\u3093(skip-phase \u306F discuss\u30FBdesign\u30FBfix-loop \u306E\u307F\u5BFE\u5FDC)`
      );
    if (!flags.reason) fail("--reason \u304C\u5FC5\u8981\u3067\u3059");
    const latest = loadRun(root, flags);
    const st = latest.state;
    if (st.status !== "active")
      fail(`run \u304C active \u3067\u306F\u3042\u308A\u307E\u305B\u3093(${st.status})\u3002resume \u3057\u3066\u304F\u3060\u3055\u3044`);
    if (st.branch === null)
      fail(
        `branch \u304C null \u306E run(init --intent-only)\u3067\u306F ${phase} \u3092\u30B9\u30AD\u30C3\u30D7\u3067\u304D\u307E\u305B\u3093`
      );
    if (LIGHT_ONLY_SKIPPABLE.has(phase) && st.scale !== "light")
      fail(
        `${phase} \u3092\u30B9\u30AD\u30C3\u30D7\u3067\u304D\u308B\u306E\u306F scale \u304C light \u306E run \u3060\u3051\u3067\u3059(scale: ${st.scale})`
      );
    const ph = st.phases[phase];
    if (ph.status !== "pending")
      fail(
        `\u30D5\u30A7\u30FC\u30BA ${phase} \u306F ${ph.status} \u306E\u305F\u3081\u30B9\u30AD\u30C3\u30D7\u3067\u304D\u307E\u305B\u3093(\u958B\u59CB\u6E08\u307F\u306E\u30EB\u30FC\u30D7\u306F pass-gate \u3067\u901A\u904E\u3059\u308B)`
      );
    const stageIdx = STAGES.findIndex((s) => s.includes(phase));
    for (let i = 0; i < stageIdx; i++)
      for (const prev of STAGES[i])
        if (st.phases[prev].status !== "passed")
          fail(`\u524D\u30D5\u30A7\u30FC\u30BA\u304C\u672A\u5B8C\u4E86\u3067\u3059: ${prev}(${st.phases[prev].status})`);
    ph.status = "passed";
    ph.verdict = "SKIPPED";
    ph.note = flags.reason;
    st.phase = phase;
    writeState(latest.statePath, st);
    return ok({ statePath: latest.statePath, state: st });
  }
  if (cmd === "pass-gate") {
    const phase = pos[1];
    if (!GATED.has(phase))
      fail(`${phase} \u306F\u30B2\u30FC\u30C8\u5BFE\u8C61\u30D5\u30A7\u30FC\u30BA\u3067\u306F\u3042\u308A\u307E\u305B\u3093(complete-phase \u3092\u4F7F\u7528)`);
    const latest = loadRun(root, flags);
    if (latest.state.raguelContract !== 2)
      fail(oldContractMessage(latest.state));
    const ph = latest.state.phases[phase];
    if (ph.status !== "in_progress")
      fail(`\u30D5\u30A7\u30FC\u30BA ${phase} \u306F in_progress \u3067\u306F\u3042\u308A\u307E\u305B\u3093(${ph.status})`);
    if (!flags["evaluation-id"]) fail("--evaluation-id \u304C\u5FC5\u8981\u3067\u3059");
    const humanApproved = bools.has("human-approved");
    const resubmitAfterStop = phase === "carry-over" && ph.verdict === "STOP" && !ph.humanApproved && !humanApproved && flags.verdict === "PROCEED" && !!flags["evaluation-id"] && flags["evaluation-id"] !== ph.evaluationId;
    const stopEvaluationId = ph.evaluationId;
    if (ph.verdict === "STOP" && !humanApproved && !resubmitAfterStop)
      fail(
        `\u30D5\u30A7\u30FC\u30BA ${phase} \u306B\u306F Raguel \u306E STOP \u304C\u8A18\u9332\u3055\u308C\u3066\u3044\u307E\u3059\u3002\u4EBA\u304C\u8AA4\u691C\u77E5\u3068\u88C1\u5B9A\u3057\u305F\u3068\u304D\u3060\u3051 --verdict STOP --human-approved \u3067\u901A\u3057\u3066\u304F\u3060\u3055\u3044`
      );
    if (humanApproved) {
      if (!VERDICTS.includes(flags.verdict))
        fail(
          `\u4E0D\u6B63\u306A --verdict: ${flags.verdict}\u3002\u8A31\u3055\u308C\u308B\u5024\u306F ${VERDICTS.join(", ")} \u3067\u3059`
        );
    } else if (flags.verdict !== "PROCEED")
      fail(
        `verdict \u304C PROCEED \u3067\u306F\u3042\u308A\u307E\u305B\u3093: ${flags.verdict}\u3002ASK \u3068 STOP \u306F mark-ask(STOP \u306F --verdict STOP \u3092\u4ED8\u3051\u308B)\u3067\u4EBA\u306E\u88C1\u5B9A\u306B\u304B\u3051\u3066\u304F\u3060\u3055\u3044`
      );
    let dirs = { testsDir: "", runsDir: "" };
    try {
      dirs = readCodielConfig(root);
    } catch (e) {
      fail(e.message);
    }
    let problem = null;
    try {
      problem = checkGate({
        store: raguelStore(root),
        root,
        runId: latest.state.raguelRunId,
        phase,
        evaluationId: flags["evaluation-id"],
        verdict: flags.verdict,
        humanApproved,
        startHead: ph.startHead,
        runDocsDir: path3.posix.join(dirs.runsDir, latest.state.runId),
        testsDir: dirs.testsDir
      });
    } catch (e) {
      problem = `Raguel \u306E\u8A18\u9332\u3092\u8AAD\u3081\u307E\u305B\u3093: ${e.message}`;
    }
    if (!problem && resubmitAfterStop) {
      try {
        const store = raguelStore(root);
        const stopRow = findEvaluation(
          readEvaluationIndex(store),
          stopEvaluationId ?? ""
        );
        const stopHead = stopRow ? readVerdictRecord(stopRow.casePath)?.subject?.head : void 0;
        if (!stopHead || stopHead === gitHead(root))
          problem = `STOP \u306E\u8A55\u4FA1(${stopEvaluationId})\u306E\u5F8C\u306B HEAD \u304C\u9032\u3093\u3067\u3044\u307E\u305B\u3093(\u8A55\u4FA1\u3057\u305F HEAD: ${stopHead ?? "\u8A18\u9332\u306A\u3057"})\u3002\u6240\u898B\u3092\u76F4\u3057\u3066\u30B3\u30DF\u30C3\u30C8\u3057\u3066\u304B\u3089\u8A55\u4FA1\u3057\u76F4\u3057\u3066\u304F\u3060\u3055\u3044`;
      } catch (e) {
        problem = `Raguel \u306E\u8A18\u9332\u3092\u8AAD\u3081\u307E\u305B\u3093: ${e.message}`;
      }
    }
    if (problem) fail(problem);
    ph.status = "passed";
    ph.evaluationId = flags["evaluation-id"];
    ph.verdict = flags.verdict;
    if (humanApproved) ph.humanApproved = true;
    if (resubmitAfterStop && stopEvaluationId)
      ph.note = resubmitNote(stopEvaluationId);
    const passedHead = gitHead(root);
    if (passedHead) ph.passedHead = passedHead;
    writeState(latest.statePath, latest.state);
    return ok({ statePath: latest.statePath, state: latest.state });
  }
  if (cmd === "complete-phase") {
    const phase = pos[1];
    if (!PHASES.includes(phase)) fail(`\u4E0D\u6B63\u306A\u30D5\u30A7\u30FC\u30BA: ${phase}`);
    if (GATED.has(phase))
      fail(`${phase} \u306F\u30B2\u30FC\u30C8\u5BFE\u8C61\u30D5\u30A7\u30FC\u30BA\u3067\u3059(pass-gate \u3092\u4F7F\u7528)`);
    const latest = loadRun(root, flags);
    const ph = latest.state.phases[phase];
    if (ph.status !== "in_progress")
      fail(`\u30D5\u30A7\u30FC\u30BA ${phase} \u306F in_progress \u3067\u306F\u3042\u308A\u307E\u305B\u3093(${ph.status})`);
    if (phase === "pr" && latest.state.integration === "github") {
      if (!flags["pr-url"])
        fail(
          "integration \u304C github \u306E run \u306E pr \u30D5\u30A7\u30FC\u30BA\u306B\u306F --pr-url \u304C\u5FC5\u8981\u3067\u3059"
        );
      latest.state.pr.url = flags["pr-url"];
    }
    ph.status = "passed";
    ph.note = flags.note ?? null;
    writeState(latest.statePath, latest.state);
    return ok({ statePath: latest.statePath, state: latest.state });
  }
  if (cmd === "mark-ask") {
    const phase = pos[1];
    if (!PHASES.includes(phase)) fail(`\u4E0D\u6B63\u306A\u30D5\u30A7\u30FC\u30BA: ${phase}`);
    const askKind = "kind" in flags ? oneOf(flags, "kind", ["raguel", "confirm"]) : "raguel";
    const verdict = "verdict" in flags ? oneOf(flags, "verdict", VERDICTS) : "ASK";
    const latest = loadRun(root, flags);
    if (TERMINAL.has(latest.state.status))
      fail(`\u3059\u3067\u306B\u7D42\u7AEF\u72B6\u614B\u3067\u3059: ${latest.state.status}`);
    const ph = latest.state.phases[phase];
    if (ph.status === "passed")
      fail(`\u30D5\u30A7\u30FC\u30BA ${phase} \u306F passed \u306E\u305F\u3081 mark-ask \u3067\u304D\u307E\u305B\u3093`);
    if (ph.status === "pending" && phase !== "finalize")
      fail(
        `\u30D5\u30A7\u30FC\u30BA ${phase} \u306F pending \u306E\u305F\u3081 mark-ask \u3067\u304D\u307E\u305B\u3093\u3002start-phase \u3057\u3066\u304B\u3089\u78BA\u8A8D\u3057\u3066\u304F\u3060\u3055\u3044`
      );
    if (askKind === "raguel") {
      const evaluationId = flags["evaluation-id"];
      if (!evaluationId) fail("--kind raguel \u306B\u306F --evaluation-id \u304C\u5FC5\u8981\u3067\u3059");
      let problem = null;
      try {
        problem = checkEvaluationRow(
          findEvaluation(readEvaluationIndex(raguelStore(root)), evaluationId),
          {
            evaluationId,
            runId: latest.state.raguelRunId,
            phase,
            verdict
          }
        );
      } catch (e) {
        problem = `Raguel \u306E\u8A18\u9332\u3092\u8AAD\u3081\u307E\u305B\u3093: ${e.message}`;
      }
      if (problem) fail(problem);
    }
    ph.status = "awaiting_human";
    if (ph.verdict !== "STOP") {
      ph.evaluationId = flags["evaluation-id"] ?? null;
      ph.verdict = verdict;
    }
    ph.askKind = askKind;
    latest.state.status = "awaiting_human";
    writeState(latest.statePath, latest.state);
    return ok({ statePath: latest.statePath, state: latest.state });
  }
  if (cmd === "resume") {
    const latest = loadRun(root, flags);
    if (latest.state.status !== "awaiting_human")
      fail(`awaiting_human \u3067\u306F\u3042\u308A\u307E\u305B\u3093(${latest.state.status})`);
    latest.state.status = "active";
    for (const ph of Object.values(latest.state.phases))
      if (ph.status === "awaiting_human") ph.status = "in_progress";
    writeState(latest.statePath, latest.state);
    return ok({ statePath: latest.statePath, state: latest.state });
  }
  if (cmd === "set-domain") {
    const raw = flags.domain;
    if (raw === void 0) fail("--domain \u304C\u5FC5\u8981\u3067\u3059");
    const domain = (raw ?? "").trim();
    if (domain === "")
      fail("--domain \u306B\u7A7A\u6587\u5B57\u5217\u306F\u6307\u5B9A\u3067\u304D\u307E\u305B\u3093(\u89E3\u9664\u306F clear-domain \u3092\u4F7F\u7528)");
    const latest = loadRun(root, flags);
    if (TERMINAL.has(latest.state.status))
      fail(`\u3059\u3067\u306B\u7D42\u7AEF\u72B6\u614B\u3067\u3059: ${latest.state.status}`);
    latest.state.domain = domain;
    writeState(latest.statePath, latest.state);
    return ok({ statePath: latest.statePath, state: latest.state });
  }
  if (cmd === "clear-domain") {
    const latest = loadRun(root, flags);
    latest.state.domain = null;
    writeState(latest.statePath, latest.state);
    return ok({ statePath: latest.statePath, state: latest.state });
  }
  if (cmd === "wait-add") {
    const id = flags.id;
    if (!id) fail("--id \u304C\u5FC5\u8981\u3067\u3059");
    if (!SLUG_RE.test(id) || id.length > 100)
      fail(
        `\u4E0D\u6B63\u306A --id: ${id}\u3002\u82F1\u5C0F\u6587\u5B57\u3068\u6570\u5B57\u3092\u30CF\u30A4\u30D5\u30F3\u3067\u3064\u306A\u304E\u3001100 \u6587\u5B57\u4EE5\u5185\u306B\u3057\u3066\u304F\u3060\u3055\u3044`
      );
    const purpose = (flags.purpose ?? "").trim();
    if (purpose === "") fail("--purpose \u304C\u5FC5\u8981\u3067\u3059");
    const latest = loadRun(root, flags);
    const st = latest.state;
    if (TERMINAL.has(st.status)) fail(`\u3059\u3067\u306B\u7D42\u7AEF\u72B6\u614B\u3067\u3059: ${st.status}`);
    if ((st.waits ?? []).some((w) => w.id === id))
      fail(`\u5F85\u3061 ${id} \u306F\u3059\u3067\u306B\u6B8B\u3063\u3066\u3044\u307E\u3059`);
    if (fs3.existsSync(waitReport(latest, id)))
      fail(
        `${waitReport(latest, id)} \u304C\u3059\u3067\u306B\u3042\u308A\u307E\u3059(id \u306F try \u306E\u4E2D\u3067\u4F7F\u3044\u56DE\u3055\u306A\u3044)`
      );
    const wait = {
      id,
      purpose,
      phase: st.phase ?? "",
      startedAt: (/* @__PURE__ */ new Date()).toISOString()
    };
    if (flags["task-id"]) wait.taskId = flags["task-id"];
    st.waits = [...st.waits ?? [], wait];
    writeState(latest.statePath, st);
    return ok({ statePath: latest.statePath, state: st });
  }
  if (cmd === "wait-done") {
    const id = flags.id;
    if (!id) fail("--id \u304C\u5FC5\u8981\u3067\u3059");
    if (!SLUG_RE.test(id)) fail(`\u4E0D\u6B63\u306A --id: ${id}`);
    const latest = loadRun(root, flags);
    const st = latest.state;
    const waits = st.waits ?? [];
    if (!waits.some((w) => w.id === id)) fail(`\u5F85\u3061 ${id} \u306F\u3042\u308A\u307E\u305B\u3093`);
    if (!fs3.existsSync(waitReport(latest, id)))
      fail(
        `${waitReport(latest, id)} \u304C\u3042\u308A\u307E\u305B\u3093\u3002\u8FD4\u7B54\u306E\u672C\u6587\u3092\u66F8\u3044\u3066\u304B\u3089 wait-done \u3057\u3066\u304F\u3060\u3055\u3044`
      );
    st.waits = waits.filter((w) => w.id !== id);
    writeState(latest.statePath, st);
    return ok({ statePath: latest.statePath, state: st });
  }
  if (cmd === "wait-clear") {
    const latest = loadRun(root, flags);
    const cleared = latest.state.waits ?? [];
    latest.state.waits = [];
    writeState(latest.statePath, latest.state);
    return ok({ statePath: latest.statePath, state: latest.state, cleared });
  }
  if (cmd === "set-integration") {
    const integration = oneOf(flags, "integration", INTEGRATIONS);
    const upload = imageUpload(flags, integration);
    const latest = loadRun(root, flags);
    if (TERMINAL.has(latest.state.status))
      fail(`\u3059\u3067\u306B\u7D42\u7AEF\u72B6\u614B\u3067\u3059: ${latest.state.status}`);
    latest.state.integration = integration;
    latest.state.imageUpload = upload;
    writeState(latest.statePath, latest.state);
    return ok({ statePath: latest.statePath, state: latest.state });
  }
  if (cmd === "record-attempt") {
    const phase = pos[1];
    if (!PHASES.includes(phase)) fail(`\u4E0D\u6B63\u306A\u30D5\u30A7\u30FC\u30BA: ${phase}`);
    const latest = loadRun(root, flags);
    const ph = latest.state.phases[phase];
    ph.attempts = (ph.attempts ?? 0) + 1;
    if (ph.attempts > latest.state.limits.maxFixAttempts) {
      latest.state.status = "awaiting_human";
      writeState(latest.statePath, latest.state);
      ok({
        statePath: latest.statePath,
        state: latest.state,
        capExceeded: true
      });
      process.exit(3);
    }
    writeState(latest.statePath, latest.state);
    return ok({
      statePath: latest.statePath,
      state: latest.state,
      capExceeded: false
    });
  }
  if (cmd === "close") {
    const latest = loadRun(root, flags);
    const st = latest.state;
    if (TERMINAL.has(st.status)) fail(`\u3059\u3067\u306B\u7D42\u7AEF\u72B6\u614B\u3067\u3059: ${st.status}`);
    if (st.branch !== null)
      fail(
        `close \u306F branch \u304C null \u306E run(init --intent-only)\u3067\u3060\u3051\u4F7F\u3048\u307E\u3059(branch: ${st.branch})`
      );
    if (st.phases.intent.status !== "passed")
      fail(`intent \u304C passed \u3067\u306F\u3042\u308A\u307E\u305B\u3093(${st.phases.intent.status})`);
    for (const [name, ph] of Object.entries(st.phases))
      if (name !== "intent" && ph.status !== "pending" && !(name === "carry-over" && ph.verdict === "SKIPPED"))
        fail(`\u30D5\u30A7\u30FC\u30BA ${name} \u304C pending \u3067\u306F\u3042\u308A\u307E\u305B\u3093(${ph.status})`);
    st.status = "completed";
    st.stopReason = flags.reason ?? null;
    writeState(latest.statePath, st);
    return ok({ statePath: latest.statePath, state: st });
  }
  if (cmd === "finalize") {
    const latest = loadRun(root, flags);
    for (const [name, ph] of Object.entries(latest.state.phases)) {
      if (name === "finalize") continue;
      if (ph.status !== "passed")
        fail(`\u30D5\u30A7\u30FC\u30BA ${name} \u304C\u672A\u5B8C\u4E86\u3067\u3059(${ph.status})`);
    }
    latest.state.phases.finalize.status = "passed";
    latest.state.status = "awaiting_outcome";
    writeState(latest.statePath, latest.state);
    return ok({ statePath: latest.statePath, state: latest.state });
  }
  if (cmd === "record-outcome") {
    const latest = loadRun(root, flags, true);
    const outcome = flags.outcome;
    if (!["approved", "rejected", "incident"].includes(outcome))
      fail(`\u4E0D\u6B63\u306A outcome: ${outcome}`);
    if (isLegacy(latest.state)) {
      const st = latest.state.status;
      const terminalIncident = outcome === "incident" && (st === "completed" || st === "rejected");
      if (st !== "awaiting_outcome" && !terminalIncident)
        fail(legacyMessage(latest.state));
    }
    if (!["awaiting_outcome", "completed", "rejected"].includes(
      latest.state.status
    ))
      fail(`outcome \u3092\u8A18\u9332\u3067\u304D\u308B\u72B6\u614B\u3067\u306F\u3042\u308A\u307E\u305B\u3093(${latest.state.status})`);
    if (outcome === "approved") latest.state.status = "completed";
    if (outcome === "rejected") latest.state.status = "rejected";
    if (outcome === "incident")
      latest.state.incidents.push({
        at: (/* @__PURE__ */ new Date()).toISOString(),
        note: flags.note ?? null
      });
    writeState(latest.statePath, latest.state);
    return ok({ statePath: latest.statePath, state: latest.state });
  }
  if (cmd === "next-adr-candidate-id") {
    const file = flags.file;
    if (!file) fail("--file \u304C\u5FC5\u8981\u3067\u3059");
    const domain = flags.domain;
    if (!domain) fail("--domain \u304C\u5FC5\u8981\u3067\u3059");
    const filePath = path3.isAbsolute(file) ? file : path3.join(root, file);
    let max = 0;
    if (fs3.existsSync(filePath)) {
      const content = fs3.readFileSync(filePath, "utf8");
      const domainRe = new RegExp(`^${escapeRegExp(domain)}-([0-9]+)$`);
      const idRe = /\[ADR 候補: ([^\]]+)\]|\(候補 ID: ([^)]+)\)/g;
      for (const m of content.matchAll(idRe)) {
        const id = m[1] ?? m[2];
        const digits = id.match(domainRe)?.[1];
        if (digits) max = Math.max(max, Number(digits));
      }
    }
    return ok({ candidateId: `${domain}-${max + 1}` });
  }
  if (cmd === "step-add") {
    const kind = stepKind(flags);
    const isStep = kind === "step";
    const id = flags.id;
    if (!id) fail("--id \u304C\u5FC5\u8981\u3067\u3059");
    if (isStep && !SLUG_RE.test(id)) fail(`\u4E0D\u6B63\u306A --id: ${id}`);
    if (!isStep && !isSpecDirId(id))
      fail(
        `\u4E0D\u6B63\u306A --id: ${id}\u3002${kind} \u306B\u306F units/\u30FBe2e/frontend/\u30FBe2e/backend/\u30FBe2e/cli/ \u3067\u59CB\u307E\u308B\u4ED5\u69D8\u306E\u30C7\u30A3\u30EC\u30AF\u30C8\u30EA\u306E ID \u3092\u6E21\u3057\u3066\u304F\u3060\u3055\u3044`
      );
    if (!isStep && ("deps" in flags || bools.has("final")))
      fail(`${kind} \u306B\u306F --deps \u3068 --final \u3092\u6307\u5B9A\u3067\u304D\u307E\u305B\u3093`);
    const files = jsonList(flags, "files", isStep);
    if (isStep && files.length === 0)
      fail("--files \u306B\u306F\u89E6\u308B\u30D5\u30A1\u30A4\u30EB\u3092 1 \u3064\u4EE5\u4E0A\u6E21\u3057\u3066\u304F\u3060\u3055\u3044");
    for (const f of files)
      if (f.startsWith("/") || f.split("/").includes(".."))
        fail(`--files \u306B\u306F repoRoot \u76F8\u5BFE\u306E glob \u3092\u6E21\u3057\u3066\u304F\u3060\u3055\u3044: ${f}`);
    const deps = jsonList(flags, "deps", isStep);
    const final = bools.has("final");
    let domain = null;
    if ("domain" in flags) {
      domain = (flags.domain ?? "").trim();
      if (domain === "") fail("--domain \u306B\u7A7A\u6587\u5B57\u5217\u306F\u6307\u5B9A\u3067\u304D\u307E\u305B\u3093");
    }
    const latest = loadRun(root, flags);
    if (TERMINAL.has(latest.state.status))
      fail(`\u3059\u3067\u306B\u7D42\u7AEF\u72B6\u614B\u3067\u3059: ${latest.state.status}`);
    const table = stepTable(latest.state, kind);
    const prev = table[id];
    const reAddable = prev?.status === "pending" || kind === "test-loop" && prev?.status === "merged";
    if (prev && !reAddable)
      fail(`${kind} ${id} \u306F ${prev.status} \u306E\u305F\u3081\u767B\u9332\u3057\u76F4\u305B\u307E\u305B\u3093`);
    table[id] = {
      status: "pending",
      files,
      deps,
      final,
      group: null,
      worktree: null,
      branch: null,
      commits: { base: null, head: null },
      attempts: 0,
      domain
    };
    writeState(latest.statePath, latest.state);
    return ok({ statePath: latest.statePath, state: latest.state });
  }
  if (cmd === "step-update") {
    const kind = stepKind(flags);
    const id = flags.id;
    if (!id) fail("--id \u304C\u5FC5\u8981\u3067\u3059");
    const to = oneOf(flags, "status", STEP_STATUSES);
    const latest = loadRun(root, flags);
    const st = latest.state;
    if (TERMINAL.has(st.status)) fail(`\u3059\u3067\u306B\u7D42\u7AEF\u72B6\u614B\u3067\u3059: ${st.status}`);
    const step = stepTable(st, kind)[id];
    if (!step) fail(`${kind} ${id} \u306F\u767B\u9332\u3055\u308C\u3066\u3044\u307E\u305B\u3093`);
    const accepts = STEP_TRANSITIONS[`${step.status}>${to}`];
    if (!accepts)
      fail(`${kind} ${id} \u306F ${step.status} \u304B\u3089 ${to} \u3078\u9077\u79FB\u3067\u304D\u307E\u305B\u3093`);
    const record = {};
    for (const name of STEP_RECORD_FLAGS) {
      if (!(name in flags)) continue;
      if (!accepts.includes(name))
        fail(
          `--${name} \u306F ${step.status} \u304B\u3089 ${to} \u3078\u306E\u9077\u79FB\u3067\u306F\u6307\u5B9A\u3067\u304D\u307E\u305B\u3093`
        );
      if (!flags[name]) fail(`--${name} \u306B\u5024\u304C\u5FC5\u8981\u3067\u3059`);
      record[name] = flags[name];
    }
    if (record.worktree && path3.isAbsolute(record.worktree))
      fail(
        `--worktree \u306B\u306F repoRoot \u76F8\u5BFE\u306E\u30D1\u30B9\u3092\u6E21\u3057\u3066\u304F\u3060\u3055\u3044: ${record.worktree}`
      );
    if (record.worktree) {
      const wt = normalizeRel(record.worktree);
      const tables = {
        step: st.implement?.steps,
        "test-code": st.testCode?.units,
        "test-loop": st.testLoop?.units
      };
      for (const [k, table] of Object.entries(tables))
        for (const [otherId, other] of Object.entries(table ?? {}))
          if (other !== step && other.worktree !== null && normalizeRel(other.worktree) === wt)
            fail(
              `--worktree ${record.worktree} \u306F ${k} ${otherId} \u304C\u3059\u3067\u306B\u8A18\u9332\u3057\u3066\u3044\u307E\u3059`
            );
    }
    if (step.status === "reviewing" && to === "running") step.attempts++;
    if (step.status === "failed" && to === "pending") {
      step.worktree = null;
      step.branch = null;
      step.commits = { base: null, head: null };
    }
    if (record.worktree) step.worktree = record.worktree;
    if (record.branch) step.branch = record.branch;
    if (record.base) step.commits.base = record.base;
    if (record.head) step.commits.head = record.head;
    step.status = to;
    writeState(latest.statePath, st);
    return ok({ statePath: latest.statePath, state: st });
  }
  if (cmd === "waves") {
    const latest = loadRun(root, flags);
    if (TERMINAL.has(latest.state.status))
      fail(`\u3059\u3067\u306B\u7D42\u7AEF\u72B6\u614B\u3067\u3059: ${latest.state.status}`);
    const steps = latest.state.implement?.steps ?? {};
    let plan = { groups: [], final: [] };
    try {
      plan = planWaves(steps);
    } catch (e) {
      fail(e.message);
    }
    plan.groups.forEach((g, index) => {
      for (const id of g.steps) steps[id].group = { index, mode: g.mode };
    });
    plan.final.forEach((id, index) => {
      steps[id].group = { index, mode: "final" };
    });
    if (latest.state.implement) writeState(latest.statePath, latest.state);
    return ok(plan);
  }
  if (cmd === "config") {
    try {
      return ok(readCodielConfig(root));
    } catch (e) {
      fail(e.message);
    }
  }
  if (cmd === "gitignore") {
    let testsDir = "";
    try {
      testsDir = readCodielConfig(root).testsDir;
    } catch (e) {
      fail(e.message);
    }
    const required = gitignoreLines(testsDir);
    return ok({
      path: ".gitignore",
      required,
      missing: missingGitignoreLines(root, required)
    });
  }
  if (cmd === "set-test-edit") {
    const latest = loadRun(root, flags);
    const st = latest.state;
    if (TERMINAL.has(st.status)) fail(`\u3059\u3067\u306B\u7D42\u7AEF\u72B6\u614B\u3067\u3059: ${st.status}`);
    const fixLoop = st.phases["fix-loop"].status;
    if (st.phase !== "fix-loop" || fixLoop !== "in_progress")
      fail(
        `set-test-edit \u306F fix-loop \u304C in_progress \u306E\u3068\u304D\u3060\u3051\u4F7F\u3048\u307E\u3059(phase: ${st.phase}\u3001fix-loop: ${fixLoop})`
      );
    st.testEdit = true;
    writeState(latest.statePath, st);
    return ok({ statePath: latest.statePath, state: st });
  }
  if (cmd === "clear-test-edit") {
    const latest = loadRun(root, flags);
    delete latest.state.testEdit;
    writeState(latest.statePath, latest.state);
    return ok({ statePath: latest.statePath, state: latest.state });
  }
  fail(`\u4E0D\u660E\u306A\u30B3\u30DE\u30F3\u30C9: ${cmd}`);
}

// src/codiel-state-cli.ts
main(process.argv.slice(2));
