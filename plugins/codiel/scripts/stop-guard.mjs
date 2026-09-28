#!/usr/bin/env node

// src/codiel-state.ts
import fs from "node:fs";
import path from "node:path";
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
    if (isLegacy(st)) continue;
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
function isLegacy(st) {
  return st.version !== 2 || !("test-code" in st.phases);
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
var CODIEL_WORKTREES_RE = /[/\\]\.codiel[/\\]worktrees[/\\]/;
function findMainRoot(startDir) {
  const m = CODIEL_WORKTREES_RE.exec(startDir);
  if (m) return startDir.slice(0, m.index) || startDir.slice(0, 1);
  return findProjectRoot(startDir);
}

// src/hooks/stop-guard.ts
var input = await readStdin();
if (!input.stop_hook_active) {
  const run = findActiveRun(findMainRoot(input.cwd ?? process.cwd()));
  if (run && run.state.status === "active") {
    const { runId, try: tryN, phase } = run.state;
    const header = `Codiel run ${runId} try-${tryN} \u304C\u672A\u5B8C\u4E86\u3067\u3059(phase: ${phase})\u3002`;
    let reason;
    const stopHint = `\u4E2D\u6B62\u3059\u308B\u306A\u3089 codiel-state stop --slug ${runId} --reason <\u7406\u7531> \u3067\u660E\u793A\u7684\u306B\u6B62\u3081\u308B\u3053\u3068\u3002`;
    if (phase === null) {
      reason = `${header}` + stopHint + `capturing-intent \u306E\u624B\u9806 5 \u306E (6) \u3092\u6700\u5F8C\u307E\u3067\u9032\u3081\u308B\u3053\u3068\u3002git switch -c \u304B git commit \u304C\u5931\u6557\u3057\u305F\u3068\u304D\u306F\u3001codiel-state stop --slug ${runId} --reason commit-failed \u3067 run \u3092\u7D42\u7AEF\u306B\u3057\u3066\u304B\u3089\u78BA\u304B\u3081\u308B\u3053\u3068\u3002`;
    } else if (run.state.phases[phase].status === "passed") {
      if (run.state.branch === null && run.state.phases.intent.status === "passed") {
        reason = `${header}` + stopHint + `intent-only \u306E run(branch \u304C null)\u306A\u306E\u3067\u3001codiel-state close --slug ${runId} --reason intent-only \u3067 run \u3092\u7D42\u3048\u308B\u3053\u3068\u3002`;
      } else if (phase === "finalize") {
        reason = `${header}` + stopHint + `finalize \u306F\u5B8C\u4E86\u6E08\u307F\u3060\u304C run \u304C active \u306E\u307E\u307E\u6B8B\u3063\u3066\u3044\u308B\u3002codiel-state finalize --slug ${runId} \u3092\u5B9F\u884C\u3057\u76F4\u3057\u3066 awaiting_outcome \u306B\u3057\u3066\u304B\u3089\u505C\u6B62\u3059\u308B\u3053\u3068\u3002`;
      } else {
        const stage = STAGES.find((s) => s.includes(phase)) ?? [];
        const inProgressSibling = stage.find(
          (p) => p !== phase && run.state.phases[p].status === "in_progress"
        );
        reason = `${header}` + stopHint + `\u6B21\u306B\u9032\u3081\u308B\u30D5\u30A7\u30FC\u30BA\u3092 codiel-state start-phase <\u30D5\u30A7\u30FC\u30BA> --slug ${runId} \u3067\u958B\u59CB\u3057\u3066\u304B\u3089(\u30B9\u30AD\u30C3\u30D7\u3059\u308B\u30D5\u30A7\u30FC\u30BA\u306A\u3089\u5148\u306B codiel-state skip-phase <\u30D5\u30A7\u30FC\u30BA> --slug ${runId} --reason "<\u7406\u7531>" \u3067\u98DB\u3070\u3057\u3066\u304B\u3089)\u3001codiel-state mark-ask <\u30D5\u30A7\u30FC\u30BA> --slug ${runId} --kind confirm \u3067 awaiting_human \u306B\u3057\u3066\u304B\u3089\u505C\u6B62\u3059\u308B\u3053\u3068\u3002finalize \u3078\u9032\u3080\u3068\u304D\u306F start-phase \u3092\u4F7F\u308F\u305A\u3001codiel-state mark-ask finalize --slug ${runId} --kind confirm \u3067\u76F4\u63A5 awaiting_human \u306B\u3059\u308B\u3053\u3068\u3002` + // 並列ステージの in_progress のきょうだいへの確認案内(M2-FX5-B b)。
        (inProgressSibling ? `\u540C\u3058\u30B9\u30C6\u30FC\u30B8\u306E ${inProgressSibling} \u304C in_progress \u306E\u307E\u307E\u6B8B\u3063\u3066\u3044\u308B\u306A\u3089\u3001\u6B21\u306E\u30D5\u30A7\u30FC\u30BA\u3078\u9032\u3080\u524D\u306B codiel-state mark-ask ${inProgressSibling} --slug ${runId} --kind confirm \u3067\u78BA\u8A8D\u3059\u308B\u3053\u3068\u3002` : "");
      }
    } else {
      reason = `${header}` + stopHint + `\u4EBA\u306B\u78BA\u8A8D\u3057\u3066\u6B62\u307E\u308B\u3068\u304D\u306F codiel-state mark-ask ${phase} --slug ${runId} --kind confirm \u3067 awaiting_human \u306B\u3057\u3066\u304B\u3089\u505C\u6B62\u3059\u308B\u3053\u3068\u3002\u30B5\u30D6\u30A8\u30FC\u30B8\u30A7\u30F3\u30C8\u306E\u5B8C\u4E86\u3092\u5F85\u3064\u306A\u3089\u3001\u59D4\u8B72\u3092\u524D\u666F\u3067\u51FA\u3057\u76F4\u3057\u3066\u5831\u544A\u3092\u53D7\u3051\u53D6\u308B\u3053\u3068(Agent \u30C4\u30FC\u30EB\u306E run_in_background \u3092\u4F7F\u308F\u306A\u3044)\u3002`;
    }
    process.stdout.write(`${JSON.stringify({ decision: "block", reason })}
`);
  }
}
process.exit(0);
