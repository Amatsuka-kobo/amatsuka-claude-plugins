#!/usr/bin/env node

// src/codiel-state.ts
import fs from "node:fs";
import path from "node:path";
var STAGES = [
  ["intent"],
  ["discuss"],
  ["design"],
  ["test-spec", "dev-plan"],
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
  "design",
  "test-spec",
  "dev-plan",
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
var BOOL_FLAGS = ["active", "human-approved", "intent-only"];
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
  return JSON.parse(fs.readFileSync(p, "utf8"));
}
function writeState(p, state) {
  state.updatedAt = (/* @__PURE__ */ new Date()).toISOString();
  const tmp = `${p}.tmp`;
  fs.writeFileSync(tmp, `${JSON.stringify(state, null, 2)}
`);
  fs.renameSync(tmp, p);
}
function runDir(root, slug) {
  return path.join(root, ".codiel", "runs", slug);
}
function tries(dir) {
  if (!fs.existsSync(dir)) return [];
  return fs.readdirSync(dir).filter((d) => /^try-\d+$/.test(d)).map((d) => Number(d.slice(4))).sort((a, b) => a - b);
}
function latestTry(root, slug) {
  const dir = runDir(root, slug);
  for (const n of tries(dir).reverse()) {
    const p = path.join(dir, `try-${n}`, "state.json");
    if (fs.existsSync(p)) return { tryN: n, statePath: p, state: readState(p) };
  }
  return null;
}
function latestTries(root) {
  const runsRoot = path.join(root, ".codiel", "runs");
  if (!fs.existsSync(runsRoot)) return [];
  return fs.readdirSync(runsRoot, { withFileTypes: true }).filter((d) => d.isDirectory()).map((d) => latestTry(root, d.name)).filter((t) => t !== null);
}
function v1Message(st) {
  const n = st.issue;
  return `codiel: .codiel/runs/issue-${n} \u306F codiel 0.x \u306E run(state version 1\u3001status: ${st.status})\u3067\u3042\u308A\u3001\u3053\u306E\u7248\u3067\u306F\u518D\u958B\u3067\u304D\u306A\u3044\u3002codiel 0.x \u3067\u5B8C\u4E86\u3055\u305B\u308B\u304B\u3001\`codiel-state stop --slug issue-${n} --reason migrate\` \u3067\u6B62\u3081\u3066\u304B\u3089\u3001\`/codiel:run ${n}\` \u3067\u65B0\u3057\u3044 run \u3092\u59CB\u3081\u308B\u3002`;
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
    updatedAt: now
  };
}
function loadRun(root, flags, allowV1 = false) {
  const slug = flags.slug;
  if (!slug) fail("--slug \u304C\u5FC5\u8981\u3067\u3059");
  if (!SLUG_RE.test(slug)) fail(`\u4E0D\u6B63\u306A --slug: ${slug}`);
  const latest = latestTry(root, slug);
  if (!latest) fail(`run \u304C\u5B58\u5728\u3057\u307E\u305B\u3093: ${slug}`);
  if (latest.state.version !== 2 && !allowV1) fail(v1Message(latest.state));
  return latest;
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
    if (path.isAbsolute(rawIntent))
      fail(`--intent \u306B\u306F repoRoot \u76F8\u5BFE\u306E\u30D1\u30B9\u3092\u6E21\u3057\u3066\u304F\u3060\u3055\u3044: ${rawIntent}`);
    const intent = path.posix.normalize(rawIntent.replaceAll("\\", "/"));
    if (!INTENT_PATH_RE.test(intent))
      fail(
        `--intent \u306B\u306F docs/intents/ \u76F4\u4E0B\u306E .md \u3092 repoRoot \u76F8\u5BFE\u3067\u6E21\u3057\u3066\u304F\u3060\u3055\u3044: ${rawIntent}`
      );
    if ("issue" in flags && !/^[1-9]\d*$/.test(flags.issue ?? ""))
      fail(`\u4E0D\u6B63\u306A --issue: ${flags.issue}`);
    const integration = oneOf(flags, "integration", INTEGRATIONS);
    const scale = oneOf(flags, "scale", ["standard", "light"]);
    const adrTarget = oneOf(flags, "adr-target", [
      "metatron",
      "intents"
    ]);
    const upload = imageUpload(flags, integration);
    const domainMode = "domain-mode" in flags ? oneOf(flags, "domain-mode", ["mapped", "unscoped"]) : void 0;
    const latest = latestTry(root, slug);
    if (latest && !TERMINAL.has(latest.state.status))
      fail(
        `\u672A\u5B8C\u4E86\u306E try \u304C\u3042\u308A\u307E\u3059: ${latest.statePath}(status: ${latest.state.status})\u3002resume \u3059\u308B\u304B stop \u3057\u3066\u304F\u3060\u3055\u3044`
      );
    const tryN = latest ? latest.tryN + 1 : 1;
    const dir = path.join(runDir(root, slug), `try-${tryN}`);
    fs.mkdirSync(path.join(dir, "reports"), { recursive: true });
    const state = newState(slug, tryN, {
      issue: "issue" in flags ? Number(flags.issue) : null,
      intent,
      branch: bools.has("intent-only") ? null : `codiel/${slug}-try-${tryN}`,
      integration,
      scale,
      imageUpload: upload,
      adrTarget
    });
    if (flags["base-branch"]) state.baseBranch = flags["base-branch"];
    if (domainMode) state.domainMode = domainMode;
    const p = path.join(dir, "state.json");
    writeState(p, state);
    return ok({ statePath: p, state });
  }
  if (cmd === "get") {
    if (bools.has("active")) {
      const runs = [];
      for (const { statePath, state } of latestTries(root)) {
        if (["completed", "rejected", "stopped"].includes(state.status))
          continue;
        if (state.version !== 2) process.stderr.write(`${v1Message(state)}
`);
        else runs.push({ statePath, state });
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
    const ph = latest.state.phases[phase];
    if (ph.status !== "in_progress")
      fail(`\u30D5\u30A7\u30FC\u30BA ${phase} \u306F in_progress \u3067\u306F\u3042\u308A\u307E\u305B\u3093(${ph.status})`);
    if (!flags["evaluation-id"]) fail("--evaluation-id \u304C\u5FC5\u8981\u3067\u3059");
    const humanApproved = bools.has("human-approved");
    const acceptedVerdicts = humanApproved ? ["PROCEED", "ASK"] : ["PROCEED"];
    if (!acceptedVerdicts.includes(flags.verdict))
      fail(
        `verdict \u304C PROCEED \u3067\u306F\u3042\u308A\u307E\u305B\u3093: ${flags.verdict}\u3002ASK \u306F mark-ask\u3001STOP \u306F stop \u3092\u4F7F\u7528`
      );
    ph.status = "passed";
    ph.evaluationId = flags["evaluation-id"];
    ph.verdict = flags.verdict;
    if (humanApproved) ph.humanApproved = true;
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
    ph.status = "awaiting_human";
    ph.evaluationId = flags["evaluation-id"] ?? null;
    ph.verdict = "ASK";
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
      if (name !== "intent" && ph.status !== "pending")
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
    const latest = loadRun(root, flags);
    const outcome = flags.outcome;
    if (!["approved", "rejected", "incident"].includes(outcome))
      fail(`\u4E0D\u6B63\u306A outcome: ${outcome}`);
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
  fail(`\u4E0D\u660E\u306A\u30B3\u30DE\u30F3\u30C9: ${cmd}`);
}

// src/codiel-state-cli.ts
main(process.argv.slice(2));
