#!/usr/bin/env node

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

// src/hooks/guard-bash.ts
var SEGMENT_SPLIT_RE = /;|&&|&|\|\||\||\n/;
var VALUE_TAKING_OPTS = ["-C", "--git-dir", "--work-tree", "-c"];
function isGitToken(tok) {
  const stripped = tok.replace(/^\(+/, "");
  return stripped === "git" || stripped.endsWith("/git");
}
function findGitInvocations(cmd) {
  const invocations = [];
  for (const segment of cmd.split(SEGMENT_SPLIT_RE)) {
    const tokens = segment.trim().split(/\s+/).filter(Boolean);
    let gitIdx = tokens.findIndex((tok) => isGitToken(tok));
    while (gitIdx !== -1) {
      let idx = gitIdx + 1;
      while (idx < tokens.length) {
        const tok = tokens[idx];
        if (!tok.startsWith("-")) break;
        const isValueOpt = VALUE_TAKING_OPTS.includes(tok) || VALUE_TAKING_OPTS.some((o) => tok.startsWith(`${o}=`));
        idx += isValueOpt && !tok.includes("=") ? 2 : 1;
      }
      const subcommand = tokens[idx];
      if (subcommand !== void 0) {
        invocations.push({ tokens, subIdx: idx, subcommand });
      }
      const rest = tokens.slice(gitIdx + 1).findIndex((tok) => isGitToken(tok));
      gitIdx = rest === -1 ? -1 : gitIdx + 1 + rest;
    }
  }
  return invocations;
}
function pushArgs(inv) {
  return inv.tokens.slice(inv.subIdx + 1);
}
var FORCE_TOKENS = ["--force", "-f", "--force-with-lease", "--force-if-includes"];
function isForceToken(tok) {
  return FORCE_TOKENS.includes(tok) || tok.startsWith("--force-with-lease=");
}
function hasForcePush(invocations) {
  return invocations.some((inv) => inv.subcommand === "push" && pushArgs(inv).some(isForceToken));
}
function isProtectedBranchDest(token) {
  const stripped = token.startsWith("+") ? token.slice(1) : token;
  const lastColon = stripped.lastIndexOf(":");
  const dest = lastColon === -1 ? stripped : stripped.slice(lastColon + 1);
  return dest === "main" || dest === "master" || dest === "refs/heads/main" || dest === "refs/heads/master";
}
function pushesToProtectedBranch(invocations) {
  return invocations.some(
    (inv) => inv.subcommand === "push" && pushArgs(inv).some((t) => !t.startsWith("-") && isProtectedBranchDest(t))
  );
}
try {
  const input = await readStdin();
  const cmd = input.tool_input?.command ?? "";
  const gitInvocations = findGitInvocations(cmd);
  const isGitPush = gitInvocations.some((inv) => inv.subcommand === "push");
  const ALWAYS_DENY = [
    [/\brm\s+(-[a-zA-Z]*r[a-zA-Z]*f|-[a-zA-Z]*f[a-zA-Z]*r)[a-zA-Z]*\s+(\/(?!tmp)|~)/.test(cmd), "\u4F5C\u696D\u30C4\u30EA\u30FC\u5916\u3078\u306E rm -rf"],
    [/\b(curl|wget)\b[^|;&]*\|\s*(ba|z)?sh\b/.test(cmd), "\u30C0\u30A6\u30F3\u30ED\u30FC\u30C9\u3057\u305F\u30B9\u30AF\u30EA\u30D7\u30C8\u306E\u76F4\u63A5\u5B9F\u884C(curl | sh)"],
    [hasForcePush(gitInvocations), "force push"],
    [pushesToProtectedBranch(gitInvocations), "\u4FDD\u8B77\u30D6\u30E9\u30F3\u30C1(main/master)\u3078\u306E push"],
    [/(>|>>|\btee\b|\bsed\s+-i\b)[^\n]*\.codiel\/runs\/[^\s]*state\.json/.test(cmd), "state.json \u3078\u306E\u30B7\u30A7\u30EB\u7D4C\u7531\u306E\u66F8\u304D\u8FBC\u307F"],
    [/\b(cp|mv|dd|install)\b[^\n;|&]*\.codiel\/runs\/[^\s]*state\.json/.test(cmd), "state.json \u3078\u306E cp/mv/dd/install \u7D4C\u7531\u306E\u66F8\u304D\u8FBC\u307F"]
  ];
  for (const [triggered, why] of ALWAYS_DENY) if (triggered) emit("deny", `\u7981\u6B62\u30B3\u30DE\u30F3\u30C9: ${why}`);
  const root = findProjectRoot(input.cwd ?? process.cwd());
  const run = findActiveRun(root);
  if (run) {
    const phase = run.state.phase;
    const testLoopPassed = run.state.phases["test-loop"]?.status === "passed";
    if (/\bgh\s+issue\s+create\b/.test(cmd) && phase !== "triage")
      emit("deny", `gh issue create \u306F triage \u30D5\u30A7\u30FC\u30BA\u3067\u306E\u307F\u5B9F\u884C\u3067\u304D\u307E\u3059(\u73FE\u5728: ${phase})`);
    if (/\bgh\s+pr\s+create\b/.test(cmd) && (phase !== "pr" || !testLoopPassed))
      emit("deny", `PR \u4F5C\u6210\u306F pr \u30D5\u30A7\u30FC\u30BA\u304B\u3064 test-loop \u5408\u683C\u5F8C\u306E\u307F\u53EF\u80FD\u3067\u3059(\u73FE\u5728: ${phase}, test-loop passed: ${testLoopPassed})`);
    if (isGitPush && (!["pr", "fix-loop", "triage", "finalize"].includes(phase) || !testLoopPassed))
      emit("deny", `push \u306F test-loop \u5408\u683C\u5F8C\u306E pr \u4EE5\u964D\u306E\u30D5\u30A7\u30FC\u30BA\u3067\u306E\u307F\u53EF\u80FD\u3067\u3059(\u73FE\u5728: ${phase})`);
  }
  pass();
} catch (e) {
  emit("ask", `guard-bash \u306E\u5185\u90E8\u30A8\u30E9\u30FC(\u30D5\u30A7\u30A4\u30EB\u30AF\u30ED\u30FC\u30BA\u30C9): ${e.message}`);
}
