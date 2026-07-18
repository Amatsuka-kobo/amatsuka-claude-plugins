// src/tui/main.ts
import path7 from "node:path";

// src/tui/loop.ts
import fs5 from "node:fs";
import os from "node:os";
import path6 from "node:path";
import readline from "node:readline";

// src/lib/frontmatter.ts
function quote(v) {
  return /[:#"[\],]|^[\s\d]|\s$|^$/.test(v) ? JSON.stringify(v) : v;
}
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
function serializeFrontmatter(data) {
  const lines = ["---"];
  for (const [key, value] of Object.entries(data)) {
    if (Array.isArray(value)) {
      lines.push(`${key}: [${value.map(quote).join(", ")}]`);
    } else {
      lines.push(`${key}: ${quote(String(value))}`);
    }
  }
  lines.push("---");
  return lines.join("\n");
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

// src/lib/state.ts
import fs2 from "node:fs";
import path3 from "node:path";

// src/lib/run.ts
import path2 from "node:path";

// src/lib/atomic.ts
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
function writeFileAtomic(filePath, content) {
  const dir2 = path.dirname(filePath);
  fs.mkdirSync(dir2, { recursive: true });
  const tmp = path.join(
    dir2,
    `.tmp-${process.pid}-${crypto.randomBytes(4).toString("hex")}`
  );
  try {
    fs.writeFileSync(tmp, content);
    fs.renameSync(tmp, filePath);
  } catch (err) {
    fs.rmSync(tmp, { force: true });
    throw err;
  }
}

// src/lib/run.ts
function pitcrewDir(projectDir) {
  return path2.join(projectDir, ".pitcrew");
}

// src/lib/state.ts
function isSafeName(name) {
  return /^[A-Za-z0-9._-]+\.md$/.test(name) && !name.includes("..") && !name.includes("/");
}
function asString(value) {
  return typeof value === "string" && value !== "" ? value : null;
}
function asPaths(value) {
  if (Array.isArray(value)) return value;
  if (typeof value === "string" && value !== "") return [value];
  return [];
}
function readItems(projectDir, status) {
  const dir2 = path3.join(pitcrewDir(projectDir), status);
  let names;
  try {
    names = fs2.readdirSync(dir2);
  } catch {
    return [];
  }
  const items = [];
  for (const name of names.sort().reverse()) {
    if (!name.endsWith(".md")) continue;
    let raw;
    try {
      if (!fs2.statSync(path3.join(dir2, name)).isFile()) continue;
      raw = fs2.readFileSync(path3.join(dir2, name), "utf8");
    } catch {
      continue;
    }
    const { data, body } = parseFrontmatter(raw);
    const heading = body.match(/^#\s+(.+)$/m);
    items.push({
      name,
      status,
      id: asString(data.id),
      type: asString(data.type),
      agent: asString(data.agent),
      created: asString(data.created),
      paths: asPaths(data.paths),
      base: asString(data.base),
      head: asString(data.head),
      title: heading ? heading[1].trim() : name
    });
  }
  return items;
}
function countMd(dir2) {
  try {
    return fs2.readdirSync(dir2).filter((n) => n.endsWith(".md")).length;
  } catch {
    return 0;
  }
}
function listState(projectDir) {
  const base = pitcrewDir(projectDir);
  let hasRun = false;
  let startedAt = null;
  let lastCaptureAt = null;
  let phase = null;
  try {
    const parsed = JSON.parse(
      fs2.readFileSync(path3.join(base, "run.json"), "utf8")
    );
    hasRun = true;
    if (typeof parsed.startedAt === "string") startedAt = parsed.startedAt;
    if (typeof parsed.lastCaptureAt === "string")
      lastCaptureAt = parsed.lastCaptureAt;
    if (typeof parsed.phase === "string") phase = parsed.phase;
  } catch {
  }
  return {
    hasRun,
    startedAt,
    lastCaptureAt,
    phase,
    review: readItems(projectDir, "review"),
    reviewed: readItems(projectDir, "reviewed"),
    openComments: countMd(path3.join(base, "comments")),
    processedComments: countMd(path3.join(base, "comments", "processed"))
  };
}
function readItemBody(projectDir, status, name) {
  if (!isSafeName(name)) return null;
  try {
    return fs2.readFileSync(
      path3.join(pitcrewDir(projectDir), status, name),
      "utf8"
    );
  } catch {
    return null;
  }
}

// src/lib/viewer-ops.ts
import fs3 from "node:fs";
import path4 from "node:path";
function approveItem(projectDir, name) {
  if (!isSafeName(name)) return false;
  const base = pitcrewDir(projectDir);
  try {
    fs3.mkdirSync(path4.join(base, "reviewed"), { recursive: true });
    fs3.renameSync(
      path4.join(base, "review", name),
      path4.join(base, "reviewed", name)
    );
    return true;
  } catch {
    return false;
  }
}
function nextCommentNumber(projectDir) {
  const dirs = [
    path4.join(pitcrewDir(projectDir), "comments"),
    path4.join(pitcrewDir(projectDir), "comments", "processed")
  ];
  let max = 0;
  for (const dir2 of dirs) {
    let names;
    try {
      names = fs3.readdirSync(dir2);
    } catch {
      continue;
    }
    for (const name of names) {
      const m = name.match(/^c-(\d+)\.md$/);
      if (m) max = Math.max(max, Number(m[1]));
    }
  }
  return max + 1;
}
function writeComment(projectDir, comment) {
  const body = comment.body.trim();
  if (body === "") return null;
  const fm = {
    urgency: comment.urgency,
    ...comment.paths.length > 0 ? { paths: comment.paths } : {},
    ...comment.reviewId ? { reviewId: comment.reviewId } : {},
    ...comment.base ? { base: comment.base } : {}
  };
  const name = `c-${String(nextCommentNumber(projectDir)).padStart(3, "0")}.md`;
  writeFileAtomic(
    path4.join(pitcrewDir(projectDir), "comments", name),
    `${serializeFrontmatter(fm)}
${body}
`
  );
  return name;
}

// src/lib/watch.ts
import fs4 from "node:fs";
import path5 from "node:path";
var SUBDIRS = ["", "review", "reviewed", "comments", "comments/processed"];
var DEBOUNCE_MS = 200;
var POLL_MS = 2e3;
function watchPitcrew(projectDir, onChange) {
  const base = pitcrewDir(projectDir);
  const watchers = /* @__PURE__ */ new Map();
  let stopped = false;
  let debounce = null;
  const fire = () => {
    if (stopped) return;
    if (debounce) clearTimeout(debounce);
    debounce = setTimeout(() => {
      debounce = null;
      if (!stopped) onChange();
    }, DEBOUNCE_MS);
  };
  const ensureWatchers = () => {
    if (stopped) return;
    for (const sub of SUBDIRS) {
      const dir2 = sub === "" ? base : path5.join(base, sub);
      if (watchers.has(dir2)) continue;
      try {
        const w = fs4.watch(dir2, fire);
        w.on("error", () => {
          watchers.delete(dir2);
          w.close();
        });
        watchers.set(dir2, w);
      } catch {
      }
    }
  };
  ensureWatchers();
  const poll = setInterval(() => {
    const before = watchers.size;
    ensureWatchers();
    if (watchers.size > before) fire();
  }, POLL_MS);
  return () => {
    stopped = true;
    clearInterval(poll);
    if (debounce) clearTimeout(debounce);
    for (const w of watchers.values()) w.close();
    watchers.clear();
  };
}

// src/tui/editor.ts
import { spawnSync } from "node:child_process";
function resolveEditor(env) {
  const raw = (env.VISUAL?.trim() || env.EDITOR?.trim()) ?? "";
  if (raw === "") return null;
  const parts = raw.split(/\s+/);
  return { cmd: parts[0], args: parts.slice(1) };
}
function openInEditor(env, filePath, spawn = spawnSync) {
  const editor = resolveEditor(env);
  if (editor === null) return null;
  const result = spawn(editor.cmd, [...editor.args, filePath], {
    stdio: "inherit"
  });
  return { ok: result.status === 0 };
}

// src/tui/keymap.ts
function keyToAction(key) {
  if (key.ctrl && key.name === "c") return "quit";
  switch (key.name) {
    case "j":
    case "down":
      return "down";
    case "k":
    case "up":
      return "up";
    case "c":
      return "comment";
    case "a":
      return "approve";
    case "q":
      return "quit";
    default:
      return "none";
  }
}
function moveSelection(current, delta, length) {
  if (length <= 0) return -1;
  const next = (current < 0 ? 0 : current) + delta;
  if (next < 0) return 0;
  if (next >= length) return length - 1;
  return next;
}

// src/tui/render.ts
var GREEN = "\x1B[32m";
var RED = "\x1B[31m";
var RESET = "\x1B[0m";
function truncate(line, cols) {
  return line.length > cols ? line.slice(0, cols) : line;
}
function formatAge(created, now) {
  if (created === null) return "";
  const t = Date.parse(created);
  if (Number.isNaN(t)) return "";
  const sec = Math.max(0, Math.floor((now.getTime() - t) / 1e3));
  if (sec < 60) return "\u305F\u3063\u305F\u4ECA";
  if (sec < 3600) return `${Math.floor(sec / 60)}\u5206\u524D`;
  if (sec < 86400) return `${Math.floor(sec / 3600)}\u6642\u9593\u524D`;
  return `${Math.floor(sec / 86400)}\u65E5\u524D`;
}
function itemLine(item, isSelected, now) {
  const mark = isSelected ? "\u2192" : " ";
  const id = item.id ?? item.name;
  const type = item.type ?? "?";
  const agent = item.agent ?? "?";
  return `${mark} ${id.padEnd(5)} ${type.padEnd(9)} ${agent.padEnd(14)} ${formatAge(item.created, now)}`;
}
function colorDiffLine(line) {
  if (line.startsWith("+")) return `${GREEN}${line}${RESET}`;
  if (line.startsWith("-")) return `${RED}${line}${RESET}`;
  return line;
}
function renderScreen(input) {
  const { state, selected, body, message, rows, cols, now } = input;
  const items = state.review;
  const lines = [];
  const remaining = Math.max(0, rows - 2);
  const listRows = Math.min(items.length, Math.ceil(remaining / 2));
  const previewRows = Math.max(0, remaining - listRows);
  if (rows >= 1) {
    const status = message ?? `\u672A\u30EC\u30D3\u30E5\u30FC: ${items.length}   \u672A\u56DE\u53CE\u30B3\u30E1\u30F3\u30C8: ${state.openComments}`;
    lines.push(truncate(status, cols));
  }
  let start = 0;
  if (selected >= listRows) start = selected - listRows + 1;
  for (let i = start; i < start + listRows && i < items.length; i++) {
    lines.push(truncate(itemLine(items[i], i === selected, now), cols));
  }
  if (previewRows > 0 && selected >= 0 && selected < items.length) {
    const item = items[selected];
    const preview = [
      `id:${item.id ?? "?"} type:${item.type ?? "?"} agent:${item.agent ?? "?"}`
    ];
    if (body !== null) preview.push(...body.split("\n"));
    for (const raw of preview.slice(0, previewRows)) {
      lines.push(colorDiffLine(truncate(raw, cols)));
    }
  }
  if (rows >= 2) {
    lines.push(truncate("[j/k]\u79FB\u52D5 [c]\u30B3\u30E1\u30F3\u30C8 [a]\u627F\u8A8D\u3057\u3066\u65E2\u8AAD [q]\u7D42\u4E86", cols));
  }
  return lines;
}

// src/tui/loop.ts
var PLACEHOLDER = "(\u3053\u3053\u306B\u30B3\u30E1\u30F3\u30C8\u672C\u6587)";
var EMPTY_STATE = {
  hasRun: false,
  startedAt: null,
  lastCaptureAt: null,
  phase: null,
  review: [],
  reviewed: [],
  openComments: 0,
  processedComments: 0
};
function safeListState(projectDir) {
  try {
    return listState(projectDir);
  } catch {
    return EMPTY_STATE;
  }
}
function itemKey(state, index) {
  const item = state.review[index];
  if (item === void 0) return null;
  return item.id ?? item.name;
}
function runTui(projectDir) {
  let state = safeListState(projectDir);
  let selected = state.review.length > 0 ? 0 : -1;
  let message = null;
  let cleanedUp = false;
  let stopWatch = () => {
  };
  const draw = () => {
    const item = state.review[selected];
    const body = item !== void 0 ? readItemBody(projectDir, "review", item.name) : null;
    const lines = renderScreen({
      state,
      selected,
      body,
      message,
      rows: process.stdout.rows ?? 24,
      cols: process.stdout.columns ?? 80,
      now: /* @__PURE__ */ new Date()
    });
    process.stdout.write(`\x1B[2J\x1B[H${lines.join("\r\n")}`);
  };
  const cleanup = () => {
    if (cleanedUp) return;
    cleanedUp = true;
    try {
      process.stdin.setRawMode(false);
    } catch {
    }
    process.stdout.write("\x1B[?25h\x1B[?1049l");
  };
  const quit = (code) => {
    cleanup();
    stopWatch();
    process.exit(code);
  };
  process.on("SIGINT", () => quit(0));
  process.on("SIGTERM", () => quit(0));
  process.on("uncaughtException", (err) => {
    cleanup();
    console.error(err.stack ?? String(err));
    process.exit(1);
  });
  const reload = () => {
    const oldKey = itemKey(state, selected);
    const oldIndex = selected;
    state = safeListState(projectDir);
    if (state.review.length === 0) {
      selected = -1;
    } else if (oldKey !== null) {
      const found = state.review.findIndex(
        (it) => (it.id ?? it.name) === oldKey
      );
      selected = found >= 0 ? found : Math.min(Math.max(oldIndex, 0), state.review.length - 1);
    } else {
      selected = 0;
    }
    draw();
  };
  stopWatch = watchPitcrew(projectDir, reload);
  const approve = () => {
    const item = state.review[selected];
    if (item === void 0) return;
    if (approveItem(projectDir, item.name)) {
      state = safeListState(projectDir);
      selected = state.review.length === 0 ? -1 : Math.min(selected, state.review.length - 1);
      message = null;
    } else {
      message = `\u627F\u8A8D\u3067\u304D\u307E\u305B\u3093\u3067\u3057\u305F: ${item.name}`;
    }
    draw();
  };
  const comment = () => {
    const item = state.review[selected];
    if (item === void 0) return;
    if (resolveEditor(process.env) === null) {
      message = "$EDITOR \u307E\u305F\u306F $VISUAL \u3092\u8A2D\u5B9A\u3057\u3066\u304F\u3060\u3055\u3044";
      draw();
      return;
    }
    const scratch = path6.join(
      os.tmpdir(),
      `pitcrew-comment-${process.pid}-${Date.now()}.md`
    );
    const fm = { urgency: "normal" };
    if (item.paths.length > 0) fm.paths = item.paths;
    if (item.id !== null) fm.reviewId = item.id;
    if (item.base !== null) fm.base = item.base;
    fs5.writeFileSync(scratch, `${serializeFrontmatter(fm)}
${PLACEHOLDER}
`);
    process.stdin.setRawMode(false);
    const result = openInEditor(process.env, scratch);
    process.stdin.setRawMode(true);
    if (result === null) {
      message = "$EDITOR \u307E\u305F\u306F $VISUAL \u3092\u8A2D\u5B9A\u3057\u3066\u304F\u3060\u3055\u3044";
    } else if (!result.ok) {
      message = "\u30A8\u30C7\u30A3\u30BF\u304C\u6B63\u5E38\u7D42\u4E86\u3057\u306A\u304B\u3063\u305F\u305F\u3081\u9001\u4FE1\u3057\u307E\u305B\u3093\u3067\u3057\u305F";
    } else {
      const { data, body } = parseFrontmatter(fs5.readFileSync(scratch, "utf8"));
      const text = body.trim();
      if (text === "" || text === PLACEHOLDER) {
        message = "\u672C\u6587\u304C\u7A7A\u306E\u305F\u3081\u9001\u4FE1\u3057\u307E\u305B\u3093\u3067\u3057\u305F";
      } else {
        const paths = Array.isArray(data.paths) ? data.paths : typeof data.paths === "string" && data.paths !== "" ? [data.paths] : [];
        const name = writeComment(projectDir, {
          body: text,
          urgency: data.urgency === "urgent" ? "urgent" : "normal",
          paths,
          reviewId: typeof data.reviewId === "string" ? data.reviewId : null,
          base: typeof data.base === "string" ? data.base : null
        });
        message = name !== null ? `\u30B3\u30E1\u30F3\u30C8\u3092\u4FDD\u5B58\u3057\u307E\u3057\u305F: ${name}` : null;
      }
    }
    try {
      fs5.rmSync(scratch, { force: true });
    } catch {
    }
    draw();
  };
  process.stdout.write("\x1B[?1049h\x1B[?25l");
  readline.emitKeypressEvents(process.stdin);
  process.stdin.setRawMode(true);
  process.stdin.on("keypress", (_str, key) => {
    switch (keyToAction(key ?? {})) {
      case "down":
        selected = moveSelection(selected, 1, state.review.length);
        message = null;
        draw();
        break;
      case "up":
        selected = moveSelection(selected, -1, state.review.length);
        message = null;
        draw();
        break;
      case "approve":
        approve();
        break;
      case "comment":
        comment();
        break;
      case "quit":
        quit(0);
        break;
      default:
        break;
    }
  });
  process.stdout.on("resize", draw);
  draw();
}

// src/tui/main.ts
function parseArgs(argv) {
  let dir2 = process.cwd();
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === "--dir" && argv[i + 1] !== void 0) {
      dir2 = path7.resolve(argv[i + 1]);
      i++;
    }
  }
  return { dir: dir2 };
}
var { dir } = parseArgs(process.argv.slice(2));
if (!process.stdin.isTTY || !process.stdout.isTTY) {
  console.error("pitcrew watch \u306F\u5BFE\u8A71\u7AEF\u672B(TTY)\u304C\u5FC5\u8981\u3067\u3059");
  process.exit(1);
}
runTui(dir);
