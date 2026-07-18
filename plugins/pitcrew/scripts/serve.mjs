// src/server/serve.ts
import crypto3 from "node:crypto";
import fs6 from "node:fs";
import path7 from "node:path";

// src/lib/atomic.ts
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
function writeFileAtomic(filePath, content) {
  const dir = path.dirname(filePath);
  fs.mkdirSync(dir, { recursive: true });
  const tmp = path.join(
    dir,
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

// src/lib/config.ts
import fs2 from "node:fs";
import path2 from "node:path";

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

// src/lib/config.ts
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
  return path2.join(projectDir2, ".claude", "pitcrew.local.md");
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
    const port2 = Number(data.port);
    if (port2 >= 1 && port2 <= 65535) cfg.port = port2;
  }
  return cfg;
}

// src/lib/run.ts
import path3 from "node:path";
function pitcrewDir(projectDir2) {
  return path3.join(projectDir2, ".pitcrew");
}

// src/server/http.ts
import crypto2 from "node:crypto";
import http from "node:http";

// src/server/state.ts
import fs3 from "node:fs";
import path4 from "node:path";
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
function readItems(projectDir2, status) {
  const dir = path4.join(pitcrewDir(projectDir2), status);
  let names;
  try {
    names = fs3.readdirSync(dir);
  } catch {
    return [];
  }
  const items = [];
  for (const name of names.sort()) {
    if (!name.endsWith(".md")) continue;
    let raw;
    try {
      if (!fs3.statSync(path4.join(dir, name)).isFile()) continue;
      raw = fs3.readFileSync(path4.join(dir, name), "utf8");
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
function countMd(dir) {
  try {
    return fs3.readdirSync(dir).filter((n) => n.endsWith(".md")).length;
  } catch {
    return 0;
  }
}
function listState(projectDir2) {
  const base = pitcrewDir(projectDir2);
  let hasRun = false;
  let startedAt = null;
  let lastCaptureAt = null;
  let phase = null;
  try {
    const parsed = JSON.parse(
      fs3.readFileSync(path4.join(base, "run.json"), "utf8")
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
    review: readItems(projectDir2, "review"),
    reviewed: readItems(projectDir2, "reviewed"),
    openComments: countMd(path4.join(base, "comments")),
    processedComments: countMd(path4.join(base, "comments", "processed"))
  };
}
function readItemBody(projectDir2, status, name) {
  if (!isSafeName(name)) return null;
  try {
    return fs3.readFileSync(
      path4.join(pitcrewDir(projectDir2), status, name),
      "utf8"
    );
  } catch {
    return null;
  }
}

// src/server/viewer-ops.ts
import fs4 from "node:fs";
import path5 from "node:path";
function approveItem(projectDir2, name) {
  if (!isSafeName(name)) return false;
  const base = pitcrewDir(projectDir2);
  try {
    fs4.mkdirSync(path5.join(base, "reviewed"), { recursive: true });
    fs4.renameSync(
      path5.join(base, "review", name),
      path5.join(base, "reviewed", name)
    );
    return true;
  } catch {
    return false;
  }
}
function nextCommentNumber(projectDir2) {
  const dirs = [
    path5.join(pitcrewDir(projectDir2), "comments"),
    path5.join(pitcrewDir(projectDir2), "comments", "processed")
  ];
  let max = 0;
  for (const dir of dirs) {
    let names;
    try {
      names = fs4.readdirSync(dir);
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
function writeComment(projectDir2, comment) {
  const body = comment.body.trim();
  if (body === "") return null;
  const fm = {
    urgency: comment.urgency,
    ...comment.paths.length > 0 ? { paths: comment.paths } : {},
    ...comment.reviewId ? { reviewId: comment.reviewId } : {},
    ...comment.base ? { base: comment.base } : {}
  };
  const name = `c-${String(nextCommentNumber(projectDir2)).padStart(3, "0")}.md`;
  writeFileAtomic(
    path5.join(pitcrewDir(projectDir2), "comments", name),
    `${serializeFrontmatter(fm)}
${body}
`
  );
  return name;
}

// src/server/watch.ts
import fs5 from "node:fs";
import path6 from "node:path";
var SUBDIRS = ["", "review", "reviewed", "comments", "comments/processed"];
var DEBOUNCE_MS = 200;
var POLL_MS = 2e3;
function watchPitcrew(projectDir2, onChange) {
  const base = pitcrewDir(projectDir2);
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
      const dir = sub === "" ? base : path6.join(base, sub);
      if (watchers.has(dir)) continue;
      try {
        const w = fs5.watch(dir, fire);
        w.on("error", () => {
          watchers.delete(dir);
          w.close();
        });
        watchers.set(dir, w);
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

// src/server/http.ts
function tokenEquals(a, b) {
  const ab = Buffer.from(a);
  const bb = Buffer.from(b);
  return ab.length === bb.length && crypto2.timingSafeEqual(ab, bb);
}
function authorized(req, token2) {
  const url = new URL(req.url ?? "/", "http://localhost");
  const query = url.searchParams.get("token");
  if (query !== null) return tokenEquals(query, token2);
  const header = req.headers.authorization;
  if (typeof header === "string" && header.startsWith("Bearer "))
    return tokenEquals(header.slice("Bearer ".length), token2);
  return false;
}
function sendJson(res, status, body) {
  res.writeHead(status, { "content-type": "application/json; charset=utf-8" });
  res.end(JSON.stringify(body));
}
function readBody(req) {
  return new Promise((resolve, reject) => {
    let data = "";
    let tooLarge = false;
    req.on("data", (chunk) => {
      if (tooLarge) return;
      data += chunk.toString("utf8");
      if (data.length > 1e6) {
        tooLarge = true;
        req.destroy();
        reject(new Error("body too large"));
      }
    });
    req.on("end", () => resolve(data));
    req.on("error", reject);
  });
}
function hasLineBreak(value) {
  return value.includes("\n") || value.includes("\r");
}
function createPitcrewServer(opts) {
  const { projectDir: projectDir2, token: token2, html: html2 } = opts;
  const sseClients = /* @__PURE__ */ new Set();
  const stopWatch = watchPitcrew(projectDir2, () => {
    for (const client of sseClients) {
      try {
        client.write("data: changed\n\n");
      } catch {
        sseClients.delete(client);
      }
    }
  });
  const server2 = http.createServer((req, res) => {
    void handle(req, res).catch(() => {
      if (!res.headersSent) sendJson(res, 500, { error: "internal" });
      else res.end();
    });
  });
  async function handle(req, res) {
    const url = new URL(req.url ?? "/", "http://localhost");
    if (!authorized(req, token2)) {
      sendJson(res, 401, { error: "unauthorized" });
      return;
    }
    if (req.method === "GET" && url.pathname === "/") {
      res.writeHead(200, { "content-type": "text/html; charset=utf-8" });
      res.end(html2);
      return;
    }
    if (req.method === "GET" && url.pathname === "/api/state") {
      sendJson(res, 200, listState(projectDir2));
      return;
    }
    if (req.method === "GET" && url.pathname === "/api/item") {
      const status = url.searchParams.get("status");
      const name = url.searchParams.get("name") ?? "";
      if (status !== "review" && status !== "reviewed") {
        sendJson(res, 400, { error: "bad status" });
        return;
      }
      const body = readItemBody(projectDir2, status, name);
      if (body === null) sendJson(res, 404, { error: "not found" });
      else sendJson(res, 200, { body });
      return;
    }
    if (req.method === "POST" && url.pathname === "/api/approve") {
      let name = "";
      try {
        const parsed = JSON.parse(await readBody(req));
        if (typeof parsed.name === "string") name = parsed.name;
      } catch {
        sendJson(res, 400, { error: "bad json" });
        return;
      }
      if (approveItem(projectDir2, name)) sendJson(res, 200, { ok: true });
      else sendJson(res, 404, { error: "not found" });
      return;
    }
    if (req.method === "POST" && url.pathname === "/api/comment") {
      let comment;
      try {
        const p = JSON.parse(await readBody(req));
        comment = {
          body: typeof p.body === "string" ? p.body : "",
          urgency: p.urgency === "urgent" ? "urgent" : "normal",
          paths: Array.isArray(p.paths) ? p.paths.filter((x) => typeof x === "string") : [],
          reviewId: typeof p.reviewId === "string" ? p.reviewId : null,
          base: typeof p.base === "string" ? p.base : null
        };
      } catch {
        sendJson(res, 400, { error: "bad json" });
        return;
      }
      if (comment.reviewId !== null && hasLineBreak(comment.reviewId) || comment.base !== null && hasLineBreak(comment.base) || comment.paths.some(hasLineBreak)) {
        sendJson(res, 400, { error: "bad field" });
        return;
      }
      const name = writeComment(projectDir2, comment);
      if (name === null) sendJson(res, 400, { error: "empty body" });
      else sendJson(res, 200, { ok: true, name });
      return;
    }
    if (req.method === "GET" && url.pathname === "/api/events") {
      res.writeHead(200, {
        "content-type": "text/event-stream",
        "cache-control": "no-cache",
        connection: "keep-alive"
      });
      res.write("data: changed\n\n");
      sseClients.add(res);
      req.on("close", () => {
        sseClients.delete(res);
      });
      return;
    }
    sendJson(res, 404, { error: "not found" });
  }
  server2.on("close", () => {
    stopWatch();
    for (const client of sseClients) {
      try {
        client.end();
      } catch {
        sseClients.delete(client);
      }
    }
    sseClients.clear();
  });
  return server2;
}

// src/server/serve.ts
function parseArgs(argv) {
  let port2 = null;
  let dir = process.cwd();
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === "--port" && argv[i + 1] !== void 0) {
      const n = Number(argv[i + 1]);
      if (Number.isInteger(n) && n >= 0 && n <= 65535) port2 = n;
      i++;
    } else if (argv[i] === "--dir" && argv[i + 1] !== void 0) {
      dir = path7.resolve(argv[i + 1]);
      i++;
    }
  }
  return { port: port2, dir };
}
var { port: portArg, dir: projectDir } = parseArgs(process.argv.slice(2));
var config = loadConfig(projectDir);
var port = portArg ?? config.port;
var token = crypto3.randomBytes(24).toString("hex");
var html = fs6.readFileSync(new URL("./ui.html", import.meta.url), "utf8").replaceAll("%PITCREW_THEME%", config.theme);
var server = createPitcrewServer({ projectDir, token, html });
var serveJsonPath = path7.join(pitcrewDir(projectDir), "serve.json");
server.listen(port, "127.0.0.1", () => {
  const addr = server.address();
  const actualPort = typeof addr === "object" && addr !== null ? addr.port : port;
  const url = `http://127.0.0.1:${actualPort}/?token=${token}`;
  writeFileAtomic(
    serveJsonPath,
    `${JSON.stringify(
      {
        port: actualPort,
        token,
        pid: process.pid,
        startedAt: (/* @__PURE__ */ new Date()).toISOString(),
        url
      },
      null,
      2
    )}
`
  );
  console.log(`pitcrew viewer: ${url}`);
});
server.on("error", (err) => {
  console.error(`pitcrew viewer \u306E\u8D77\u52D5\u306B\u5931\u6557\u3057\u307E\u3057\u305F: ${String(err)}`);
  process.exit(1);
});
function shutdown() {
  try {
    fs6.rmSync(serveJsonPath, { force: true });
  } catch {
  }
  server.close(() => process.exit(0));
  setTimeout(() => process.exit(0), 1e3).unref();
}
process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);
