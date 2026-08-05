#!/usr/bin/env node

// src/find-chat-records.ts
import fs from "node:fs";
import path from "node:path";
function output(obj) {
  console.log(JSON.stringify(obj, null, 2));
  process.exit(0);
}
var args = process.argv.slice(2);
var dir = process.cwd();
var since = null;
var user = null;
var userProvided = false;
var latest = null;
var keywords = [];
for (let i = 0; i < args.length; i++) {
  const a = args[i];
  if (a === "--dir") dir = args[++i] ?? dir;
  else if (a === "--since") since = args[++i] ?? "";
  else if (a === "--user") {
    userProvided = true;
    user = args[++i] ?? "";
  } else if (a === "--latest")
    latest = /^\d+$/.test(args[i + 1] ?? "") ? Number(args[++i]) : 3;
  else keywords.push(a);
}
if (userProvided && !user) {
  output({
    ok: false,
    error: "--user \u306B\u7A7A\u306E\u5024\u306F\u6307\u5B9A\u3067\u304D\u307E\u305B\u3093(git config user.name \u304C\u672A\u8A2D\u5B9A\u306E\u53EF\u80FD\u6027)"
  });
}
if (since !== null && !/^\d{4}-\d{2}-\d{2}$/.test(since)) {
  output({
    ok: false,
    error: `--since \u306F YYYY-MM-DD \u5F62\u5F0F\u3067\u6307\u5B9A\u3057\u3066\u304F\u3060\u3055\u3044: ${since}`
  });
}
if (latest === null && keywords.length === 0) {
  output({ ok: false, error: "\u30AD\u30FC\u30EF\u30FC\u30C9\u307E\u305F\u306F --latest \u3092\u6307\u5B9A\u3057\u3066\u304F\u3060\u3055\u3044" });
}
var chatDir = path.join(dir, "docs", "chat");
if (!fs.existsSync(chatDir)) {
  output({ ok: false, error: `docs/chat \u304C\u5B58\u5728\u3057\u307E\u305B\u3093: ${chatDir}` });
}
function walk(d) {
  const out = [];
  let entries;
  try {
    entries = fs.readdirSync(d, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name));
  } catch {
    return out;
  }
  for (const e of entries) {
    const p = path.join(d, e.name);
    if (e.isDirectory()) out.push(...walk(p));
    else if (e.isFile() && e.name.endsWith(".md")) out.push(p);
  }
  return out;
}
var records = walk(chatDir).map((abs) => {
  const rel = path.relative(chatDir, abs).replaceAll("\\", "/");
  const m = rel.match(/^(\d{4})\/(\d{4})\/(?:([^/]+)\/)?[^/]+\.md$/);
  if (!m) return null;
  return {
    path: rel,
    date: `${m[1]}-${m[2].slice(0, 2)}-${m[2].slice(2)}`,
    user: m[3] ?? null,
    abs
  };
}).filter((record) => record !== null);
var indexPath = path.join(chatDir, "INDEX.md");
var indexLines = null;
if (fs.existsSync(indexPath)) {
  try {
    indexLines = fs.readFileSync(indexPath, "utf8").split("\n").filter((l) => l.startsWith("- `"));
  } catch {
    indexLines = null;
  }
}
var indexedPaths = new Set(
  (indexLines ?? []).map((l) => l.match(/^- `([^`]+)`/)?.[1]).filter((p) => p !== void 0)
);
var unindexed = records.filter((r) => !indexedPaths.has(r.path)).map((r) => r.path);
var inScope = (r) => (!user || r.user === user) && (!since || r.date >= since);
var titleFromContent = (content) => content.match(/^# (.+)$/m)?.[1] ?? null;
var title = (abs) => {
  try {
    return titleFromContent(fs.readFileSync(abs, "utf8"));
  } catch {
    return null;
  }
};
var mtimeOf = (abs) => {
  try {
    return fs.statSync(abs).mtimeMs;
  } catch {
    return 0;
  }
};
if (latest !== null) {
  const hits2 = records.filter(inScope).sort(
    (a, b) => b.date.localeCompare(a.date) || mtimeOf(b.abs) - mtimeOf(a.abs)
  ).slice(0, latest).map((r) => ({
    path: r.path,
    date: r.date,
    user: r.user,
    title: title(r.abs)
  }));
  output({ ok: true, mode: "latest", hits: hits2, unindexed });
}
var kw = keywords.map((k) => k.toLowerCase());
var hasKw = (text) => kw.some((k) => text.toLowerCase().includes(k));
if (indexLines) {
  const byPath = new Map(records.map((r) => [r.path, r]));
  const hits2 = [];
  for (const line of indexLines) {
    const p = line.match(/^- `([^`]+)`/)?.[1];
    const r = p ? byPath.get(p) : null;
    if (!r || !inScope(r) || !hasKw(line)) continue;
    const summary = line.split(" | ")[3]?.trim() ?? null;
    hits2.push({
      path: r.path,
      date: r.date,
      user: r.user,
      title: summary,
      matches: [line]
    });
  }
  output({ ok: true, mode: "index", hits: hits2, unindexed });
}
var hits = [];
for (const r of records.filter(inScope)) {
  let content;
  try {
    content = fs.readFileSync(r.abs, "utf8");
  } catch {
    continue;
  }
  const lines = content.split("\n");
  const found = [];
  for (let i = 0; i < lines.length && found.length < 5; i++) {
    if (!hasKw(lines[i])) continue;
    found.push(lines.slice(Math.max(0, i - 1), i + 2).join("\n"));
  }
  if (found.length) {
    hits.push({
      path: r.path,
      date: r.date,
      user: r.user,
      title: titleFromContent(content),
      matches: found
    });
  }
}
output({ ok: true, mode: "grep", hits, unindexed });
