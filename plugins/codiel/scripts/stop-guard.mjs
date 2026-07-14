#!/usr/bin/env node

// src/hooks/lib.ts
import fs from "node:fs";
import path from "node:path";
async function readStdin() {
  let data = "";
  for await (const chunk of process.stdin) data += chunk;
  return JSON.parse(data);
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

// src/codiel-state.ts
import fs2 from "node:fs";
import path2 from "node:path";
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
  return JSON.parse(fs2.readFileSync(p, "utf8"));
}
function runDir(root, issue) {
  return path2.join(root, ".codiel", "runs", `issue-${issue}`);
}
function tries(dir) {
  if (!fs2.existsSync(dir)) return [];
  return fs2.readdirSync(dir).filter((d) => /^try-\d+$/.test(d)).map((d) => Number(d.slice(4))).sort((a, b) => a - b);
}
function latestTry(root, issue) {
  const dir = runDir(root, issue);
  const ts = tries(dir);
  if (ts.length === 0) return null;
  const n = ts[ts.length - 1];
  const p = path2.join(dir, `try-${n}`, "state.json");
  return { tryN: n, statePath: p, state: readState(p) };
}
function findActiveRun(root) {
  const runsRoot = path2.join(root, ".codiel", "runs");
  if (!fs2.existsSync(runsRoot)) return null;
  let best = null;
  for (const r of fs2.readdirSync(runsRoot).filter((d) => /^issue-\d+$/.test(d))) {
    const latest = latestTry(root, Number(r.slice(6)));
    if (!latest) continue;
    if (latest.state.status === "active" || latest.state.status === "awaiting_human") {
      if (!best || latest.state.updatedAt > best.state.updatedAt) {
        best = { dir: path2.dirname(latest.statePath), statePath: latest.statePath, state: latest.state };
      }
    }
  }
  return best;
}

// src/hooks/stop-guard.ts
var input = await readStdin();
if (!input.stop_hook_active) {
  const run = findActiveRun(findProjectRoot(input.cwd ?? process.cwd()));
  if (run && run.state.status === "active") {
    process.stdout.write(JSON.stringify({
      decision: "block",
      reason: `Codiel run ${run.state.runId} try-${run.state.try} \u304C\u672A\u5B8C\u4E86\u3067\u3059(phase: ${run.state.phase})\u3002\u30D5\u30A7\u30FC\u30BA\u3092\u7D9A\u884C\u3057\u3066\u304F\u3060\u3055\u3044\u3002\u4E2D\u6B62\u3059\u308B\u5834\u5408\u306F codiel-state stop --reason \u3067\u660E\u793A\u7684\u306B\u505C\u6B62\u3057\u307E\u3059\u3002triage\u30FBdiscuss(\u8AD6\u70B9\u306E\u56DE\u7B54\u5F85\u3061)\u30FBdesign \u306E\u30A6\u30A9\u30FC\u30AF\u30B9\u30EB\u30FC\u7B49\u3067\u30E6\u30FC\u30B6\u30FC\u306E\u56DE\u7B54\u3092\u5F85\u3063\u3066\u505C\u6B62\u3059\u308B\u5834\u5408\u306F\u6B63\u5F53\u306A\u505C\u6B62\u3067\u3042\u308A\u3001\u305D\u306E\u65E8\u3092\u6700\u7D42\u30E1\u30C3\u30BB\u30FC\u30B8\u3067\u660E\u793A\u3057\u3066\u304B\u3089\u505C\u6B62\u3059\u308B\u3053\u3068\u3002`
    }) + "\n");
  }
}
process.exit(0);
