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

// src/hooks/guard-github-mcp.ts
var MARKER = "<!-- codiel:generated -->";
var TARGET_TOOL_RE = /^mcp__.*[Gg][Ii][Tt][Hh][Uu][Bb].*__(issue_write|create_issue|update_issue|update_issue_body|add_issue_comment|update_issue_comment|create_pull_request|update_pull_request|update_pull_request_body|create_pull_request_review|pull_request_review_write|submit_pending_pull_request_review|add_comment_to_pending_review|add_pull_request_review_comment|add_reply_to_pull_request_comment)$/;
try {
  const input = await readStdin();
  if (!TARGET_TOOL_RE.test(input.tool_name ?? "")) pass();
  const run = findActiveRun(findMainRoot(input.cwd ?? process.cwd()));
  if (!run) pass();
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
