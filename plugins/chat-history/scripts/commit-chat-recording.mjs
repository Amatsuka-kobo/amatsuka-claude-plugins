#!/usr/bin/env node

// src/commit-chat-recording.ts
import fs2 from "node:fs";
import path2 from "node:path";
import { fileURLToPath } from "node:url";

// src/chat-recording-state.ts
import { createHash, randomUUID } from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
var normalizePath = (value) => {
  const resolved = path.resolve(value);
  return process.platform === "win32" ? resolved.replaceAll("\\", "/").replace(/^[A-Z]:/, (drive) => drive.toLowerCase()) : resolved;
};
var hashKey = (value) => createHash("sha256").update(value).digest("hex").slice(0, 24);
function claudeConfigRoot(env = process.env) {
  const configured = env.CLAUDE_CONFIG_DIR;
  return configured && path.isAbsolute(configured) ? path.resolve(configured) : path.join(os.homedir(), ".claude");
}
var currentUid = () => typeof process.getuid === "function" ? process.getuid() : null;
function resolveTempDir(projectStateDir, projectKey, env) {
  const candidate = path.join(projectStateDir, "temp");
  const configRoot = claudeConfigRoot(env);
  if (normalizePath(candidate) !== normalizePath(configRoot) && !isInside(configRoot, candidate))
    return candidate;
  const uid = currentUid();
  const scope = uid === null ? "chat-history-recorder" : `chat-history-recorder-${uid}`;
  return path.join(os.tmpdir(), scope, projectKey, "temp");
}
var STATE_DIR_SEGMENTS = ["chat-history", "chat-recorder"];
var LEGACY_STATE_DIR_SEGMENTS = ["task-utility", "chat-recorder"];
function stateRootIn(base, legacy) {
  return path.join(
    base,
    ...legacy ? LEGACY_STATE_DIR_SEGMENTS : STATE_DIR_SEGMENTS
  );
}
function resolveStateRoot(env = process.env) {
  const configured = env.TASK_UTILITY_CHAT_STATE_DIR;
  if (configured && path.isAbsolute(configured)) return { root: configured };
  const claudeConfig = env.CLAUDE_CONFIG_DIR;
  const base = claudeConfig && path.isAbsolute(claudeConfig) ? claudeConfig : path.join(os.homedir(), ".claude");
  const root = stateRootIn(base, false);
  const legacyRoot = stateRootIn(base, true);
  if (fs.existsSync(root) || !fs.existsSync(legacyRoot)) return { root };
  return { root: legacyRoot, legacyRoot };
}
function getStatePaths(projectDir, sessionKey, env = process.env) {
  const { root, legacyRoot } = resolveStateRoot(env);
  const projectKey = hashKey(normalizePath(projectDir));
  const projectStateDir = path.join(root, projectKey);
  return {
    baseDir: projectStateDir,
    projectDir,
    stateDir: path.join(projectStateDir, "state"),
    lockDir: path.join(projectStateDir, "locks"),
    logDir: path.join(projectStateDir, "logs"),
    tempDir: resolveTempDir(projectStateDir, projectKey, env),
    planDir: path.join(projectStateDir, "plans"),
    statePath: path.join(projectStateDir, "state", `${sessionKey}.json`),
    lockPath: path.join(projectStateDir, "locks", `${sessionKey}.lock`),
    logPath: path.join(projectStateDir, "logs", `${sessionKey}.log`),
    legacyRoot
  };
}
function atomicWriteJson(file, value) {
  fs.mkdirSync(path.dirname(file), { recursive: true, mode: 448 });
  const temp = `${file}.${process.pid}.${randomUUID()}.tmp`;
  fs.writeFileSync(temp, `${JSON.stringify(value, null, 2)}
`, {
    encoding: "utf8",
    mode: 384
  });
  fs.renameSync(temp, file);
}
function readJson(file) {
  try {
    return JSON.parse(fs.readFileSync(file, "utf8"));
  } catch {
    return null;
  }
}
function appendLog(file, line) {
  fs.mkdirSync(path.dirname(file), { recursive: true, mode: 448 });
  if (fs.existsSync(file) && fs.statSync(file).size > 1024 * 1024) {
    const fd = fs.openSync(file, "r");
    try {
      const size = fs.statSync(file).size;
      const keep = Math.min(512 * 1024, size);
      const buffer = Buffer.alloc(keep);
      fs.readSync(fd, buffer, 0, keep, size - keep);
      fs.writeFileSync(file, buffer, { mode: 384 });
    } finally {
      fs.closeSync(fd);
    }
  }
  fs.appendFileSync(file, `${line}
`, { encoding: "utf8", mode: 384 });
}
function updateHeartbeat(lockPath, attemptId) {
  const lock = readJson(lockPath);
  if (!lock || lock.attemptId !== attemptId)
    throw new Error("recording lock ownership mismatch");
  atomicWriteJson(lockPath, {
    ...lock,
    heartbeatAt: (/* @__PURE__ */ new Date()).toISOString()
  });
}
function isInside(parent, candidate) {
  const relative = path.relative(path.resolve(parent), path.resolve(candidate));
  return relative !== "" && !relative.startsWith("..") && !path.isAbsolute(relative);
}

// src/commit-chat-recording.ts
function fail(message) {
  throw new Error(message);
}
var MAX_BODY_BYTES = 8 * 1024 * 1024;
var MAX_SESSION_TITLE_BYTES = 512;
var MAX_HEADER_BYTES = 64 * 1024;
var MAX_INDEX_SUMMARY_BYTES = 8192;
var MAX_SLUG_LENGTH = 80;
var MAX_SESSION_ID_LENGTH = 128;
function parseArgs(argv) {
  const value = (name, optional = false) => {
    const index = argv.indexOf(name);
    if (index === -1 || !argv[index + 1]) {
      if (optional) return void 0;
      fail(`missing ${name}`);
    }
    return argv[index + 1];
  };
  const targetLine = Number(value("--target-line"));
  if (!Number.isSafeInteger(targetLine) || targetLine <= 0)
    fail("invalid --target-line");
  return {
    project: path2.resolve(value("--project")),
    sessionKey: value("--session-key"),
    attemptId: value("--attempt-id"),
    targetLine,
    bodyFile: path2.resolve(value("--body-file")),
    indexSummaryFile: path2.resolve(value("--index-summary-file")),
    sessionTitleFile: path2.resolve(value("--session-title-file")),
    headerFile: (() => {
      const raw = value("--header-file", true);
      return raw ? path2.resolve(raw) : void 0;
    })(),
    recordSlug: value("--record-slug", true)
  };
}
function validSlug(value) {
  if (!value || value.length > MAX_SLUG_LENGTH) return false;
  if (/^\d{4}($|-)/.test(value)) return false;
  return /^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(value);
}
function docsRelativePath(relativePath) {
  return relativePath.replaceAll("\\", "/").replace(/^docs\/chat\//, "");
}
function composeIndexLine(relativePath, date, worker, summary) {
  return `- \`${docsRelativePath(relativePath)}\` | ${date} | ${worker} | ${summary}`;
}
function validateInputs(args, paths, plan) {
  const temporaryFiles = [
    args.bodyFile,
    args.indexSummaryFile,
    args.sessionTitleFile,
    ...args.headerFile ? [args.headerFile] : []
  ];
  for (const file of temporaryFiles)
    if (!isInside(paths.tempDir, file))
      fail("temporary files must be inside the recording state temp directory");
  const rawBody = fs2.readFileSync(args.bodyFile, "utf8");
  const summary = fs2.readFileSync(args.indexSummaryFile, "utf8").trim();
  const sessionTitle = fs2.readFileSync(args.sessionTitleFile, "utf8").trim();
  if (!rawBody) fail("record body is empty");
  if (!rawBody.includes("> "))
    fail("record body must contain a USER quote block");
  if (!sessionTitle || sessionTitle.includes("\n") || Buffer.byteLength(sessionTitle) > MAX_SESSION_TITLE_BYTES)
    fail("session title must be exactly one bounded line");
  if (!summary || summary.includes("\n") || // find-chat-records は INDEX 行を " | " で分解して要旨を取り出す。
  // 要旨に区切り文字が混ざると検索結果の表示が壊れる。
  summary.includes("|") || Buffer.byteLength(summary) > MAX_INDEX_SUMMARY_BYTES)
    fail("INDEX summary must be exactly one bounded line without '|'");
  let header = "";
  if (plan.recordTarget.appendMode) {
    if (args.headerFile)
      fail("--header-file is forbidden when appending to an existing record");
  } else {
    const headerFile = args.headerFile;
    if (!headerFile) fail("--header-file is required for a new record");
    header = fs2.readFileSync(headerFile, "utf8");
    if (!header.startsWith("# ") || Buffer.byteLength(header) > MAX_HEADER_BYTES)
      fail("record header must start with a title line and stay bounded");
  }
  if (plan.version !== 2)
    fail(
      `plan schema version mismatch: expected 2, got ${String(plan.version)}`
    );
  for (const field of [
    "allowedNewRecordDir",
    "recordFilePrefix",
    "recordDate",
    "workerName"
  ])
    if (typeof plan[field] !== "string" || !plan[field])
      fail(`plan.${field} is missing`);
  if (!Number.isSafeInteger(plan.sessionNumber) || plan.sessionNumber <= 0)
    fail("plan.sessionNumber must be a positive integer");
  const heading = `## \u30BB\u30C3\u30B7\u30E7\u30F3 ${plan.sessionNumber}: ${sessionTitle}`;
  const sessionId = plan.sessionId;
  const usableSessionId = typeof sessionId === "string" && sessionId.trim() !== "" && !/[\r\n]/.test(sessionId) && sessionId.length <= MAX_SESSION_ID_LENGTH ? sessionId : null;
  const headerWithSession = usableSessionId ? `${header.trimEnd()}
- \u30BB\u30C3\u30B7\u30E7\u30F3 ID: ${usableSessionId}` : header.trimEnd();
  const body = plan.recordTarget.appendMode ? `
${heading}

${rawBody}` : `${headerWithSession}

---

${heading}

${rawBody}`;
  if (Buffer.byteLength(body) > MAX_BODY_BYTES) fail("record body is too large");
  if (!body.includes("## \u30BB\u30C3\u30B7\u30E7\u30F3"))
    fail("composed record must contain a session heading");
  let candidates;
  if (plan.recordTarget.relativePath !== null) {
    candidates = [plan.recordTarget.relativePath];
  } else {
    const slug = args.recordSlug;
    if (!slug) throw new Error("--record-slug is required for a new target");
    if (!validSlug(slug))
      fail(
        `record slug violates the naming contract: expected at most ${MAX_SLUG_LENGTH} chars of [a-z0-9-] not starting with 4 digits, got ${slug}`
      );
    const base = `${plan.allowedNewRecordDir}/${plan.recordFilePrefix}-${slug}`;
    candidates = [`${base}.md`];
    for (let suffix = 2; suffix <= 9; suffix++)
      candidates.push(`${base}-${suffix}.md`);
  }
  for (const candidate of candidates)
    if (!isInside(args.project, path2.resolve(args.project, candidate)))
      fail("record path escapes project");
  return { candidates, body, summary };
}
function indexMatches(lines, relativePath) {
  const docsRelative = docsRelativePath(relativePath);
  const matches = [];
  for (const [index, line] of lines.entries())
    if (line.replaceAll("\\", "/").includes(docsRelative)) matches.push(index);
  return matches;
}
function indexEntryPath(line) {
  const entryPath = line.match(/^- `([^`]+)`/)?.[1];
  return entryPath ? docsRelativePath(entryPath) : null;
}
function insertIndexLine(lines, indexLine, relativePath) {
  const docsRelative = docsRelativePath(relativePath);
  let lastEntry = -1;
  for (const [index, line] of lines.entries()) {
    const entryPath = indexEntryPath(line);
    if (entryPath === null) continue;
    if (entryPath.localeCompare(docsRelative) > 0) {
      lines.splice(index, 0, indexLine);
      return;
    }
    lastEntry = index;
  }
  lines.splice(lastEntry === -1 ? lines.length : lastEntry + 1, 0, indexLine);
}
function commitChatRecording(args) {
  const paths = getStatePaths(args.project, args.sessionKey);
  const state = readJson(paths.statePath);
  if (state && state.recordedLine >= args.targetLine && state.attemptId === args.attemptId && state.recordPath)
    return {
      ok: true,
      recordedLine: state.recordedLine,
      recordPath: state.recordPath,
      indexUpdated: true
    };
  const lock = readJson(paths.lockPath);
  const planPath = path2.join(paths.planDir, `${args.sessionKey}.json`);
  const plan = readJson(planPath);
  if (!state || !lock || !plan) throw new Error("attempt/lock/plan missing");
  if (state.attemptId !== args.attemptId || lock.attemptId !== args.attemptId || plan.attemptId !== args.attemptId || lock.targetLine !== args.targetLine || plan.targetLine !== args.targetLine)
    fail("attempt/lock/plan mismatch");
  updateHeartbeat(paths.lockPath, args.attemptId);
  let input;
  try {
    input = validateInputs(args, paths, plan);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    atomicWriteJson(paths.statePath, {
      ...state,
      lastError: {
        attemptId: args.attemptId,
        at: (/* @__PURE__ */ new Date()).toISOString(),
        phase: "commit-validation",
        message,
        logPath: paths.logPath
      }
    });
    appendLog(paths.logPath, `[commit-validation] ${message}`);
    throw error;
  }
  const indexPath = path2.join(args.project, "docs", "chat", "INDEX.md");
  const indexExisted = fs2.existsSync(indexPath);
  const oldIndex = indexExisted ? fs2.readFileSync(indexPath, "utf8") : "";
  let relativePath = "";
  let recordPath = "";
  let oldRecordExisted = false;
  let oldSize = 0;
  let bodyUpdated = false;
  try {
    if (plan.recordTarget.appendMode) {
      relativePath = input.candidates[0];
      recordPath = path2.resolve(args.project, relativePath);
      if (!fs2.existsSync(recordPath)) fail("append target disappeared");
      oldRecordExisted = true;
      oldSize = fs2.statSync(recordPath).size;
      fs2.appendFileSync(recordPath, input.body);
    } else {
      let written = false;
      for (const candidate of input.candidates) {
        const absolute = path2.resolve(args.project, candidate);
        fs2.mkdirSync(path2.dirname(absolute), { recursive: true });
        try {
          fs2.writeFileSync(absolute, input.body, {
            encoding: "utf8",
            flag: "wx"
          });
        } catch (error) {
          if (error.code === "EEXIST") continue;
          fs2.rmSync(absolute, { force: true });
          throw error;
        }
        relativePath = candidate;
        recordPath = absolute;
        written = true;
        break;
      }
      if (!written) fail("every candidate record path is already taken");
    }
    bodyUpdated = true;
    const indexLine = composeIndexLine(
      relativePath,
      plan.recordDate,
      plan.workerName,
      input.summary
    );
    const lines = indexExisted ? (oldIndex.endsWith("\n") ? oldIndex.slice(0, -1) : oldIndex).split("\n") : ["# Chat Records Index", ""];
    const matches = indexMatches(lines, relativePath);
    if (matches.length > 1) fail("INDEX contains duplicate target entries");
    if (matches.length === 1) lines[matches[0]] = indexLine;
    else insertIndexLine(lines, indexLine, relativePath);
    fs2.mkdirSync(path2.dirname(indexPath), { recursive: true });
    fs2.writeFileSync(indexPath, `${lines.join("\n")}
`, "utf8");
    const updatedRecord = fs2.readFileSync(recordPath, "utf8");
    const updatedIndex = fs2.readFileSync(indexPath, "utf8").split("\n");
    if (!updatedRecord.endsWith(input.body)) fail("record verification failed");
    if (indexMatches(updatedIndex, relativePath).length !== 1)
      fail("INDEX uniqueness verification failed");
    const nextState = {
      ...state,
      recordedLine: args.targetLine,
      attemptedLine: Math.max(state.attemptedLine, args.targetLine),
      lastSuccessAt: (/* @__PURE__ */ new Date()).toISOString(),
      recordPath: relativePath,
      lastError: null
    };
    atomicWriteJson(paths.statePath, nextState);
    appendLog(
      paths.logPath,
      `=== result=success recordedLine=${args.targetLine} ===`
    );
    for (const file of [
      args.bodyFile,
      args.indexSummaryFile,
      args.sessionTitleFile,
      ...args.headerFile ? [args.headerFile] : [],
      planPath,
      paths.lockPath
    ])
      fs2.rmSync(file, { force: true });
    return {
      ok: true,
      recordedLine: args.targetLine,
      recordPath: relativePath,
      indexUpdated: true
    };
  } catch (error) {
    let manualRepairRequired = false;
    if (bodyUpdated && recordPath) {
      try {
        if (oldRecordExisted) fs2.truncateSync(recordPath, oldSize);
        else fs2.rmSync(recordPath, { force: true });
        if (indexExisted) fs2.writeFileSync(indexPath, oldIndex, "utf8");
        else fs2.rmSync(indexPath, { force: true });
      } catch {
        manualRepairRequired = true;
      }
    }
    const message = error instanceof Error ? error.message : String(error);
    atomicWriteJson(paths.statePath, {
      ...state,
      lastError: {
        attemptId: args.attemptId,
        at: (/* @__PURE__ */ new Date()).toISOString(),
        phase: "commit",
        message,
        logPath: paths.logPath,
        manualRepairRequired,
        recordPath: relativePath,
        originalSize: oldSize
      }
    });
    appendLog(
      paths.logPath,
      `[commit] ${message}${manualRepairRequired ? " manual repair required" : ""}`
    );
    throw error;
  }
}
function main() {
  try {
    console.log(
      JSON.stringify(commitChatRecording(parseArgs(process.argv.slice(2))))
    );
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.log(
      JSON.stringify({ ok: false, error: { code: "COMMIT_FAILED", message } })
    );
    process.exitCode = 1;
  }
}
if (process.argv[1] && fs2.realpathSync(process.argv[1]) === fileURLToPath(import.meta.url))
  main();
export {
  commitChatRecording
};
