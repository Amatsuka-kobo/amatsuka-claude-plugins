#!/usr/bin/env node
import fs from "node:fs";
import path from "node:path";

export const STAGES = [["init"],["design"],["test-spec","dev-plan"],["implement"],
  ["test-loop"],["pr"],["review"],["fix-loop"],["triage"],["finalize"]];
export const PHASES = STAGES.flat();
export const GATED = new Set(["init","design","test-spec","dev-plan","implement","test-loop","fix-loop"]);
const TERMINAL = new Set(["stopped","awaiting_outcome","completed","rejected"]);

const fail = (msg, code = 1) => { process.stderr.write(msg + "\n"); process.exit(code); };
const ok = (obj) => { process.stdout.write(JSON.stringify(obj, null, 2) + "\n"); };

export function readState(p) { return JSON.parse(fs.readFileSync(p, "utf8")); }
export function writeState(p, state) {
  state.updatedAt = new Date().toISOString();
  const tmp = p + ".tmp";
  fs.writeFileSync(tmp, JSON.stringify(state, null, 2) + "\n");
  fs.renameSync(tmp, p);
}

function runDir(root, issue) { return path.join(root, ".codiel", "runs", `issue-${issue}`); }

function tries(dir) {
  if (!fs.existsSync(dir)) return [];
  return fs.readdirSync(dir).filter((d) => /^try-\d+$/.test(d))
    .map((d) => Number(d.slice(4))).sort((a, b) => a - b);
}

export function latestTry(root, issue) {
  const dir = runDir(root, issue);
  const ts = tries(dir);
  if (ts.length === 0) return null;
  const n = ts[ts.length - 1];
  const p = path.join(dir, `try-${n}`, "state.json");
  return { tryN: n, statePath: p, state: readState(p) };
}

// Finds active runs for hooks. Intentionally narrower than `get --active`:
// findActiveRun includes only "active" and "awaiting_human", while `get --active` also includes "awaiting_outcome" for auto-sync of outcomes.
export function findActiveRun(root) {
  const runsRoot = path.join(root, ".codiel", "runs");
  if (!fs.existsSync(runsRoot)) return null;
  let best = null;
  for (const r of fs.readdirSync(runsRoot).filter((d) => /^issue-\d+$/.test(d))) {
    const latest = latestTry(root, Number(r.slice(6)));
    if (!latest) continue;
    if (latest.state.status === "active" || latest.state.status === "awaiting_human") {
      if (!best || latest.state.updatedAt > best.state.updatedAt) {
        best = { dir: path.dirname(latest.statePath), statePath: latest.statePath, state: latest.state };
      }
    }
  }
  return best;
}

function parseArgs(argv) {
  const pos = []; const flags = {};
  for (let i = 0; i < argv.length; i++) {
    if (argv[i].startsWith("--")) { flags[argv[i].slice(2)] = argv[i + 1]; i++; }
    else pos.push(argv[i]);
  }
  return { pos, flags };
}

function newState(issue, tryN) {
  const phases = {};
  for (const ph of PHASES) phases[ph] = { status: "pending", attempts: 0, evaluationId: null, verdict: null, note: null };
  const now = new Date().toISOString();
  return {
    version: 1, runId: `issue-${issue}`, try: tryN, issue: Number(issue),
    branch: `codiel/issue-${issue}-try-${tryN}`, raguelRunId: `issue-${issue}-try-${tryN}`,
    status: "active", phase: null, phases,
    pr: { url: null }, limits: { maxFixAttempts: 5 },
    stopReason: null, incidents: [], createdAt: now, updatedAt: now,
  };
}

function loadRun(root, flags) {
  if (!flags.issue) fail("--issue が必要です");
  const latest = latestTry(root, flags.issue);
  if (!latest) fail(`run が存在しません: issue-${flags.issue}`);
  return latest;
}

export function main(argv, root = process.cwd()) {
  // Handle --active / --human-approved specially: boolean flags with no value,
  // remove them from argv first to avoid parseArgs eating the next arg.
  const hasActive = argv.includes("--active");
  if (hasActive) {
    argv = argv.filter(arg => arg !== "--active");
  }
  const hasHumanApproved = argv.includes("--human-approved");
  if (hasHumanApproved) {
    argv = argv.filter(arg => arg !== "--human-approved");
  }

  const { pos, flags } = parseArgs(argv);
  const cmd = pos[0];

  if (cmd === "init") {
    if (!flags.issue) fail("--issue が必要です");
    const latest = latestTry(root, flags.issue);
    if (latest && !TERMINAL.has(latest.state.status))
      fail(`未完了の try があります: ${latest.statePath}(status: ${latest.state.status})。resume するか stop してください`);
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
          const latest = latestTry(root, Number(r.slice(6)));
          if (latest && !["completed", "rejected", "stopped"].includes(latest.state.status))
            runs.push({ statePath: latest.statePath, state: latest.state });
        }
      }
      return ok({ runs });
    }
    const latest = loadRun(root, flags);
    return ok({ statePath: latest.statePath, state: latest.state });
  }

  if (cmd === "stop") {
    const latest = loadRun(root, flags);
    if (TERMINAL.has(latest.state.status)) fail(`すでに終端状態です: ${latest.state.status}`);
    latest.state.status = "stopped";
    latest.state.stopReason = flags.reason ?? null;
    writeState(latest.statePath, latest.state);
    return ok({ statePath: latest.statePath, state: latest.state });
  }

  if (cmd === "start-phase") {
    const phase = pos[1];
    if (!PHASES.includes(phase)) fail(`不正なフェーズ: ${phase}`);
    const latest = loadRun(root, flags);
    const st = latest.state;
    if (st.status !== "active") fail(`run が active ではありません(${st.status})。resume してください`);
    const stageIdx = STAGES.findIndex((s) => s.includes(phase));
    for (let i = 0; i < stageIdx; i++)
      for (const prev of STAGES[i])
        if (st.phases[prev].status !== "passed")
          fail(`前フェーズが未完了です: ${prev}(${st.phases[prev].status})`);
    if (!["pending", "in_progress"].includes(st.phases[phase].status))
      fail(`フェーズ ${phase} は ${st.phases[phase].status} のため開始できません`);
    st.phases[phase].status = "in_progress";
    st.phase = phase;
    writeState(latest.statePath, st);
    return ok({ statePath: latest.statePath, state: st });
  }

  if (cmd === "pass-gate") {
    const phase = pos[1];
    if (!GATED.has(phase)) fail(`${phase} はゲート対象フェーズではありません(complete-phase を使用)`);
    const latest = loadRun(root, flags);
    const ph = latest.state.phases[phase];
    if (ph.status !== "in_progress") fail(`フェーズ ${phase} は in_progress ではありません(${ph.status})`);
    if (!flags["evaluation-id"]) fail("--evaluation-id が必要です");
    const acceptedVerdicts = hasHumanApproved ? ["PROCEED", "ASK"] : ["PROCEED"];
    if (!acceptedVerdicts.includes(flags.verdict))
      fail(`verdict が PROCEED ではありません: ${flags.verdict}。ASK は mark-ask、STOP は stop を使用`);
    ph.status = "passed"; ph.evaluationId = flags["evaluation-id"]; ph.verdict = flags.verdict;
    if (hasHumanApproved) ph.humanApproved = true;
    writeState(latest.statePath, latest.state);
    return ok({ statePath: latest.statePath, state: latest.state });
  }

  if (cmd === "complete-phase") {
    const phase = pos[1];
    if (GATED.has(phase)) fail(`${phase} はゲート対象フェーズです(pass-gate を使用)`);
    const latest = loadRun(root, flags);
    const ph = latest.state.phases[phase];
    if (ph.status !== "in_progress") fail(`フェーズ ${phase} は in_progress ではありません(${ph.status})`);
    if (phase === "pr") {
      if (!flags["pr-url"]) fail("pr フェーズには --pr-url が必要です");
      latest.state.pr.url = flags["pr-url"];
    }
    ph.status = "passed"; ph.note = flags.note ?? null;
    writeState(latest.statePath, latest.state);
    return ok({ statePath: latest.statePath, state: latest.state });
  }

  if (cmd === "mark-ask") {
    const phase = pos[1];
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
    if (latest.state.status !== "awaiting_human") fail(`awaiting_human ではありません(${latest.state.status})`);
    latest.state.status = "active";
    for (const ph of Object.values(latest.state.phases))
      if (ph.status === "awaiting_human") ph.status = "in_progress";
    writeState(latest.statePath, latest.state);
    return ok({ statePath: latest.statePath, state: latest.state });
  }

  if (cmd === "record-attempt") {
    const phase = pos[1];
    const latest = loadRun(root, flags);
    const ph = latest.state.phases[phase];
    ph.attempts = (ph.attempts ?? 0) + 1;
    if (ph.attempts > latest.state.limits.maxFixAttempts) {
      latest.state.status = "awaiting_human";
      writeState(latest.statePath, latest.state);
      ok({ statePath: latest.statePath, state: latest.state, capExceeded: true });
      process.exit(3);
    }
    writeState(latest.statePath, latest.state);
    return ok({ statePath: latest.statePath, state: latest.state, capExceeded: false });
  }

  if (cmd === "finalize") {
    const latest = loadRun(root, flags);
    for (const [name, ph] of Object.entries(latest.state.phases)) {
      if (name === "finalize") continue;
      if (ph.status !== "passed") fail(`フェーズ ${name} が未完了です(${ph.status})`);
    }
    latest.state.phases["finalize"].status = "passed";
    latest.state.status = "awaiting_outcome";
    writeState(latest.statePath, latest.state);
    return ok({ statePath: latest.statePath, state: latest.state });
  }

  if (cmd === "record-outcome") {
    const latest = loadRun(root, flags);
    const outcome = flags.outcome;
    if (!["approved", "rejected", "incident"].includes(outcome)) fail(`不正な outcome: ${outcome}`);
    if (!["awaiting_outcome", "completed", "rejected"].includes(latest.state.status))
      fail(`outcome を記録できる状態ではありません(${latest.state.status})`);
    if (outcome === "approved") latest.state.status = "completed";
    if (outcome === "rejected") latest.state.status = "rejected";
    if (outcome === "incident") latest.state.incidents.push({ at: new Date().toISOString(), note: flags.note ?? null });
    writeState(latest.statePath, latest.state);
    return ok({ statePath: latest.statePath, state: latest.state });
  }

  fail(`不明なコマンド: ${cmd}`);
}

if (import.meta.url === `file://${process.argv[1]}`) main(process.argv.slice(2));
