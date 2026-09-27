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
function readState(p) {
  return JSON.parse(fs.readFileSync(p, "utf8"));
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
function findActiveRun(root) {
  let best = null;
  for (const latest of latestTries(root)) {
    const st = latest.state;
    if (st.version !== 2) continue;
    if (st.status !== "active" && st.status !== "awaiting_human") continue;
    if (!best || st.updatedAt > best.state.updatedAt)
      best = {
        dir: path.dirname(latest.statePath),
        statePath: latest.statePath,
        state: st
      };
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

// src/hooks/stop-guard.ts
var input = await readStdin();
if (!input.stop_hook_active) {
  const run = findActiveRun(findProjectRoot(input.cwd ?? process.cwd()));
  if (run && run.state.status === "active") {
    process.stdout.write(
      `${JSON.stringify({
        decision: "block",
        reason: `Codiel run ${run.state.runId} try-${run.state.try} \u304C\u672A\u5B8C\u4E86\u3067\u3059(phase: ${run.state.phase})\u3002\u30D5\u30A7\u30FC\u30BA\u3092\u7D9A\u884C\u3057\u3066\u304F\u3060\u3055\u3044\u3002\u4E2D\u6B62\u3059\u308B\u5834\u5408\u306F codiel-state stop --reason \u3067\u660E\u793A\u7684\u306B\u505C\u6B62\u3057\u307E\u3059\u3002\u4EBA\u306B\u78BA\u8A8D\u3057\u3066\u6B62\u307E\u308B\u3068\u304D\u306F\u3001\u5148\u306B codiel-state mark-ask ${run.state.phase} --slug ${run.state.runId} --kind confirm \u3067 awaiting_human \u306B\u3057\u3066\u304B\u3089\u505C\u6B62\u3059\u308B\u3053\u3068\u3002mark-ask \u304C\u53D7\u3051\u4ED8\u3051\u308B\u306E\u306F in_progress \u306E\u30D5\u30A7\u30FC\u30BA\u3068 pending \u306E finalize \u3060\u3051\u306A\u306E\u3067\u3001\u30D5\u30A7\u30FC\u30BA\u306E\u5408\u9593(\u76F4\u524D\u306E\u30D5\u30A7\u30FC\u30BA\u304C passed \u3067\u6B21\u306E\u30D5\u30A7\u30FC\u30BA\u304C\u307E\u3060 pending)\u3067\u306F\u3001\u6B21\u306E\u30D5\u30A7\u30FC\u30BA\u3092 start-phase \u3057\u3066\u304B\u3089 mark-ask \u3059\u308B\u3053\u3068\u3002`
      })}
`
    );
  }
}
process.exit(0);
