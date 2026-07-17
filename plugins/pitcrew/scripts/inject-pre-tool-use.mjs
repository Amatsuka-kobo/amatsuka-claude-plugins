#!/usr/bin/env node

// src/hooks/inject-pre-tool-use.ts
import path5 from "node:path";

// src/lib/comments.ts
import fs from "node:fs";
import path2 from "node:path";

// src/lib/frontmatter.ts
function unquote(v) {
  if (v.startsWith('"') && v.endsWith('"') && v.length >= 2) {
    try {
      return JSON.parse(v);
    } catch {
      return v.slice(1, -1);
    }
  }
  return v;
}
function parseFrontmatter(text) {
  const m = text.match(/^---\n([\s\S]*?)\n---\n?/);
  if (!m) return { data: {}, body: text };
  const data = {};
  for (const line of m[1].split("\n")) {
    const kv = line.match(/^([A-Za-z][\w-]*):\s*(.*)$/);
    if (!kv) continue;
    const [, key, raw] = kv;
    const value = raw.trimEnd();
    if (value.startsWith("[") && value.endsWith("]")) {
      const inner = value.slice(1, -1).trim();
      data[key] = inner === "" ? [] : inner.split(",").map((s) => unquote(s.trim()));
    } else {
      data[key] = unquote(value);
    }
  }
  return { data, body: text.slice(m[0].length) };
}

// src/lib/run.ts
import path from "node:path";
function pitcrewDir(projectDir2) {
  return path.join(projectDir2, ".pitcrew");
}

// src/lib/comments.ts
function commentsDir(projectDir2) {
  return path2.join(pitcrewDir(projectDir2), "comments");
}
function processedDir(projectDir2) {
  return path2.join(commentsDir(projectDir2), "processed");
}
function asPaths(value) {
  if (Array.isArray(value)) return value;
  if (typeof value === "string" && value !== "") return [value];
  return [];
}
function asString(value) {
  return typeof value === "string" && value !== "" ? value : null;
}
function listComments(projectDir2) {
  const dir = commentsDir(projectDir2);
  let names;
  try {
    names = fs.readdirSync(dir);
  } catch {
    return [];
  }
  const comments = [];
  for (const name of names.sort()) {
    if (!name.endsWith(".md")) continue;
    const file = path2.join(dir, name);
    let raw;
    try {
      if (!fs.statSync(file).isFile()) continue;
      raw = fs.readFileSync(file, "utf8");
    } catch {
      continue;
    }
    const { data, body } = parseFrontmatter(raw);
    comments.push({
      name,
      file,
      urgency: data.urgency === "urgent" ? "urgent" : "normal",
      paths: asPaths(data.paths),
      reviewId: asString(data.reviewId),
      base: asString(data.base),
      body: body.trim()
    });
  }
  return comments;
}
function pathMatchesComment(commentPath, targetRel) {
  const cp = commentPath.replaceAll("\\", "/").replace(/\/+$/, "");
  if (cp === "") return false;
  const target = targetRel.replaceAll("\\", "/");
  return target === cp || target.startsWith(`${cp}/`);
}
function claimComment(projectDir2, name) {
  try {
    fs.mkdirSync(processedDir(projectDir2), { recursive: true });
    fs.renameSync(
      path2.join(commentsDir(projectDir2), name),
      path2.join(processedDir(projectDir2), name)
    );
    return true;
  } catch {
    return false;
  }
}
function renderInjection(comments, maxChars) {
  const head = `[pitcrew] \u4EBA\u9593\u30EC\u30D3\u30E5\u30A2\u30FC\u304B\u3089\u306E\u30B3\u30E1\u30F3\u30C8(${comments.length} \u4EF6)\u3002\u5185\u5BB9\u3092\u78BA\u8A8D\u3057\u3001\u4F5C\u696D\u306B\u53CD\u6620\u3057\u3066\u304F\u3060\u3055\u3044\u3002base \u306F\u30B3\u30E1\u30F3\u30C8\u6642\u70B9\u306E commit \u3092\u6307\u3059\u305F\u3081\u3001\u5BFE\u8C61\u7B87\u6240\u304C\u65E2\u306B\u5909\u308F\u3063\u3066\u3044\u308B\u5834\u5408\u306F\u73FE\u72B6\u3068\u7167\u5408\u3057\u3066\u81EA\u5206\u3067\u5224\u65AD\u3057\u3066\u304F\u3060\u3055\u3044\u3002`;
  const sections = comments.map((c) => {
    const meta = [
      `urgency: ${c.urgency}`,
      c.paths.length > 0 ? `paths: ${c.paths.join(", ")}` : null,
      c.base ? `base: ${c.base}` : null,
      c.reviewId ? `reviewId: ${c.reviewId}` : null
    ].filter((part) => part !== null).join(" / ");
    return `## ${c.name}(${meta})

${c.body}`;
  });
  const text = [head, ...sections].join("\n\n");
  if (text.length <= maxChars) return text;
  const note = `

> (\u4E0A\u9650\u306B\u3088\u308A\u5207\u308A\u8A70\u3081\u3002\u5168\u6587: .pitcrew/comments/processed/ \u914D\u4E0B\u306E ${comments.map((c) => c.name).join(", ")})`;
  return (text.slice(0, Math.max(0, maxChars - note.length)) + note).slice(
    0,
    maxChars
  );
}

// src/lib/config.ts
import fs2 from "node:fs";
import path3 from "node:path";
var DEFAULT_ARTIFACT_GLOBS = ["docs/**/*.md"];
var DEFAULT_PORT = 7373;
function defaults() {
  return {
    viewer: "files",
    captureTargets: { diff: true, artifact: true, test: true },
    artifactGlobs: [...DEFAULT_ARTIFACT_GLOBS],
    testCommands: [],
    injectionTiming: "hybrid",
    theme: "device",
    port: DEFAULT_PORT
  };
}
function configPath(projectDir2) {
  return path3.join(projectDir2, ".claude", "pitcrew.local.md");
}
function oneOf(value, allowed) {
  return typeof value === "string" && allowed.includes(value) ? value : null;
}
function asArray(value) {
  return Array.isArray(value) ? value.filter((v) => v !== "") : null;
}
function loadConfig(projectDir2) {
  const cfg = defaults();
  let raw;
  try {
    raw = fs2.readFileSync(configPath(projectDir2), "utf8");
  } catch {
    return cfg;
  }
  const { data } = parseFrontmatter(raw);
  const viewer = oneOf(data.viewer, ["browser", "tui", "files"]);
  if (viewer) cfg.viewer = viewer;
  const targets = asArray(data.capture_targets);
  if (targets)
    cfg.captureTargets = {
      diff: targets.includes("diff"),
      artifact: targets.includes("artifact"),
      test: targets.includes("test")
    };
  const globs = asArray(data.artifact_globs);
  if (globs && globs.length > 0) cfg.artifactGlobs = globs;
  const commands = asArray(data.test_commands);
  if (commands) cfg.testCommands = commands;
  const timing = oneOf(data.injection_timing, [
    "hybrid",
    "turn-boundary",
    "immediate"
  ]);
  if (timing) cfg.injectionTiming = timing;
  const theme = oneOf(data.theme, ["device", "light", "dark"]);
  if (theme) cfg.theme = theme;
  if (typeof data.port === "string" && /^\d+$/.test(data.port)) {
    const port = Number(data.port);
    if (port >= 1 && port <= 65535) cfg.port = port;
  }
  return cfg;
}

// src/lib/hook-io.ts
import fs3 from "node:fs";
import path4 from "node:path";
function readStdinSync() {
  try {
    return JSON.parse(fs3.readFileSync(0, "utf8"));
  } catch {
    return null;
  }
}
function resolveProjectDir(input2) {
  return process.env.CLAUDE_PROJECT_DIR || input2.cwd || process.cwd();
}
function logError(projectDir2, context, err) {
  try {
    const logDir = path4.join(pitcrewDir(projectDir2), "log");
    fs3.mkdirSync(logDir, { recursive: true });
    const message = err instanceof Error ? err.stack ?? err.message : String(err);
    fs3.appendFileSync(
      path4.join(logDir, "errors.log"),
      `${(/* @__PURE__ */ new Date()).toISOString()} [${context}] ${message}
`
    );
  } catch {
  }
}

// src/hooks/inject-pre-tool-use.ts
var MAX_INJECT_CHARS = 9e3;
var input = readStdinSync();
if (!input) process.exit(0);
var projectDir = resolveProjectDir(input);
try {
  const timing = loadConfig(projectDir).injectionTiming;
  const filePath = input.tool_name === "Write" || input.tool_name === "Edit" ? input.tool_input?.file_path : void 0;
  if (timing !== "turn-boundary" && typeof filePath === "string") {
    const rel = path5.relative(projectDir, filePath).replaceAll("\\", "/");
    if (!rel.startsWith("..") && !path5.isAbsolute(rel)) {
      const matched = listComments(projectDir).filter(
        (c) => (timing === "immediate" || c.urgency === "urgent") && c.paths.some((p) => pathMatchesComment(p, rel))
      );
      const claimed = matched.filter((c) => claimComment(projectDir, c.name));
      if (claimed.length > 0) {
        console.log(
          JSON.stringify({
            hookSpecificOutput: {
              hookEventName: "PreToolUse",
              additionalContext: renderInjection(claimed, MAX_INJECT_CHARS)
            }
          })
        );
      }
    }
  }
} catch (err) {
  logError(projectDir, "inject-pre-tool-use", err);
}
process.exit(0);
