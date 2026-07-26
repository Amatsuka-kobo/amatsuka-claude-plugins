// src/serve.ts
import { spawn } from "node:child_process";
import fs6 from "node:fs";
import http from "node:http";
import path6 from "node:path";

// src/lib/http-handler.ts
import fs5 from "node:fs";

// src/lib/hook-io.ts
import fs from "node:fs";
import path2 from "node:path";

// src/lib/paths.ts
import path from "node:path";
function guidepostDir(projectDir) {
  return path.join(projectDir, ".guidepost");
}
function toursDir(projectDir) {
  return path.join(guidepostDir(projectDir), "tours");
}
function tourDir(projectDir, tourId) {
  return path.join(toursDir(projectDir), tourId);
}
function answersDir(projectDir, tourId) {
  return path.join(tourDir(projectDir, tourId), "answers");
}
function questionsDir(projectDir) {
  return path.join(guidepostDir(projectDir), "queue", "questions");
}

// src/lib/hook-io.ts
function logError(projectDir, context, err) {
  try {
    const logDir = path2.join(guidepostDir(projectDir), "log");
    fs.mkdirSync(logDir, { recursive: true });
    const message = err instanceof Error ? err.stack ?? err.message : String(err);
    fs.appendFileSync(
      path2.join(logDir, "errors.log"),
      `${(/* @__PURE__ */ new Date()).toISOString()} [${context}] ${message}
`
    );
  } catch {
  }
}

// src/lib/queue.ts
import fs3 from "node:fs";
import path4 from "node:path";

// src/lib/atomic.ts
import crypto from "node:crypto";
import fs2 from "node:fs";
import path3 from "node:path";
function writeFileAtomic(filePath, content) {
  const dir = path3.dirname(filePath);
  fs2.mkdirSync(dir, { recursive: true });
  const tmp = path3.join(
    dir,
    `.tmp-${process.pid}-${crypto.randomBytes(4).toString("hex")}`
  );
  try {
    fs2.writeFileSync(tmp, content);
    fs2.renameSync(tmp, filePath);
  } catch (err) {
    fs2.rmSync(tmp, { force: true });
    throw err;
  }
}

// src/lib/frontmatter.ts
function quote(v) {
  return /[:#"[\],]|[\r\n]|^[\s\d]|\s$|^$/.test(v) ? JSON.stringify(v) : v;
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

// src/lib/queue.ts
function questionTimestamp(date) {
  const pad = (value, length = 2) => String(value).padStart(length, "0");
  return [
    pad(date.getUTCFullYear(), 4),
    pad(date.getUTCMonth() + 1),
    pad(date.getUTCDate()),
    "T",
    pad(date.getUTCHours()),
    pad(date.getUTCMinutes()),
    pad(date.getUTCSeconds()),
    pad(date.getUTCMilliseconds(), 3)
  ].join("");
}
function writeQuestion(projectDir, question) {
  const body = question.body.trim();
  if (body === "") return null;
  const dir = questionsDir(projectDir);
  const timestamp = questionTimestamp(/* @__PURE__ */ new Date());
  let suffix = 0;
  let name = `${timestamp}.md`;
  while (fs3.existsSync(path4.join(dir, name))) {
    suffix += 1;
    name = `${timestamp}-${suffix}.md`;
  }
  const createdAt = (/* @__PURE__ */ new Date()).toISOString();
  const frontmatter = serializeFrontmatter({
    tourId: question.tourId,
    stopId: question.stopId,
    createdAt
  });
  writeFileAtomic(path4.join(dir, name), `${frontmatter}
${body}
`);
  return name;
}

// src/lib/tour-store.ts
import fs4 from "node:fs";
import path5 from "node:path";
var TOUR_ID_PATTERN = /^[A-Za-z0-9-]+$/;
var STOP_ID_PATTERN = /^stop-\d{2}$/;
var ANSWER_FILE_PATTERN = /^(stop-\d{2})-([A-Za-z0-9-]+)\.md$/;
var TOUR_ID_DATE_PATTERN = /^(\d{4})(\d{2})(\d{2})-(\d{2})(\d{2})(\d{2})-/;
function isRecord(value) {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
function requireString(value, field, context) {
  const candidate = value[field];
  if (typeof candidate !== "string" || candidate.length === 0) {
    return `${context}.${field} \u306F\u7A7A\u3067\u306A\u3044\u6587\u5B57\u5217\u3067\u3042\u308B\u5FC5\u8981\u304C\u3042\u308A\u307E\u3059`;
  }
  return void 0;
}
function validateHunk(value, context) {
  if (!isRecord(value)) {
    return `${context} \u306F\u30AA\u30D6\u30B8\u30A7\u30AF\u30C8\u3067\u3042\u308B\u5FC5\u8981\u304C\u3042\u308A\u307E\u3059`;
  }
  for (const field of ["oldStart", "oldLines", "newStart", "newLines"]) {
    const candidate = value[field];
    if (typeof candidate !== "number" || !Number.isFinite(candidate)) {
      return `${context}.${field} \u306F\u6570\u5024\u3067\u3042\u308B\u5FC5\u8981\u304C\u3042\u308A\u307E\u3059`;
    }
  }
  return void 0;
}
function validateStop(value, index) {
  const context = `stops[${index}]`;
  if (!isRecord(value)) {
    return `${context} \u306F\u30AA\u30D6\u30B8\u30A7\u30AF\u30C8\u3067\u3042\u308B\u5FC5\u8981\u304C\u3042\u308A\u307E\u3059`;
  }
  for (const field of ["id", "file", "title", "what", "why", "ifBroken"]) {
    const error = requireString(value, field, context);
    if (error) {
      return error;
    }
  }
  if (!STOP_ID_PATTERN.test(value.id)) {
    return `${context}.id \u306F stop-NN \u5F62\u5F0F\u3067\u3042\u308B\u5FC5\u8981\u304C\u3042\u308A\u307E\u3059`;
  }
  if (value.diffText !== void 0 && typeof value.diffText !== "string") {
    return `${context}.diffText \u306F\u6587\u5B57\u5217\u3067\u3042\u308B\u5FC5\u8981\u304C\u3042\u308A\u307E\u3059`;
  }
  if (value.hunk !== void 0) {
    return validateHunk(value.hunk, `${context}.hunk`);
  }
  return void 0;
}
function validateTour(value) {
  if (!isRecord(value)) {
    return { error: "tour.json \u306E\u30EB\u30FC\u30C8\u306F\u30AA\u30D6\u30B8\u30A7\u30AF\u30C8\u3067\u3042\u308B\u5FC5\u8981\u304C\u3042\u308A\u307E\u3059" };
  }
  if (value.version !== 1) {
    return { error: "version \u306F 1 \u3067\u3042\u308B\u5FC5\u8981\u304C\u3042\u308A\u307E\u3059" };
  }
  for (const field of ["tourId", "title", "baseSha", "headSha"]) {
    const error = requireString(value, field, "tour");
    if (error) {
      return { error };
    }
  }
  if (!isRecord(value.source)) {
    return { error: "tour.source \u306F\u30AA\u30D6\u30B8\u30A7\u30AF\u30C8\u3067\u3042\u308B\u5FC5\u8981\u304C\u3042\u308A\u307E\u3059" };
  }
  if (value.source.type !== "range" && value.source.type !== "pr") {
    return { error: "tour.source.type \u306F range \u307E\u305F\u306F pr \u3067\u3042\u308B\u5FC5\u8981\u304C\u3042\u308A\u307E\u3059" };
  }
  const sourceValueError = requireString(value.source, "value", "tour.source");
  if (sourceValueError) {
    return { error: sourceValueError };
  }
  if (!Array.isArray(value.stops)) {
    return { error: "tour.stops \u306F\u914D\u5217\u3067\u3042\u308B\u5FC5\u8981\u304C\u3042\u308A\u307E\u3059" };
  }
  if (value.stops.length < 1 || value.stops.length > 20) {
    return { error: "tour.stops \u306F 1 \u4EF6\u4EE5\u4E0A 20 \u4EF6\u4EE5\u4E0B\u3067\u3042\u308B\u5FC5\u8981\u304C\u3042\u308A\u307E\u3059" };
  }
  const ids = /* @__PURE__ */ new Set();
  for (const [index, stop] of value.stops.entries()) {
    const error = validateStop(stop, index);
    if (error) {
      return { error };
    }
    const id = stop.id;
    if (ids.has(id)) {
      return { error: `stop id ${id} \u304C\u91CD\u8907\u3057\u3066\u3044\u307E\u3059` };
    }
    ids.add(id);
  }
  return { tour: value };
}
function isSafeTourId(tourId) {
  return TOUR_ID_PATTERN.test(tourId);
}
function readTourFile(filePath) {
  let value;
  try {
    value = JSON.parse(fs4.readFileSync(filePath, "utf8"));
  } catch (error) {
    return {
      error: `tour.json \u3092\u8AAD\u307F\u8FBC\u3081\u307E\u305B\u3093: ${error instanceof Error ? error.message : String(error)}`
    };
  }
  return validateTour(value);
}
function readTour(projectDir, tourId) {
  if (!isSafeTourId(tourId)) {
    return { error: "tourId \u306B\u4F7F\u7528\u3067\u304D\u306A\u3044\u6587\u5B57\u304C\u542B\u307E\u308C\u3066\u3044\u307E\u3059" };
  }
  return readTourFile(path5.join(tourDir(projectDir, tourId), "tour.json"));
}
function createdAtFromTourId(tourId) {
  const match = TOUR_ID_DATE_PATTERN.exec(tourId);
  if (!match) {
    return "";
  }
  const [, year, month, day, hour, minute, second] = match;
  return `${year}-${month}-${day}T${hour}:${minute}:${second}`;
}
function listTours(projectDir) {
  let entries;
  try {
    entries = fs4.readdirSync(toursDir(projectDir), { withFileTypes: true });
  } catch {
    return [];
  }
  return entries.filter((entry) => entry.isDirectory()).map((entry) => {
    const tourId = entry.name;
    const createdAt = createdAtFromTourId(tourId);
    const result = readTour(projectDir, tourId);
    if ("error" in result) {
      return {
        tourId,
        title: tourId,
        createdAt,
        stopCount: 0,
        error: result.error
      };
    }
    return {
      tourId,
      title: result.tour.title,
      createdAt,
      stopCount: result.tour.stops.length
    };
  }).sort((left, right) => right.tourId.localeCompare(left.tourId));
}
function listAnswers(projectDir, tourId) {
  if (!isSafeTourId(tourId)) {
    return [];
  }
  let entries;
  const dir = answersDir(projectDir, tourId);
  try {
    entries = fs4.readdirSync(dir, { withFileTypes: true });
  } catch {
    return [];
  }
  const answers = [];
  for (const entry of entries) {
    if (!entry.isFile()) {
      continue;
    }
    const match = ANSWER_FILE_PATTERN.exec(entry.name);
    if (!match) {
      continue;
    }
    const [, stopId, ts] = match;
    try {
      answers.push({
        stopId,
        ts,
        body: fs4.readFileSync(path5.join(dir, entry.name), "utf8")
      });
    } catch {
    }
  }
  return answers.sort((left, right) => left.ts.localeCompare(right.ts));
}

// src/lib/http-handler.ts
var TOUR_ID_PATTERN2 = /^[A-Za-z0-9-]+$/;
var LINE_BREAK_PATTERN = /[\r\n]/;
function jsonResult(status, value) {
  return {
    status,
    contentType: "application/json",
    body: JSON.stringify(value)
  };
}
function isRecord2(value) {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
function handleTourDetail(projectDir, pathname) {
  const encodedTourId = pathname.slice("/api/tours/".length);
  let tourId;
  try {
    tourId = decodeURIComponent(encodedTourId);
  } catch {
    return jsonResult(400, { error: "bad tour id" });
  }
  if (!TOUR_ID_PATTERN2.test(tourId)) {
    return jsonResult(400, { error: "bad tour id" });
  }
  if (!fs5.existsSync(tourDir(projectDir, tourId))) {
    return jsonResult(404, { error: "not found" });
  }
  const result = readTour(projectDir, tourId);
  if ("error" in result) {
    return jsonResult(400, { error: result.error });
  }
  return jsonResult(200, {
    tour: result.tour,
    answers: listAnswers(projectDir, tourId)
  });
}
function handleQuestion(projectDir, body) {
  let value;
  try {
    value = JSON.parse(body);
  } catch {
    return jsonResult(400, { error: "bad json" });
  }
  if (!isRecord2(value) || typeof value.tourId !== "string" || typeof value.stopId !== "string" || typeof value.question !== "string" || value.question === "" || LINE_BREAK_PATTERN.test(value.tourId) || LINE_BREAK_PATTERN.test(value.stopId)) {
    return jsonResult(400, { error: "bad field" });
  }
  const name = writeQuestion(projectDir, {
    tourId: value.tourId,
    stopId: value.stopId,
    body: value.question
  });
  if (name === null) {
    return jsonResult(400, { error: "empty question" });
  }
  return jsonResult(200, { ok: true, name });
}
function handleRequest(opts, method, pathname, body) {
  let projectDir = "";
  try {
    projectDir = opts.projectDir;
    if (method === "GET" && pathname === "/") {
      return { status: 200, contentType: "text/html", body: opts.html };
    }
    if (method === "GET" && pathname === "/api/tours") {
      return jsonResult(200, listTours(projectDir));
    }
    if (method === "GET" && pathname.startsWith("/api/tours/")) {
      return handleTourDetail(projectDir, pathname);
    }
    if (method === "POST" && pathname === "/api/questions") {
      return handleQuestion(projectDir, body);
    }
    return jsonResult(404, { error: "not found" });
  } catch (error) {
    logError(projectDir || process.cwd(), "handleRequest", error);
    return jsonResult(500, { error: "internal error" });
  }
}

// src/serve.ts
var DEFAULT_PORT = 4870;
var MAX_PORT_RETRIES = 10;
var MAX_BODY_BYTES = 1e6;
function parseArgs(argv) {
  let port = DEFAULT_PORT;
  let projectDir = process.cwd();
  let open = false;
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === "--port" && argv[i + 1] !== void 0) {
      const value = Number(argv[i + 1]);
      if (Number.isInteger(value) && value >= 0 && value <= 65535) {
        port = value;
      }
      i++;
    } else if (argv[i] === "--dir" && argv[i + 1] !== void 0) {
      projectDir = path6.resolve(argv[i + 1]);
      i++;
    } else if (argv[i] === "--open") {
      open = true;
    }
  }
  return { port, projectDir, open };
}
function readHtml() {
  try {
    return {
      html: fs6.readFileSync(new URL("./ui.html", import.meta.url), "utf8"),
      error: false
    };
  } catch {
    return { html: "", error: true };
  }
}
function readBody(req) {
  return new Promise((resolve, reject) => {
    let body = "";
    let size = 0;
    let tooLarge = false;
    req.on("data", (chunk) => {
      if (tooLarge) return;
      const value = typeof chunk === "string" ? chunk : chunk.toString("utf8");
      size += Buffer.byteLength(value);
      if (size > MAX_BODY_BYTES) {
        tooLarge = true;
        req.destroy();
        reject(new Error("body too large"));
        return;
      }
      body += value;
    });
    req.on("end", () => resolve(body));
    req.on("error", reject);
  });
}
function openBrowser(url) {
  const command = process.platform === "darwin" ? { file: "open", args: [url] } : process.platform === "win32" ? { file: "cmd", args: ["/c", "start", "", url] } : { file: "xdg-open", args: [url] };
  try {
    const child = spawn(command.file, command.args, {
      detached: true,
      stdio: "ignore"
    });
    child.on("error", () => {
    });
    child.unref();
  } catch {
  }
}
function listen(server2, port) {
  return new Promise((resolve, reject) => {
    const onError = (error) => {
      server2.off("listening", onListening);
      reject(error);
    };
    const onListening = () => {
      server2.off("error", onError);
      const address = server2.address();
      resolve(
        typeof address === "object" && address !== null ? address.port : port
      );
    };
    server2.once("error", onError);
    server2.once("listening", onListening);
    server2.listen(port, "127.0.0.1");
  });
}
async function listenWithRetry(server2, port) {
  let candidate = port;
  for (let retry = 0; retry <= MAX_PORT_RETRIES; retry++) {
    try {
      return await listen(server2, candidate);
    } catch (error) {
      const code = error.code;
      if (code !== "EADDRINUSE" || candidate === 65535 || retry === MAX_PORT_RETRIES) {
        throw error;
      }
      candidate++;
    }
  }
  throw new Error("port retry limit reached");
}
var options = parseArgs(process.argv.slice(2));
var ui = readHtml();
var server = http.createServer((req, res) => {
  void (async () => {
    const url = new URL(req.url ?? "/", "http://localhost");
    if (ui.error && req.method === "GET" && url.pathname === "/") {
      res.writeHead(500, { "content-type": "text/plain; charset=utf-8" });
      res.end("ui.html not found");
      return;
    }
    const result = handleRequest(
      { projectDir: options.projectDir, html: ui.html },
      req.method ?? "GET",
      url.pathname,
      await readBody(req)
    );
    res.writeHead(result.status, {
      "content-type": `${result.contentType}; charset=utf-8`
    });
    res.end(result.body);
  })().catch(() => {
    if (!res.headersSent) {
      res.writeHead(500, { "content-type": "application/json; charset=utf-8" });
      res.end(JSON.stringify({ error: "internal error" }));
    } else {
      res.end();
    }
  });
});
var shuttingDown = false;
function shutdown() {
  if (shuttingDown) return;
  shuttingDown = true;
  if (!server.listening) process.exit(0);
  server.close(() => process.exit(0));
  setTimeout(() => process.exit(0), 1e3).unref();
}
process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);
void listenWithRetry(server, options.port).then((actualPort) => {
  const url = `http://127.0.0.1:${actualPort}/`;
  console.log(`guidepost viewer: ${url}`);
  if (options.open) openBrowser(url);
}).catch((error) => {
  console.error(`guidepost viewer \u306E\u8D77\u52D5\u306B\u5931\u6557\u3057\u307E\u3057\u305F: ${String(error)}`);
  process.exit(1);
});
