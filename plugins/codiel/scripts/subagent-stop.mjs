#!/usr/bin/env node

// src/hooks/subagent-stop.ts
import fs3 from "node:fs";
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
import fs2 from "node:fs";
import path2 from "node:path";
async function readStdin() {
  let data = "";
  for await (const chunk of process.stdin) data += chunk;
  return JSON.parse(data);
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

// src/hooks/subagent-stop.ts
var ARTIFACTS = {
  init: "issue.md",
  discuss: "agenda.md",
  design: "design.md",
  "dev-plan": "dev-plan.md"
};
var input = await readStdin();
if (!input.stop_hook_active) {
  const run = findActiveRun(findProjectRoot(input.cwd ?? process.cwd()));
  if (run && run.state.status === "active") {
    const inProgressPhases = Object.entries(run.state.phases).filter(([, ph]) => ph.status === "in_progress").map(([name]) => name);
    if (inProgressPhases.length === 1) {
      const phase = inProgressPhases[0];
      if (ARTIFACTS[phase]) {
        const artifact = path3.join(run.dir, ARTIFACTS[phase]);
        if (!fs3.existsSync(artifact) || fs3.statSync(artifact).size === 0) {
          process.stdout.write(
            `${JSON.stringify({
              decision: "block",
              reason: `\u30D5\u30A7\u30FC\u30BA ${phase} \u306E\u6210\u679C\u7269 ${ARTIFACTS[phase]} \u304C ${run.dir} \u306B\u3042\u308A\u307E\u305B\u3093\u3002\u6210\u679C\u7269\u3092\u66F8\u304D\u51FA\u3057\u3066\u304B\u3089\u5B8C\u4E86\u3057\u3066\u304F\u3060\u3055\u3044\u3002`
            })}
`
          );
        }
      }
    }
  }
}
process.exit(0);
