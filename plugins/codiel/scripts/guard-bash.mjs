#!/usr/bin/env node

// src/hooks/guard-bash.ts
import fs4 from "node:fs";
import os2 from "node:os";
import path4 from "node:path";

// src/codiel-state.ts
import fs3 from "node:fs";
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
function resolvePhysicalPath(base, p) {
  const joined = path.isAbsolute(p) ? p : `${base}${path.sep}${p}`;
  let cur = path.parse(path.resolve(base)).root;
  for (const seg of joined.split(/[/\\]+/)) {
    if (seg === "" || seg === ".") continue;
    const next = seg === ".." ? path.dirname(cur) : path.join(cur, seg);
    try {
      cur = fs.realpathSync(next);
    } catch {
      cur = next;
    }
  }
  return cur;
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

// src/raguel-records.ts
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import fs2 from "node:fs";
import os from "node:os";
import path2 from "node:path";
var DEFAULT_CASES_DIR = "~/.raguel";
function isObject(v) {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}
function readJsonObject(file) {
  let parsed;
  try {
    parsed = JSON.parse(fs2.readFileSync(file, "utf8"));
  } catch {
    throw new Error(`Raguel \u306E\u8A2D\u5B9A ${file} \u3092 JSON \u3068\u3057\u3066\u8AAD\u3081\u307E\u305B\u3093`);
  }
  if (!isObject(parsed))
    throw new Error(
      `Raguel \u306E\u8A2D\u5B9A ${file} \u306F JSON \u306E\u30AA\u30D6\u30B8\u30A7\u30AF\u30C8\u306B\u3057\u3066\u304F\u3060\u3055\u3044`
    );
  return parsed;
}
function readStorage(mainRoot) {
  let raguel;
  const env = process.env.RAGUEL_CONFIG;
  if (env) raguel = readJsonObject(env);
  else {
    const file = path2.join(mainRoot, ".codiel", "config.json");
    if (!fs2.existsSync(file)) return {};
    raguel = readJsonObject(file).raguel;
    if (raguel === void 0) return {};
    if (!isObject(raguel))
      throw new Error(`${file} \u306E raguel \u306F JSON \u306E\u30AA\u30D6\u30B8\u30A7\u30AF\u30C8\u306B\u3057\u3066\u304F\u3060\u3055\u3044`);
  }
  const storage = raguel.storage;
  if (storage === void 0) return {};
  if (!isObject(storage))
    throw new Error("raguel.storage \u306F JSON \u306E\u30AA\u30D6\u30B8\u30A7\u30AF\u30C8\u306B\u3057\u3066\u304F\u3060\u3055\u3044");
  const text = (key) => {
    const v = storage[key];
    if (v === void 0) return void 0;
    if (typeof v !== "string")
      throw new Error(`raguel.storage.${key} \u306F\u6587\u5B57\u5217\u306B\u3057\u3066\u304F\u3060\u3055\u3044`);
    return v;
  };
  return { casesDir: text("casesDir"), projectId: text("projectId") };
}
function resolveCasesDir(mainRoot, configured) {
  const dir = configured || DEFAULT_CASES_DIR;
  if (dir === "~") return path2.resolve(os.homedir());
  if (dir.startsWith("~/") || dir.startsWith("~\\"))
    return path2.resolve(os.homedir(), dir.slice(2));
  return path2.resolve(mainRoot, dir);
}
function realpathOrResolve(p) {
  try {
    return fs2.realpathSync(p);
  } catch {
    return path2.resolve(p);
  }
}
function gitCommonDir(dir) {
  try {
    const out = execFileSync(
      "git",
      ["-C", dir, "rev-parse", "--path-format=absolute", "--git-common-dir"],
      { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] }
    ).trim();
    return out ? realpathOrResolve(out) : null;
  } catch {
    return null;
  }
}
function resolveProjectId(projectRoot, storageProjectId) {
  if (storageProjectId) return storageProjectId;
  const common = gitCommonDir(projectRoot);
  const base = common ?? realpathOrResolve(projectRoot);
  let name;
  if (common === null) name = path2.basename(base);
  else if (path2.basename(base) === ".git")
    name = path2.basename(path2.dirname(base));
  else name = path2.basename(base).replace(/\.git$/, "");
  const hash = createHash("sha256").update(base).digest("hex").slice(0, 12);
  return `${name}-${hash}`;
}
function resolveRaguelStore(mainRoot) {
  const storage = readStorage(mainRoot);
  const casesDir = resolveCasesDir(mainRoot, storage.casesDir);
  const projectId = resolveProjectId(mainRoot, storage.projectId);
  return {
    casesDir,
    projectId,
    projectDir: path2.join(casesDir, "cases", projectId)
  };
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
  const st = JSON.parse(fs3.readFileSync(p, "utf8"));
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
  return st;
}
function runDir(root, slug) {
  return path3.join(root, ".codiel", "runs", slug);
}
function tries(dir) {
  if (!fs3.existsSync(dir)) return [];
  return fs3.readdirSync(dir).filter((d) => /^try-\d+$/.test(d)).map((d) => Number(d.slice(4))).sort((a, b) => a - b);
}
function latestTry(root, slug) {
  const dir = runDir(root, slug);
  for (const n of tries(dir).reverse()) {
    const p = path3.join(dir, `try-${n}`, "state.json");
    if (fs3.existsSync(p)) return { tryN: n, statePath: p, state: readState(p) };
  }
  return null;
}
function latestTries(root) {
  const runsRoot = path3.join(root, ".codiel", "runs");
  if (!fs3.existsSync(runsRoot)) return [];
  const found = [];
  for (const d of fs3.readdirSync(runsRoot, { withFileTypes: true })) {
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
        dir: path3.dirname(latest.statePath),
        statePath: latest.statePath,
        state: st
      };
  }
  return best;
}
function isLegacy(st) {
  return st.version !== 2 || !("test-code" in st.phases);
}

// src/hooks/guard-bash.ts
var SEGMENT_SPLIT_RE = /;|&&|&|\|\||\||\n/;
function joinContinuedLines(cmd) {
  return cmd.replace(/(?<!\\)((?:\\\\)*)\\\n/g, "$1");
}
var VALUE_TAKING_OPTS = ["-C", "--git-dir", "--work-tree", "-c"];
function isGitToken(tok) {
  const stripped = tok.replace(/^\(+/, "");
  return stripped === "git" || stripped.endsWith("/git");
}
function gitCommandsByTokens(cmd) {
  return parseCommands(cmd) ?? splitLoosely(cmd);
}
function gitCommandsByLines(cmd) {
  return joinContinuedLines(cmd).split(SEGMENT_SPLIT_RE).map(
    (segment) => segment.split(/\s+/).map((tok) => tok.replace(/^[("'`$]+|["'`)]+$/g, "")).filter(Boolean)
  );
}
function findGitInvocations(commands) {
  const invocations = [];
  for (const tokens of commands) {
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
  return FORCE_TOKENS.includes(tok) || tok.startsWith("--force-with-lease=") || /^-[A-Za-z]*f[A-Za-z]*$/.test(tok) || tok.startsWith("+");
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
var GH_POST_COMMANDS = {
  "issue create": "abFlmpTtR",
  "issue comment": "bFR",
  "issue edit": "bFmtR",
  "pr create": "aBbFHlmprTtR",
  "pr comment": "bFR",
  "pr edit": "BbFmtR",
  "pr review": "bFR",
  api: "FHXfpqt"
};
var FILL_FLAGS = ["--fill", "-f", "--fill-first", "--fill-verbose"];
var TEMPLATE_FLAGS = ["--template", "-T"];
var AUTO_BODY_FLAGS = {
  "pr create": [...FILL_FLAGS, ...TEMPLATE_FLAGS],
  "issue create": TEMPLATE_FLAGS
};
var WEB_FLAGS = ["--web", "-w"];
function hasFlag(tokens, names) {
  return tokens.some(
    (tok) => names.some(
      (n) => tok === n || tok.startsWith(`${n}=`) || /^-[^-]$/.test(n) && tok.startsWith(n) && tok.length > 2
    )
  );
}
var GH_VALUE_OPTS = ["-R", "--repo"];
var HEREDOC_RE = /^<<(-?)[ \t]*(?:'([^'\n]+)'|"([^"\n\\$`]+)"|(\\?)([A-Za-z_]\w*))(?=[\s;&|)<>]|$)/;
var SHELLS = ["bash", "sh", "zsh", "dash", "ksh"];
function parseCommands(text) {
  const commands = [];
  const pending = [];
  let i = 0;
  let inArith = false;
  let unclosed = false;
  const readSubst = () => {
    const start = i;
    const backquote = text[i] === "`";
    const outer = inArith;
    inArith = text.startsWith("$((", i);
    i += backquote ? 1 : 2;
    parseList(backquote ? "`" : ")");
    inArith = outer;
    return text.slice(start, i);
  };
  const readDouble = () => {
    let out = "";
    i++;
    while (i < text.length && text[i] !== '"') {
      const c = text[i];
      if (c === "\\") {
        const next = text[i + 1] ?? "";
        if (next !== "\n") out += '$`"\\'.includes(next) ? next : c + next;
        i += 2;
      } else if (c === "`" || text.startsWith("$(", i)) out += readSubst();
      else {
        out += c;
        i++;
      }
    }
    if (i >= text.length) unclosed = true;
    i++;
    return out;
  };
  const readWord = (close) => {
    let out = "";
    while (i < text.length) {
      const c = text[i];
      if (" 	\n;&|()".includes(c) || c === "`" && close === "`") break;
      if (c === "\\") {
        if (text[i + 1] !== "\n") out += text[i + 1] ?? "";
        i += 2;
      } else if (c === "'" || text.startsWith("$'", i)) {
        const from = c === "'" ? i + 1 : i + 2;
        let end = from;
        while (end < text.length && text[end] !== "'")
          end += c === "$" && text[end] === "\\" ? 2 : 1;
        if (end >= text.length) unclosed = true;
        out += text.slice(from, end);
        i = end + 1;
      } else if (c === '"') out += readDouble();
      else if (c === "`" || text.startsWith("$(", i)) out += readSubst();
      else {
        const m = c === "<" && !inArith && !/[\d)<]/.test(text[i - 1] ?? "") ? text.slice(i).match(HEREDOC_RE) : null;
        if (m)
          pending.push({
            word: m[2] ?? m[3] ?? m[5],
            dash: m[1] === "-",
            quoted: m[5] === void 0 || m[4] === "\\"
          });
        const s = m ? m[0] : c;
        out += s;
        i += s.length;
      }
    }
    return out;
  };
  const skipHeredocBodies = () => {
    for (const { word, dash, quoted } of pending.splice(0)) {
      const lines = text.slice(i).split("\n");
      const k = lines.findIndex(
        (l) => (dash ? l.replace(/^\t+/, "") : l) === word
      );
      if (k === -1) return;
      let bodyEnd = i;
      for (const l of lines.slice(0, k)) bodyEnd += l.length + 1;
      while (!quoted && i < bodyEnd) {
        if (text[i] === "\\") i += 2;
        else if (text[i] === "`" || text.startsWith("$(", i)) readSubst();
        else i++;
      }
      i = Math.max(i, bodyEnd + lines[k].length + 1);
    }
  };
  const parseList = (close) => {
    let words = [];
    let depth = 0;
    let closed = false;
    const flush = () => {
      if (words.length > 0) commands.push(words);
      words = [];
    };
    while (i < text.length) {
      const c = text[i];
      if (c === close && (close === "`" || depth === 0)) {
        closed = true;
        i++;
        break;
      }
      if (c === "\\" && text[i + 1] === "\n") i += 2;
      else if (c === " " || c === "	") i++;
      else if (";&|()\n".includes(c)) {
        flush();
        if (c === "(") depth++;
        if (c === ")") depth--;
        i++;
        if (c === "\n") skipHeredocBodies();
      } else if (c === "#") {
        const eol = text.indexOf("\n", i);
        i = eol === -1 ? text.length : eol;
      } else words.push(readWord(close));
    }
    flush();
    if (close !== void 0 && !closed) unclosed = true;
  };
  parseList();
  if (unclosed) return void 0;
  for (const words of [...commands]) {
    const shellAt = words.findIndex((w) => SHELLS.includes(path4.basename(w)));
    for (let k = 1; k < words.length; k++) {
      const prev = words[k - 1];
      if (prev !== "eval" && !(shellAt !== -1 && shellAt < k - 1 && /^-\w*c$/.test(prev)))
        continue;
      const inner = parseCommands(words[k]);
      if (inner === void 0) return void 0;
      commands.push(...inner);
    }
  }
  return commands;
}
function splitLoosely(cmd) {
  const commands = [];
  for (const segment of joinContinuedLines(cmd).split(SEGMENT_SPLIT_RE)) {
    let words = [];
    for (const tok of segment.split(/\s+/)) {
      const bare = tok.replace(/^[("'`$]+|["'`)]+$/g, "");
      const ghWord = bare.replace(/^[A-Za-z_]\w*\+?=[("'`$]*/, "");
      if (ghWord === "gh" || ghWord.endsWith("/gh")) {
        commands.push(words);
        words = [ghWord];
        continue;
      }
      if (bare !== "") words.push(bare);
    }
    commands.push(words);
  }
  return commands;
}
function expandShortFlags(tokens, valueShorts) {
  return tokens.flatMap((tok) => {
    if (!/^-[A-Za-z]./.test(tok)) return [tok];
    const out = [];
    for (let i = 1; i < tok.length; i++) {
      if (!/[A-Za-z]/.test(tok[i])) {
        out[out.length - 1] += tok.slice(i);
        break;
      }
      if (valueShorts.includes(tok[i])) {
        out.push(`-${tok.slice(i)}`);
        break;
      }
      out.push(`-${tok[i]}`);
    }
    return out;
  });
}
function findGhInvocations(cmd) {
  const invocations = [];
  for (const words of parseCommands(cmd) ?? splitLoosely(cmd)) {
    const start = words.findIndex((w) => w === "gh" || w.endsWith("/gh"));
    if (start === -1) continue;
    const tokens = words.slice(start);
    const skipOptions = (from) => {
      let idx = from;
      while (idx < tokens.length && tokens[idx].startsWith("-"))
        idx += GH_VALUE_OPTS.includes(tokens[idx]) ? 2 : 1;
      return idx;
    };
    const objIdx = skipOptions(1);
    const object = tokens[objIdx];
    const command = object === "api" ? "api" : `${object} ${tokens[skipOptions(objIdx + 1)]}`;
    const valueShorts = GH_POST_COMMANDS[command];
    if (valueShorts !== void 0)
      invocations.push({
        command,
        tokens: expandShortFlags(tokens, valueShorts)
      });
  }
  return invocations;
}
function flagAt(tokens, i, names) {
  const tok = tokens[i];
  for (const n of names) {
    if (tok === n) return tokens[i + 1] ?? "";
    if (tok.startsWith(`${n}=`)) return tok.slice(n.length + 1);
    if (/^-[^-]$/.test(n) && tok.startsWith(n) && tok.length > 2)
      return tok.slice(2);
  }
  return void 0;
}
function flagValues(tokens, names) {
  const values = [];
  for (let i = 0; i < tokens.length; i++) {
    const value = flagAt(tokens, i, names);
    if (value === void 0) continue;
    values.push(value);
    if (names.includes(tokens[i])) i++;
  }
  return values;
}
function readBodyFile(flag, file, cwd) {
  if (file === "-")
    emit(
      "deny",
      `${flag} \u306B - (\u6A19\u6E96\u5165\u529B)\u306F\u6307\u5B9A\u3067\u304D\u307E\u305B\u3093\u3002\u672C\u6587\u3092\u30D5\u30A1\u30A4\u30EB\u306B\u66F8\u304D\u3001\u30D1\u30B9\u3067\u6E21\u3057\u76F4\u3057\u3066\u304F\u3060\u3055\u3044`
    );
  try {
    return fs4.readFileSync(path4.resolve(cwd, file), "utf8");
  } catch {
    return emit("deny", `${flag} \u306E\u30D5\u30A1\u30A4\u30EB\u3092\u8AAD\u307F\u8FBC\u3081\u307E\u305B\u3093: ${file}`);
  }
}
function denyMissingMarker(command, rawFileRef = false) {
  const hint = rawFileRef ? "\u3002`-f` \u306F\u5024\u3092\u305D\u306E\u307E\u307E\u9001\u308A\u307E\u3059\u3002\u30D5\u30A1\u30A4\u30EB\u306E\u4E2D\u8EAB\u3092\u672C\u6587\u306B\u3059\u308B\u306B\u306F `-F body=@<\u30D1\u30B9>` \u3092\u4F7F\u3063\u3066\u304F\u3060\u3055\u3044" : "";
  return emit(
    "deny",
    `gh ${command} \u306E\u672C\u6587\u306B \`${GENERATED_MARKER}\` \u3092\u542B\u3081\u3066\u6295\u7A3F\u3057\u76F4\u3057\u3066\u304F\u3060\u3055\u3044${hint}`
  );
}
function readGhPost({ command, tokens }) {
  if ((command === "pr create" || command === "issue create") && hasFlag(tokens, WEB_FLAGS))
    emit(
      "deny",
      `gh ${command} \u306E --web / -w \u306F\u4F7F\u3048\u307E\u305B\u3093\u3002Web \u306E\u4F5C\u6210\u753B\u9762\u3067\u306E\u6295\u7A3F\u306F\u672C\u6587\u3092\u691C\u67FB\u3067\u304D\u306A\u3044\u305F\u3081\u3067\u3059\u3002\u30DE\u30FC\u30AB\u30FC\u4ED8\u304D\u306E\u672C\u6587\u3092 --body-file \u3067\u6E21\u3057\u3066\u4F5C\u308A\u76F4\u3057\u3066\u304F\u3060\u3055\u3044`
    );
  const inline = flagValues(tokens, ["--body", "-b"]);
  const files = flagValues(tokens, ["--body-file", "-F"]).map((p) => ({
    flag: "--body-file",
    path: p
  }));
  if (inline.length === 0 && files.length === 0) {
    const autoFlags = AUTO_BODY_FLAGS[command];
    if (autoFlags && hasFlag(tokens, autoFlags))
      emit(
        "deny",
        `gh ${command} \u306E --fill \u7CFB\u30FB--template/-T \u306F\u672C\u6587\u3092\u691C\u67FB\u3067\u304D\u307E\u305B\u3093\u3002\u30DE\u30FC\u30AB\u30FC\u4ED8\u304D\u306E\u672C\u6587\u3092 --body-file \u3067\u6E21\u3057\u3066\u4F5C\u308A\u76F4\u3057\u3066\u304F\u3060\u3055\u3044`
      );
    return void 0;
  }
  return { command, inline, files };
}
function readGhApiPost(tokens) {
  const fields = [
    ...flagValues(tokens, ["--raw-field", "-f"]).map((value) => ({
      typed: false,
      value
    })),
    ...flagValues(tokens, ["--field", "-F"]).map((value) => ({
      typed: true,
      value
    }))
  ];
  const inputs = flagValues(tokens, ["--input"]);
  const explicitMethod = flagValues(tokens, ["--method", "-X"]).at(-1);
  const method = explicitMethod !== void 0 ? explicitMethod.toUpperCase() : fields.length > 0 || inputs.length > 0 ? "POST" : "GET";
  if (!["POST", "PATCH", "PUT"].includes(method)) return void 0;
  const post = { command: "api", inline: [], files: [] };
  for (const { typed, value } of fields) {
    const eq = value.indexOf("=");
    const key = eq === -1 ? value : value.slice(0, eq);
    if (key !== "body" && !key.endsWith("[body]")) continue;
    const val = value.slice(eq + 1);
    if (typed && val.startsWith("@"))
      post.files.push({ flag: "-F", path: val.slice(1) });
    else post.inline.push(val);
  }
  for (const input of inputs) post.files.push({ flag: "--input", path: input });
  return post.inline.length > 0 || post.files.length > 0 ? post : void 0;
}
function denyRewrittenBodyFile(posts, text) {
  const paths = posts.flatMap((p) => p.files.map((f) => f.path)).filter((p) => p !== "" && p !== "-");
  for (const p of new Set(paths))
    if (text.split(p).length - 1 > paths.filter((x) => x === p).length)
      emit(
        "deny",
        `\u672C\u6587\u30D5\u30A1\u30A4\u30EB ${p} \u306E\u30D1\u30B9\u304C\u3001\u540C\u3058\u30B3\u30DE\u30F3\u30C9\u306E\u4E2D\u3067\u672C\u6587\u306E\u30D5\u30E9\u30B0\u306E\u5024\u4EE5\u5916\u306B\u3082\u73FE\u308C\u307E\u3059\u3002\u30D5\u30C3\u30AF\u306F\u5B9F\u884C\u524D\u306E\u30D5\u30A1\u30A4\u30EB\u3092\u691C\u67FB\u3059\u308B\u306E\u3067\u3001\u672C\u6587\u306F Write \u30C4\u30FC\u30EB\u3067\u5225\u540D\u306E\u30D5\u30A1\u30A4\u30EB\u306B\u66F8\u304D\u3001\u5225\u306E Bash \u547C\u3073\u51FA\u3057\u3067 --body-file \u3067\u6E21\u3057\u3066\u304F\u3060\u3055\u3044`
      );
}
function checkGeneratedMarker(invocations, cmd, cwd) {
  const posts = [];
  for (const inv of invocations) {
    const post = inv.command === "api" ? readGhApiPost(inv.tokens) : readGhPost(inv);
    if (post) posts.push(post);
  }
  if (posts.length >= 2 && posts.some((p) => p.inline.length > 0))
    emit(
      "deny",
      "1 \u3064\u306E\u30B3\u30DE\u30F3\u30C9\u306B\u672C\u6587\u4ED8\u304D\u306E\u6295\u7A3F\u304C\u8907\u6570\u3042\u308A\u3001\u672C\u6587\u3092\u5F15\u6570\u3067\u6E21\u3059\u3082\u306E\u304C\u3042\u308A\u307E\u3059\u3002\u30DE\u30FC\u30AB\u30FC\u306F\u30B3\u30DE\u30F3\u30C9\u5168\u4F53\u3067\u63A2\u3059\u306E\u3067\u3001\u6295\u7A3F\u306F 1 \u56DE\u306E Bash \u547C\u3073\u51FA\u3057\u306B 1 \u3064\u306B\u3057\u3066\u304F\u3060\u3055\u3044\u3002\u672C\u6587\u306F Write \u30C4\u30FC\u30EB\u3067\u66F8\u3044\u305F\u30D5\u30A1\u30A4\u30EB\u3092 --body-file(gh api \u3067\u306F -F body=@<\u30D1\u30B9>)\u3067\u6E21\u3057\u3066\u304F\u3060\u3055\u3044"
    );
  denyRewrittenBodyFile(posts, joinContinuedLines(cmd));
  for (const { command, inline, files } of posts) {
    const missing = inline.length + files.length >= 2 ? inline.some((body) => !body.includes(GENERATED_MARKER)) : inline.length === 1 && !cmd.includes(GENERATED_MARKER);
    if (missing)
      denyMissingMarker(
        command,
        command === "api" && inline.some((body) => body.startsWith("@"))
      );
    for (const { flag, path: file } of files) {
      const content = readBodyFile(flag, file, cwd);
      const needsMarker = flag !== "--input" || /"body"\s*:/.test(content);
      if (needsMarker && !content.includes(GENERATED_MARKER))
        denyMissingMarker(command);
    }
  }
}
function redirectsTo(commands, ci, hit) {
  const words = commands[ci];
  for (let wi = 0; wi < words.length; wi++) {
    const w = words[wi];
    for (let p = w.indexOf(">"); p !== -1; ) {
      const from = p + (w[p + 1] === ">" ? 2 : 1);
      const dest = w.slice(from).split(/[<>]/)[0];
      const target = dest !== "" ? dest : wi + 1 < words.length ? words[wi + 1] : commands[ci + 1]?.[0];
      if (hit(target)) return true;
      p = w.indexOf(">", from);
    }
  }
  return false;
}
function teeOrSedWrites(words, hit) {
  const args = [];
  for (let k = 0; k < words.length; k++) {
    const op = words[k].search(/[<>]/);
    if (op === -1) args.push(words[k]);
    else if (op > 0) args.push(words[k].slice(0, op));
    else if (/^[<>]+$/.test(words[k])) k++;
  }
  const after = (name) => {
    const at = args.findIndex((a) => path4.basename(a) === name);
    return at === -1 ? [] : args.slice(at + 1);
  };
  const sedArgs = after("sed");
  return after("tee").some(hit) || sedArgs.some((a) => /^(-[A-Za-z]*i|--in-place)/.test(a)) && sedArgs.some(hit);
}
var STATE_JSON_RE = /\.codiel\/runs\/\S*state\.json/;
var STATE_FILE_COMMANDS = ["rm", "mv", "cp", "ln", "install", "dd"];
var MAX_CWD_CANDIDATES = 64;
function cdTargets(commands) {
  return commands.flatMap((words) => {
    if (!["cd", "pushd"].includes(words[0])) return [];
    const dir = words.slice(1).find((w) => !w.startsWith("-"));
    return dir === void 0 ? [] : [dir];
  });
}
function cwdCandidatesOf(commands, cwd) {
  const out = /* @__PURE__ */ new Set([cwd]);
  for (const dir of cdTargets(commands)) {
    for (const c of [...out]) {
      out.add(path4.resolve(c, expandHome(dir)));
      if (out.size > MAX_CWD_CANDIDATES) return null;
    }
  }
  return [...out];
}
function cwdCandidates(tokenCommands, lineCommands, cwd) {
  const a = cwdCandidatesOf(tokenCommands, cwd);
  const b = cwdCandidatesOf(lineCommands, cwd);
  return a && b ? [.../* @__PURE__ */ new Set([...a, ...b])] : null;
}
function stateJsonProblem(cmd, cwd) {
  const tokenCommands = (parseCommands(cmd) ?? splitLoosely(cmd)).map(
    withoutMessageValues
  );
  const lineCommands = gitCommandsByLines(withoutInertBodies(cmd));
  const root = findMainRoot(cwd);
  const runsDirs = [
    path4.join(root, ".codiel", "runs"),
    resolvePhysicalPath(root, path4.join(".codiel", "runs"))
  ];
  const underRuns = (p) => runsDirs.some((d) => isUnder(p, d));
  const cwds = cwdCandidates(tokenCommands, lineCommands, cwd);
  if (cwds === null) return "cd \u304C\u591A\u3059\u304E\u3066\u66F8\u304D\u8FBC\u307F\u5148\u3092\u5224\u5B9A\u3067\u304D\u306A\u3044";
  const resolved = (word) => cwds.flatMap((c) => {
    const lexical = path4.resolve(c, expandHome(word));
    return [
      lexical,
      resolvePhysicalPath(c, expandHome(word)),
      resolvePhysicalPath(c, lexical)
    ];
  });
  const isStateFile = (word) => word !== void 0 && word !== "" && (STATE_JSON_RE.test(word) || resolved(word).some(
    (p) => path4.basename(p) === "state.json" && underRuns(p)
  ));
  const holdsState = (word) => resolved(word).some(
    (p) => runsDirs.some((d) => isUnder(d, p)) || underRuns(p) && !isRegularFile(p)
  );
  const touchesRuns = (word) => resolved(word).some(
    (p) => underRuns(p) || runsDirs.some((d) => isUnder(d, p))
  );
  const fileOpWrites = (words, at) => {
    if (at < 0 || at >= words.length) return false;
    const name = path4.basename(words[at]);
    if (!STATE_FILE_COMMANDS.includes(name)) return false;
    const args = words.slice(at + 1).flatMap(
      (a) => name === "dd" ? a.startsWith("of=") ? [a.slice(3)] : [] : a.startsWith("-") || a === "" ? [] : [a]
    );
    if (args.some(isStateFile)) return true;
    if (name === "ln" && args.some(touchesRuns)) return true;
    const sources = name === "rm" ? args : args.slice(0, -1);
    if ((name === "rm" || name === "mv") && sources.some(holdsState))
      return true;
    const dest = args.at(-1);
    return name !== "rm" && name !== "dd" && dest !== void 0 && sources.some((a) => path4.basename(a) === "state.json") && resolved(dest).some(underRuns);
  };
  const byTokens = tokenCommands.some(
    (words, ci) => redirectsTo(tokenCommands, ci, isStateFile) || teeOrSedWrites(words, isStateFile) || fileOpWrites(
      words,
      words.findIndex((w) => STATE_FILE_COMMANDS.includes(path4.basename(w)))
    )
  );
  const byLines = lineCommands.some(
    (words, ci) => redirectsTo(lineCommands, ci, isStateFile) || teeOrSedWrites(words, isStateFile) || words.some(
      (_, k) => (k === 0 || words[k - 1] === "<<<" || /^-\w*c$/.test(words[k - 1]) && words.slice(0, k - 1).some((w) => SHELLS.includes(path4.basename(w)))) && fileOpWrites(words, k)
    )
  );
  return byTokens || byLines ? "state.json \u3078\u306E\u30B7\u30A7\u30EB\u7D4C\u7531\u306E\u66F8\u304D\u8FBC\u307F\u304B\u524A\u9664" : void 0;
}
var ANY_HEREDOC_RE = /(?<!<)<<(?!<)(-?)[ \t]*(?:'([^'\n]+)'|"([^"\n]+)"|\\?([A-Za-z_]\w*))/g;
function isInertHeredoc(line, before, after, next) {
  if (/[;&|]/.test(line) || [...line.matchAll(ANY_HEREDOC_RE)].length !== 1)
    return false;
  const B = "(?:^|\\s)";
  if (new RegExp(
    `${B}git\\s+(?:\\S+\\s+)*?commit\\b.*\\s(?:-F|--file)(?:\\s+|=)(?:-|/dev/stdin)(?=\\s|$)`
  ).test(line))
    return true;
  if (new RegExp(
    `${B}(?:git\\s+(?:\\S+\\s+)*?(?:commit|tag)|gh\\s+\\S+\\s+\\S+)\\b.*\\s(?:-m|--message|--body)(?:\\s+|=)"?\\$\\(\\s*cat\\s+$`
  ).test(before))
    return after.trim() === "" && /^\s*\)"?\s*$/.test(next ?? "");
  return false;
}
function withoutMessageValues(words) {
  const at = words.findIndex(
    (w, k) => w === "git" && ["commit", "tag"].includes(words[k + 1] ?? "") || w === "gh"
  );
  if (at === -1) return words;
  return words.filter((w, k) => {
    if (k <= at || !w.includes("\n")) return true;
    const prev = words[k - 1];
    const inline = /^(?:--message|--body)=/.test(w) || /^-m./.test(w);
    return !(["-m", "--message", "--body"].includes(prev) || inline);
  });
}
function withoutInertBodies(cmd) {
  const lines = cmd.split("\n");
  for (let i = 0; i < lines.length; i++) {
    const ms = [...lines[i].matchAll(ANY_HEREDOC_RE)];
    if (ms.length === 0) continue;
    let k = i;
    for (const m2 of ms) {
      const word = m2[2] ?? m2[3] ?? m2[4];
      const from = k;
      k = lines.findIndex(
        (l, j) => j > from && (m2[1] === "-" ? l.replace(/^\t+/, "") : l) === word
      );
      if (k === -1) return lines.join("\n");
    }
    const m = ms[0];
    const at = m.index ?? 0;
    if (ms.length === 1 && isInertHeredoc(
      lines[i],
      lines[i].slice(0, at),
      lines[i].slice(at + m[0].length),
      lines[k + 1]
    ))
      for (let j = i + 1; j < k; j++) lines[j] = "";
    i = k;
  }
  return lines.join("\n");
}
function isRegularFile(p) {
  try {
    return fs4.statSync(p).isFile();
  } catch {
    return false;
  }
}
var FILE_COMMANDS = ["cp", "mv", "rm", "dd", "install"];
var CODIEL_CONFIG_RE = /[/\\]\.codiel[/\\]config\.json$/i;
function isUnder(p, dir) {
  const rel = path4.relative(dir, p);
  return rel === "" || rel !== ".." && !rel.startsWith(`..${path4.sep}`) && !path4.isAbsolute(rel);
}
function raguelTargets(root) {
  const files = [path4.join(root, ".codiel", "config.json")];
  const env = process.env.RAGUEL_CONFIG;
  if (env) files.push(path4.resolve(env));
  let casesDir = null;
  try {
    casesDir = resolveRaguelStore(root).casesDir;
  } catch {
  }
  return { files, casesDir };
}
function expandHome(word) {
  return word.replace(/^(~|\$HOME|\$\{HOME\})(?=\/|$)/, os2.homedir());
}
function wordPath(word, cwd) {
  return path4.resolve(cwd, expandHome(word));
}
function writesRaguelFiles(cmd, cwd, t) {
  const isTarget = (abs) => CODIEL_CONFIG_RE.test(abs) || t.files.includes(abs) || t.casesDir !== null && isUnder(abs, t.casesDir);
  const contains = (abs) => t.files.some((f) => isUnder(f, abs)) || t.casesDir !== null && isUnder(t.casesDir, abs);
  const isParent = (abs, args) => t.files.some(
    (f) => path4.dirname(f) === abs && args.some((a) => path4.basename(a) === path4.basename(f))
  );
  let found;
  const hit = (word) => {
    if (word === void 0 || word === "") return false;
    if (!isTarget(wordPath(word, cwd))) return false;
    found = word;
    return true;
  };
  const commands = parseCommands(cmd) ?? splitLoosely(cmd);
  for (let ci = 0; ci < commands.length; ci++) {
    const words = commands[ci];
    if (redirectsTo(commands, ci, hit) || teeOrSedWrites(words, hit))
      return found;
    const at = words.findIndex((w) => FILE_COMMANDS.includes(path4.basename(w)));
    if (at === -1) continue;
    const name = path4.basename(words[at]);
    const args = [];
    for (const a of words.slice(at + 1)) {
      if (name === "dd") {
        if (a.startsWith("of=")) args.push(a.slice(3));
      } else if (a.startsWith("--target-directory="))
        args.push(a.slice("--target-directory=".length));
      else if (!a.startsWith("-") && a !== "") args.push(a);
    }
    for (const [k, a] of args.entries()) {
      const abs = wordPath(a, cwd);
      const moved = name === "rm" || name === "mv" && k < args.length - 1;
      if (isTarget(abs) || moved && contains(abs) || name !== "rm" && name !== "dd" && isParent(abs, args))
        return a;
    }
  }
  return void 0;
}
try {
  const input = await readStdin();
  const cmd = input.tool_input?.command ?? "";
  const pushCandidates = [
    ...findGitInvocations(gitCommandsByTokens(cmd)),
    ...findGitInvocations(gitCommandsByLines(cmd))
  ];
  const isGitPush = pushCandidates.some((inv) => inv.subcommand === "push");
  const cwd = input.cwd ?? process.cwd();
  const stateProblem = stateJsonProblem(cmd, cwd);
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
    [hasForcePush(pushCandidates), "force push"],
    [
      pushesToProtectedBranch(pushCandidates),
      "\u4FDD\u8B77\u30D6\u30E9\u30F3\u30C1(main/master)\u3078\u306E push"
    ],
    [stateProblem !== void 0, stateProblem ?? ""]
  ];
  for (const [triggered, why] of ALWAYS_DENY)
    if (triggered) emit("deny", `\u7981\u6B62\u30B3\u30DE\u30F3\u30C9: ${why}`);
  const root = findMainRoot(cwd);
  const run = findActiveRun(root);
  if (run) {
    const raguelWord = writesRaguelFiles(cmd, cwd, raguelTargets(root));
    if (raguelWord !== void 0)
      emit(
        "deny",
        `run \u306E\u9593(active\u30FBawaiting_human)\u306F Raguel \u306E\u8A2D\u5B9A\u3068\u8A18\u9332(${raguelWord})\u3092\u30B7\u30A7\u30EB\u3067\u66F8\u304D\u63DB\u3048\u3089\u308C\u307E\u305B\u3093\u3002\u30B2\u30FC\u30C8\u306E\u507D\u88C5\u3092\u9632\u3050\u305F\u3081\u3067\u3059\u3002\u5909\u66F4\u3059\u308B\u3068\u304D\u306F run \u3092\u6B62\u3081\u308B\u304B\u3001\u5229\u7528\u8005\u304C\u81EA\u5206\u3067\u5909\u66F4\u3057\u3066\u304F\u3060\u3055\u3044`
      );
    const phase = run.state.phase;
    const testLoopPassed = run.state.phases["test-loop"]?.status === "passed";
    const ghInvocations = findGhInvocations(cmd);
    const invokes = (command) => ghInvocations.some((inv) => inv.command === command);
    for (const [command, kind] of [
      ["issue create", "issue"],
      ["pr create", "pr"]
    ]) {
      const problem = invokes(command) && ghPostPhaseProblem(kind, run.state);
      if (problem) emit("deny", problem);
    }
    if (isGitPush && (!["pr", "fix-loop", "triage", "finalize"].includes(phase) || !testLoopPassed))
      emit(
        "deny",
        `push \u306F pr\u30FBfix-loop\u30FBtriage\u30FBfinalize \u306E\u30D5\u30A7\u30FC\u30BA\u3067\u3001test-loop \u306E\u5408\u683C\u306E\u5F8C\u306B\u3060\u3051\u5B9F\u884C\u3067\u304D\u307E\u3059(\u73FE\u5728: ${phase})`
      );
    checkGeneratedMarker(ghInvocations, cmd, cwd);
  }
  pass();
} catch (e) {
  emit(
    "ask",
    `guard-bash \u306E\u5185\u90E8\u30A8\u30E9\u30FC(\u30D5\u30A7\u30A4\u30EB\u30AF\u30ED\u30FC\u30BA\u30C9): ${e.message}`
  );
}
