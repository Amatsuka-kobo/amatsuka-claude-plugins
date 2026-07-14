#!/usr/bin/env node

// src/hooks/guard-write.ts
import path3 from "node:path";

// src/hooks/lib.ts
import fs from "node:fs";
import path from "node:path";
async function readStdin() {
  let data = "";
  for await (const chunk of process.stdin) data += chunk;
  return JSON.parse(data);
}
function emit(decision, reason) {
  process.stdout.write(JSON.stringify({
    hookSpecificOutput: {
      hookEventName: "PreToolUse",
      permissionDecision: decision,
      permissionDecisionReason: reason
    }
  }) + "\n");
  process.exit(0);
}
function pass() {
  process.exit(0);
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

// src/hooks/guard-write.ts
var DOC_PHASES = /* @__PURE__ */ new Set(["init", "discuss", "design", "test-spec", "dev-plan"]);
var CODE_PHASES = /* @__PURE__ */ new Set(["implement", "test-loop", "fix-loop"]);
try {
  const input = await readStdin();
  const filePath = input.tool_input?.file_path;
  if (!filePath) pass();
  const abs = path3.resolve(input.cwd ?? process.cwd(), filePath);
  if (/[\/\\]\.codiel[\/\\]runs[\/\\].+[\/\\]state\.json$/i.test(abs))
    emit("deny", "state.json \u306F codiel-state \u30B9\u30AF\u30EA\u30D7\u30C8\u7D4C\u7531\u3067\u306E\u307F\u5909\u66F4\u3067\u304D\u307E\u3059(\u30D5\u30A7\u30FC\u30BA\u98DB\u3070\u3057\u30FB\u30B2\u30FC\u30C8\u507D\u88C5\u306E\u9632\u6B62)");
  const root = findProjectRoot(input.cwd ?? process.cwd());
  const rel = path3.relative(root, abs).replaceAll("\\", "/");
  const run = findActiveRun(root);
  if (!run || run.state.status !== "active") pass();
  const phase = run.state.phase;
  if (DOC_PHASES.has(phase)) {
    if (rel.startsWith(".codiel/") || rel.startsWith("docs/")) pass();
    emit("ask", `\u6587\u66F8\u30D5\u30A7\u30FC\u30BA(${phase})\u4E2D\u306B\u30B3\u30FC\u30C9\u9818\u57DF ${rel} \u3078\u66F8\u304D\u8FBC\u3082\u3046\u3068\u3057\u3066\u3044\u307E\u3059`);
  }
  if (CODE_PHASES.has(phase)) {
    if (/^\.codiel\/specs\/.+\/(spec|cases)\.md$/.test(rel))
      emit("ask", `\u30C6\u30B9\u30C8\u4ED5\u69D8\u30FB\u671F\u5F85\u5024(${rel})\u306E\u5909\u66F4\u306F test-designer \u306E\u62C5\u5F53\u3067\u3059(${phase} \u4E2D\u306E\u5909\u66F4\u306F\u6539\u7AC4\u306E\u7591\u3044)`);
    pass();
  }
  if (rel.startsWith(".codiel/")) pass();
  emit("ask", `\u30D5\u30A7\u30FC\u30BA ${phase} \u4E2D\u306E ${rel} \u3078\u306E\u66F8\u304D\u8FBC\u307F\u306F\u60F3\u5B9A\u5916\u3067\u3059`);
} catch (e) {
  emit("ask", `guard-write \u306E\u5185\u90E8\u30A8\u30E9\u30FC(\u30D5\u30A7\u30A4\u30EB\u30AF\u30ED\u30FC\u30BA\u30C9): ${e.message}`);
}
