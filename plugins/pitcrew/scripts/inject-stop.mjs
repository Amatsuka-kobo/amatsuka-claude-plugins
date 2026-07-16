#!/usr/bin/env node

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

// src/lib/hook-io.ts
import fs2 from "node:fs";
import path3 from "node:path";
function readStdinSync() {
  try {
    return JSON.parse(fs2.readFileSync(0, "utf8"));
  } catch {
    return null;
  }
}
function resolveProjectDir(input2) {
  return process.env.CLAUDE_PROJECT_DIR || input2.cwd || process.cwd();
}
function logError(projectDir2, context, err) {
  try {
    const logDir = path3.join(pitcrewDir(projectDir2), "log");
    fs2.mkdirSync(logDir, { recursive: true });
    const message = err instanceof Error ? err.stack ?? err.message : String(err);
    fs2.appendFileSync(
      path3.join(logDir, "errors.log"),
      `${(/* @__PURE__ */ new Date()).toISOString()} [${context}] ${message}
`
    );
  } catch {
  }
}

// src/hooks/inject-stop.ts
var MAX_INJECT_CHARS = 9e3;
var input = readStdinSync();
if (!input) process.exit(0);
var projectDir = resolveProjectDir(input);
try {
  if (input.stop_hook_active !== true) {
    const claimed = listComments(projectDir).filter(
      (c) => claimComment(projectDir, c.name)
    );
    if (claimed.length > 0) {
      console.log(
        JSON.stringify({
          decision: "block",
          reason: renderInjection(claimed, MAX_INJECT_CHARS)
        })
      );
    }
  }
} catch (err) {
  logError(projectDir, "inject-stop", err);
}
process.exit(0);
