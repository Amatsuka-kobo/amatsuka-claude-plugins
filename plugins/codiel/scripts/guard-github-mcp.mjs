#!/usr/bin/env node

// src/codiel-state.ts
import fs2 from "node:fs";
import path2 from "node:path";

// src/hooks/lib.ts
import fs from "node:fs";
import path from "node:path";
async function readStdin() {
  let data = "";
  for await (const chunk of process.stdin) data += chunk;
  return JSON.parse(data);
}
function emit(decision, reason) {
  process.stdout.write(
    `${JSON.stringify({
      hookSpecificOutput: {
        hookEventName: "PreToolUse",
        permissionDecision: decision,
        permissionDecisionReason: reason
      }
    })}
`
  );
  process.exit(0);
}
function pass() {
  process.exit(0);
}
function ghPostPhaseProblem(kind, state) {
  const phase = state.phase;
  if (kind === "issue")
    return phase === "triage" ? null : `Issue \u306E\u4F5C\u6210\u306F triage \u30D5\u30A7\u30FC\u30BA\u3067\u306E\u307F\u5B9F\u884C\u3067\u304D\u307E\u3059(\u73FE\u5728: ${phase})`;
  const testLoopPassed = state.phases["test-loop"]?.status === "passed";
  return phase === "pr" && testLoopPassed ? null : `PR \u4F5C\u6210\u306F pr \u30D5\u30A7\u30FC\u30BA\u304B\u3064 test-loop \u5408\u683C\u5F8C\u306E\u307F\u53EF\u80FD\u3067\u3059(\u73FE\u5728: ${phase}, test-loop passed: ${testLoopPassed})`;
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
var CODIEL_WORKTREES_RE = /[/\\]\.codiel[/\\]worktrees[/\\]/;
function findMainRoot(startDir) {
  const m = CODIEL_WORKTREES_RE.exec(startDir);
  if (m) return startDir.slice(0, m.index) || startDir.slice(0, 1);
  return findProjectRoot(startDir);
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
function readState(p) {
  const st = JSON.parse(fs2.readFileSync(p, "utf8"));
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
  st.candidates ??= { adr: false, gotchas: false };
  return st;
}
function runDir(root, slug) {
  return path2.join(root, ".codiel", "runs", slug);
}
function tries(dir) {
  if (!fs2.existsSync(dir)) return [];
  return fs2.readdirSync(dir).filter((d) => /^try-\d+$/.test(d)).map((d) => Number(d.slice(4))).sort((a, b) => a - b);
}
function latestTry(root, slug) {
  const dir = runDir(root, slug);
  for (const n of tries(dir).reverse()) {
    const p = path2.join(dir, `try-${n}`, "state.json");
    if (fs2.existsSync(p)) return { tryN: n, statePath: p, state: readState(p) };
  }
  return null;
}
function latestTries(root) {
  const runsRoot = path2.join(root, ".codiel", "runs");
  if (!fs2.existsSync(runsRoot)) return [];
  const found = [];
  for (const d of fs2.readdirSync(runsRoot, { withFileTypes: true })) {
    if (!d.isDirectory()) continue;
    let t = null;
    let broken = false;
    try {
      t = latestTry(root, d.name);
      broken = t !== null && (typeof t.state.phases !== "object" || !t.state.phases);
    } catch {
      broken = true;
    }
    if (broken) {
      process.stderr.write(
        `codiel: \u58CA\u308C\u305F state \u306E run \u3092\u98DB\u3070\u3057\u307E\u3057\u305F: ${d.name}
`
      );
      continue;
    }
    if (t) found.push(t);
  }
  return found;
}
function findActiveRun(root) {
  let best = null;
  for (const latest of latestTries(root)) {
    const st = latest.state;
    if (isLegacy(st)) continue;
    if (st.status !== "active" && st.status !== "awaiting_human") continue;
    if (!best || st.updatedAt > best.state.updatedAt)
      best = {
        dir: path2.dirname(latest.statePath),
        statePath: latest.statePath,
        state: st
      };
  }
  return best;
}
function isLegacy(st) {
  return st.version !== 2 || !("test-code" in st.phases);
}

// src/hooks/guard-github-mcp.ts
var MARKER = "<!-- codiel:generated -->";
var TARGET_TOOL_RE = /^mcp__.*[Gg][Ii][Tt][Hh][Uu][Bb].*__(issue_write|create_issue|update_issue|update_issue_body|add_issue_comment|update_issue_comment|create_pull_request|update_pull_request|update_pull_request_body|create_pull_request_review|pull_request_review_write|submit_pending_pull_request_review|add_comment_to_pending_review|add_pull_request_review_comment|add_reply_to_pull_request_comment)$/;
try {
  const input = await readStdin();
  if (!TARGET_TOOL_RE.test(input.tool_name ?? "")) pass();
  const run = findActiveRun(findMainRoot(input.cwd ?? process.cwd()));
  if (!run) pass();
  const tool = (input.tool_name ?? "").replace(/^.*__/, "");
  const kind = tool === "create_pull_request" ? "pr" : tool === "create_issue" || tool === "issue_write" && input.tool_input?.method === "create" ? "issue" : null;
  const problem = kind && ghPostPhaseProblem(kind, run.state);
  if (problem) emit("deny", problem);
  const body = input.tool_input?.body;
  if (typeof body !== "string") pass();
  if (!body.includes(MARKER))
    emit(
      "deny",
      `GitHub MCP \u306E\u6295\u7A3F\u306B\u306F\u30DE\u30FC\u30AB\u30FC\u304C\u5FC5\u8981\u3067\u3059\u3002\u672C\u6587\u306B ${MARKER} \u3092\u542B\u3081\u3066\u6295\u7A3F\u3057\u76F4\u3057\u3066\u304F\u3060\u3055\u3044\u3002`
    );
  pass();
} catch (e) {
  emit(
    "ask",
    `guard-github-mcp \u306E\u5185\u90E8\u30A8\u30E9\u30FC(\u30D5\u30A7\u30A4\u30EB\u30AF\u30ED\u30FC\u30BA\u30C9): ${e.message}`
  );
}
