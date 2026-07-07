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
  // Handle --active flag specially: remove it from argv to avoid parseArgs eating the next arg
  const hasActive = argv.includes("--active");
  if (hasActive) {
    argv = argv.filter(arg => arg !== "--active");
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
    latest.state.status = "stopped";
    latest.state.stopReason = flags.reason ?? null;
    writeState(latest.statePath, latest.state);
    return ok({ statePath: latest.statePath, state: latest.state });
  }

  fail(`不明なコマンド: ${cmd}`);
}

if (import.meta.url === `file://${process.argv[1]}`) main(process.argv.slice(2));
