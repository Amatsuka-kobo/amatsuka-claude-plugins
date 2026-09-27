#!/usr/bin/env node

// src/hooks/guard-bash.ts
import fs3 from "node:fs";
import path3 from "node:path";

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
var FORCE_TOKENS = [
  "--force",
  "-f",
  "--force-with-lease",
  "--force-if-includes"
];
function isForceToken(tok) {
  return FORCE_TOKENS.includes(tok) || tok.startsWith("--force-with-lease=");
}
function hasForcePush(invocations) {
  return invocations.some(
    (inv) => inv.subcommand === "push" && pushArgs(inv).some(isForceToken)
  );
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
var GENERATED_MARKER = "<!-- codiel:generated -->";
var MARKED_GH_COMMANDS = /* @__PURE__ */ new Set([
  "issue create",
  "issue comment",
  "issue edit",
  "pr create",
  "pr comment",
  "pr edit",
  "pr review"
]);
var FILL_FLAGS = ["--fill", "--fill-first", "--fill-verbose"];
var TEMPLATE_FLAGS = ["--template", "-T"];
var AUTO_BODY_FLAGS = {
  "pr create": [...FILL_FLAGS, ...TEMPLATE_FLAGS],
  "issue create": TEMPLATE_FLAGS
};
function hasFlag(tokens, names) {
  return tokens.some(
    (tok) => names.some(
      (n) => tok === n || tok.startsWith(`${n}=`) || /^-[^-]$/.test(n) && tok.startsWith(n) && tok.length > 2
    )
  );
}
var GH_VALUE_OPTS = ["-R", "--repo"];
function isGhToken(tok) {
  const stripped = tok.replace(/^[("'`$]+/, "");
  return stripped === "gh" || stripped.endsWith("/gh");
}
function unquote(tok) {
  return tok.replace(/^["']+|["']+$/g, "");
}
function stripHeredocBodies(cmd) {
  const lines = cmd.split("\n");
  const HEREDOC_START_RE = /<<-?(['"]?)(\w+)\1/;
  let i = 0;
  while (i < lines.length) {
    const m = lines[i].match(HEREDOC_START_RE);
    if (!m) {
      i++;
      continue;
    }
    const word = m[2];
    let end = i + 1;
    while (end < lines.length && lines[end].trim() !== word) end++;
    for (let k = i + 1; k <= end && k < lines.length; k++) lines[k] = "";
    i = end + 1;
  }
  return lines.join("\n");
}
function findGhInvocations(cmd) {
  const invocations = [];
  for (const segment of stripHeredocBodies(cmd).split(SEGMENT_SPLIT_RE)) {
    const tokens = segment.trim().split(/\s+/).filter(Boolean);
    const ghIdx = tokens.findIndex((tok) => isGhToken(tok));
    if (ghIdx === -1) continue;
    const skipOptions = (from) => {
      let idx = from;
      while (idx < tokens.length && tokens[idx].startsWith("-"))
        idx += GH_VALUE_OPTS.includes(tokens[idx]) ? 2 : 1;
      return idx;
    };
    const objIdx = skipOptions(ghIdx + 1);
    const object = tokens[objIdx];
    if (object === "api") {
      invocations.push({ tokens, command: "api" });
      continue;
    }
    const action = tokens[skipOptions(objIdx + 1)];
    if (object !== void 0 && action !== void 0)
      invocations.push({ tokens, command: `${object} ${action}` });
  }
  return invocations;
}
function flagAt(tokens, i, names) {
  const tok = tokens[i];
  for (const n of names) {
    if (tok === n) return tokens[i + 1];
    if (tok.startsWith(`${n}=`)) return tok.slice(n.length + 1);
    if (/^-[^-]$/.test(n) && tok.startsWith(n) && tok.length > 2)
      return tok.slice(2);
  }
  return void 0;
}
function flagValue(tokens, names) {
  for (let i = 0; i < tokens.length; i++) {
    const value = flagAt(tokens, i, names);
    if (value !== void 0) return value;
  }
  return void 0;
}
function readBodyFile(flag, file, cwd) {
  if (file === "-")
    emit(
      "deny",
      `${flag} \u306B - (\u6A19\u6E96\u5165\u529B)\u306F\u6307\u5B9A\u3067\u304D\u307E\u305B\u3093\u3002\u672C\u6587\u3092\u30D5\u30A1\u30A4\u30EB\u306B\u66F8\u304D\u3001\u30D1\u30B9\u3067\u6E21\u3057\u76F4\u3057\u3066\u304F\u3060\u3055\u3044`
    );
  try {
    return fs3.readFileSync(path3.resolve(cwd, file), "utf8");
  } catch {
    return emit("deny", `${flag} \u306E\u30D5\u30A1\u30A4\u30EB\u3092\u8AAD\u307F\u8FBC\u3081\u307E\u305B\u3093: ${file}`);
  }
}
function denyMissingMarker(command) {
  return emit(
    "deny",
    `gh ${command} \u306E\u672C\u6587\u306B \`${GENERATED_MARKER}\` \u3092\u542B\u3081\u3066\u6295\u7A3F\u3057\u76F4\u3057\u3066\u304F\u3060\u3055\u3044`
  );
}
function checkGhApiBody(tokens, cmd, cwd) {
  const fields = [];
  for (let i = 0; i < tokens.length; i++) {
    const raw = flagAt(tokens, i, ["--raw-field", "-f"]);
    if (raw !== void 0) fields.push({ typed: false, value: unquote(raw) });
    const typed = flagAt(tokens, i, ["--field", "-F"]);
    if (typed !== void 0) fields.push({ typed: true, value: unquote(typed) });
  }
  const input = flagValue(tokens, ["--input"]);
  const explicitMethod = flagValue(tokens, ["--method", "-X"]);
  const method = explicitMethod !== void 0 ? unquote(explicitMethod).toUpperCase() : fields.length > 0 || input !== void 0 ? "POST" : "GET";
  if (!["POST", "PATCH", "PUT"].includes(method)) return;
  for (const { typed, value } of fields) {
    const eq = value.indexOf("=");
    const key = eq === -1 ? value : value.slice(0, eq);
    if (key !== "body" && !key.endsWith("[body]")) continue;
    const val = value.slice(eq + 1);
    if (typed && val.startsWith("@")) {
      const content = readBodyFile("-F", unquote(val.slice(1)), cwd);
      if (!content.includes(GENERATED_MARKER)) denyMissingMarker("api");
    } else if (!cmd.includes(GENERATED_MARKER)) denyMissingMarker("api");
  }
  if (input !== void 0) {
    const content = readBodyFile("--input", unquote(input), cwd);
    if (/"body"\s*:/.test(content) && !content.includes(GENERATED_MARKER))
      denyMissingMarker("api");
  }
}
function checkGeneratedMarker(cmd, cwd) {
  for (const inv of findGhInvocations(cmd)) {
    if (inv.command === "api") {
      checkGhApiBody(inv.tokens, cmd, cwd);
      continue;
    }
    if (!MARKED_GH_COMMANDS.has(inv.command)) continue;
    const bodyVal = flagValue(inv.tokens, ["--body", "-b"]);
    const bodyFileVal = flagValue(inv.tokens, ["--body-file", "-F"]);
    if (bodyVal === void 0 && bodyFileVal === void 0) {
      const autoFlags = AUTO_BODY_FLAGS[inv.command];
      if (autoFlags && hasFlag(inv.tokens, autoFlags))
        emit(
          "deny",
          `gh ${inv.command} \u306E --fill \u7CFB\u30FB--template/-T \u306F\u672C\u6587\u3092\u691C\u67FB\u3067\u304D\u307E\u305B\u3093\u3002\u30DE\u30FC\u30AB\u30FC\u4ED8\u304D\u306E\u672C\u6587\u3092 --body-file \u3067\u6E21\u3057\u3066\u4F5C\u308A\u76F4\u3057\u3066\u304F\u3060\u3055\u3044`
        );
      continue;
    }
    if (bodyVal !== void 0 && !cmd.includes(GENERATED_MARKER))
      denyMissingMarker(inv.command);
    if (bodyFileVal !== void 0) {
      const content = readBodyFile("--body-file", unquote(bodyFileVal), cwd);
      if (!content.includes(GENERATED_MARKER)) denyMissingMarker(inv.command);
    }
  }
}
try {
  const input = await readStdin();
  const cmd = input.tool_input?.command ?? "";
  const gitInvocations = findGitInvocations(cmd);
  const isGitPush = gitInvocations.some((inv) => inv.subcommand === "push");
  const ALWAYS_DENY = [
    [
      /\brm\s+(-[a-zA-Z]*r[a-zA-Z]*f|-[a-zA-Z]*f[a-zA-Z]*r)[a-zA-Z]*\s+(\/(?!tmp)|~)/.test(
        cmd
      ),
      "\u4F5C\u696D\u30C4\u30EA\u30FC\u5916\u3078\u306E rm -rf"
    ],
    [
      /\b(curl|wget)\b[^|;&]*\|\s*(ba|z)?sh\b/.test(cmd),
      "\u30C0\u30A6\u30F3\u30ED\u30FC\u30C9\u3057\u305F\u30B9\u30AF\u30EA\u30D7\u30C8\u306E\u76F4\u63A5\u5B9F\u884C(curl | sh)"
    ],
    [hasForcePush(gitInvocations), "force push"],
    [
      pushesToProtectedBranch(gitInvocations),
      "\u4FDD\u8B77\u30D6\u30E9\u30F3\u30C1(main/master)\u3078\u306E push"
    ],
    [
      /(>|>>|\btee\b|\bsed\s+-i\b)[^\n]*\.codiel\/runs\/[^\s]*state\.json/.test(
        cmd
      ),
      "state.json \u3078\u306E\u30B7\u30A7\u30EB\u7D4C\u7531\u306E\u66F8\u304D\u8FBC\u307F"
    ],
    [
      /\b(cp|mv|dd|install)\b[^\n;|&]*\.codiel\/runs\/[^\s]*state\.json/.test(
        cmd
      ),
      "state.json \u3078\u306E cp/mv/dd/install \u7D4C\u7531\u306E\u66F8\u304D\u8FBC\u307F"
    ]
  ];
  for (const [triggered, why] of ALWAYS_DENY)
    if (triggered) emit("deny", `\u7981\u6B62\u30B3\u30DE\u30F3\u30C9: ${why}`);
  const cwd = input.cwd ?? process.cwd();
  const root = findProjectRoot(cwd);
  const run = findActiveRun(root);
  if (run) {
    const phase = run.state.phase;
    const testLoopPassed = run.state.phases["test-loop"]?.status === "passed";
    if (/\bgh\s+issue\s+create\b/.test(cmd) && phase !== "triage")
      emit(
        "deny",
        `gh issue create \u306F triage \u30D5\u30A7\u30FC\u30BA\u3067\u306E\u307F\u5B9F\u884C\u3067\u304D\u307E\u3059(\u73FE\u5728: ${phase})`
      );
    if (/\bgh\s+pr\s+create\b/.test(cmd) && (phase !== "pr" || !testLoopPassed))
      emit(
        "deny",
        `PR \u4F5C\u6210\u306F pr \u30D5\u30A7\u30FC\u30BA\u304B\u3064 test-loop \u5408\u683C\u5F8C\u306E\u307F\u53EF\u80FD\u3067\u3059(\u73FE\u5728: ${phase}, test-loop passed: ${testLoopPassed})`
      );
    if (isGitPush && (!["pr", "fix-loop", "triage", "finalize"].includes(phase) || !testLoopPassed))
      emit(
        "deny",
        `push \u306F test-loop \u5408\u683C\u5F8C\u306E pr \u4EE5\u964D\u306E\u30D5\u30A7\u30FC\u30BA\u3067\u306E\u307F\u53EF\u80FD\u3067\u3059(\u73FE\u5728: ${phase})`
      );
    checkGeneratedMarker(cmd, cwd);
  }
  pass();
} catch (e) {
  emit(
    "ask",
    `guard-bash \u306E\u5185\u90E8\u30A8\u30E9\u30FC(\u30D5\u30A7\u30A4\u30EB\u30AF\u30ED\u30FC\u30BA\u30C9): ${e.message}`
  );
}
