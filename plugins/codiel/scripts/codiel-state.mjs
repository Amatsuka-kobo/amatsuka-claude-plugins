#!/usr/bin/env node

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
var GATED = /* @__PURE__ */ new Set([
  "init",
  "design",
  "test-spec",
  "dev-plan",
  "implement",
  "test-loop",
  "fix-loop"
]);
var SKIPPABLE = /* @__PURE__ */ new Set(["fix-loop"]);
var TERMINAL = /* @__PURE__ */ new Set([
  "stopped",
  "awaiting_outcome",
  "completed",
  "rejected"
]);
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
function parseArgs(argv) {
  const pos = [];
  const flags = {};
  for (let i = 0; i < argv.length; i++) {
    if (argv[i].startsWith("--")) {
      flags[argv[i].slice(2)] = argv[i + 1];
      i++;
    } else pos.push(argv[i]);
  }
  return { pos, flags };
}
function newState(issue, tryN) {
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
    version: 1,
    runId: `issue-${issue}`,
    try: tryN,
    issue: Number(issue),
    branch: `codiel/issue-${issue}-try-${tryN}`,
    raguelRunId: `issue-${issue}-try-${tryN}`,
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
function loadRun(root, flags) {
  if (!flags.issue) fail("--issue \u304C\u5FC5\u8981\u3067\u3059");
  const latest = latestTry(root, flags.issue);
  if (!latest) fail(`run \u304C\u5B58\u5728\u3057\u307E\u305B\u3093: issue-${flags.issue}`);
  return latest;
}
function main(argv, root = process.cwd()) {
  const hasActive = argv.includes("--active");
  if (hasActive) {
    argv = argv.filter((arg) => arg !== "--active");
  }
  const hasHumanApproved = argv.includes("--human-approved");
  if (hasHumanApproved) {
    argv = argv.filter((arg) => arg !== "--human-approved");
  }
  const { pos, flags } = parseArgs(argv);
  const cmd = pos[0];
  if (cmd === "init") {
    if (!flags.issue) fail("--issue \u304C\u5FC5\u8981\u3067\u3059");
    const latest = latestTry(root, flags.issue);
    if (latest && !TERMINAL.has(latest.state.status))
      fail(
        `\u672A\u5B8C\u4E86\u306E try \u304C\u3042\u308A\u307E\u3059: ${latest.statePath}(status: ${latest.state.status})\u3002resume \u3059\u308B\u304B stop \u3057\u3066\u304F\u3060\u3055\u3044`
      );
    const tryN = latest ? latest.tryN + 1 : 1;
    const dir = path.join(runDir(root, flags.issue), `try-${tryN}`);
    fs.mkdirSync(path.join(dir, "reports"), { recursive: true });
    const state = newState(flags.issue, tryN);
    if (flags["base-branch"]) state.baseBranch = flags["base-branch"];
    const p = path.join(dir, "state.json");
    writeState(p, state);
    return ok({ statePath: p, state });
  }
  if (cmd === "get") {
    if (hasActive) {
      const runsRoot = path.join(root, ".codiel", "runs");
      const runs = [];
      if (fs.existsSync(runsRoot)) {
        for (const r of fs.readdirSync(runsRoot).filter((d) => /^issue-\d+$/.test(d))) {
          const latest2 = latestTry(root, Number(r.slice(6)));
          if (latest2 && !["completed", "rejected", "stopped"].includes(latest2.state.status))
            runs.push({ statePath: latest2.statePath, state: latest2.state });
        }
      }
      return ok({ runs });
    }
    const latest = loadRun(root, flags);
    return ok({ statePath: latest.statePath, state: latest.state });
  }
  if (cmd === "stop") {
    const latest = loadRun(root, flags);
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
      fail(`${phase} \u306F\u30B9\u30AD\u30C3\u30D7\u3067\u304D\u307E\u305B\u3093(skip-phase \u306F fix-loop \u306E\u307F\u5BFE\u5FDC)`);
    if (!flags.reason) fail("--reason \u304C\u5FC5\u8981\u3067\u3059");
    const latest = loadRun(root, flags);
    const st = latest.state;
    if (st.status !== "active")
      fail(`run \u304C active \u3067\u306F\u3042\u308A\u307E\u305B\u3093(${st.status})\u3002resume \u3057\u3066\u304F\u3060\u3055\u3044`);
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
    const acceptedVerdicts = hasHumanApproved ? ["PROCEED", "ASK"] : ["PROCEED"];
    if (!acceptedVerdicts.includes(flags.verdict))
      fail(
        `verdict \u304C PROCEED \u3067\u306F\u3042\u308A\u307E\u305B\u3093: ${flags.verdict}\u3002ASK \u306F mark-ask\u3001STOP \u306F stop \u3092\u4F7F\u7528`
      );
    ph.status = "passed";
    ph.evaluationId = flags["evaluation-id"];
    ph.verdict = flags.verdict;
    if (hasHumanApproved) ph.humanApproved = true;
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
    if (phase === "pr") {
      if (!flags["pr-url"]) fail("pr \u30D5\u30A7\u30FC\u30BA\u306B\u306F --pr-url \u304C\u5FC5\u8981\u3067\u3059");
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
    const latest = loadRun(root, flags);
    latest.state.phases[phase].status = "awaiting_human";
    latest.state.phases[phase].evaluationId = flags["evaluation-id"] ?? null;
    latest.state.phases[phase].verdict = "ASK";
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
