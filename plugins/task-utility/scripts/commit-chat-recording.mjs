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
  const scope = uid === null ? "task-utility-chat-recorder" : `task-utility-chat-recorder-${uid}`;
  return path.join(os.tmpdir(), scope, projectKey, "temp");
}
function getStatePaths(projectDir, sessionKey, env = process.env) {
  const configured = env.TASK_UTILITY_CHAT_STATE_DIR;
  const claudeConfig = env.CLAUDE_CONFIG_DIR;
  const root = configured && path.isAbsolute(configured) ? configured : claudeConfig && path.isAbsolute(claudeConfig) ? path.join(claudeConfig, "task-utility", "chat-recorder") : path.join(os.homedir(), ".claude", "task-utility", "chat-recorder");
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
    logPath: path.join(projectStateDir, "logs", `${sessionKey}.log`)
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
var fail = (message) => {
  throw new Error(message);
};
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
    indexLineFile: path2.resolve(value("--index-line-file")),
    recordPath: value("--record-path", true)
  };
}
function validKebabMarkdown(name) {
  return /^[a-z0-9]+(?:-[a-z0-9]+)*\.md$/.test(name);
}
function docsRelativePath(relativePath) {
  return relativePath.replaceAll("\\", "/").replace(/^docs\/chat\//, "");
}
function validateInputs(args, paths, plan) {
  if (!isInside(paths.tempDir, args.bodyFile) || !isInside(paths.tempDir, args.indexLineFile))
    fail("temporary files must be inside the recording state temp directory");
  const body = fs2.readFileSync(args.bodyFile, "utf8");
  const indexLine = fs2.readFileSync(args.indexLineFile, "utf8").trim();
  if (!body || Buffer.byteLength(body) > 1024 * 1024)
    fail("record body is empty or too large");
  if (!indexLine || indexLine.includes("\n") || Buffer.byteLength(indexLine) > 8192)
    fail("INDEX entry must be exactly one bounded line");
  if (!body.includes("## \u30BB\u30C3\u30B7\u30E7\u30F3") && plan.recordTarget.appendMode)
    fail("append body must contain a session heading");
  if (!body.includes("> ")) fail("record body must contain a USER quote block");
  let relativePath;
  if (plan.recordTarget.relativePath !== null) {
    if (args.recordPath)
      fail("--record-path is forbidden for an existing target");
    relativePath = plan.recordTarget.relativePath;
  } else {
    const requestedPath = args.recordPath;
    if (!requestedPath)
      throw new Error("--record-path is required for a new target");
    relativePath = requestedPath.replaceAll("\\", "/");
    if (path2.posix.dirname(relativePath) !== plan.allowedNewRecordDir || !validKebabMarkdown(path2.posix.basename(relativePath)))
      fail(
        `new record path violates the naming or directory contract: expected ${plan.allowedNewRecordDir}/<kebab-case>.md, got ${relativePath}`
      );
  }
  const recordPath = path2.resolve(args.project, relativePath);
  if (!isInside(args.project, recordPath)) fail("record path escapes project");
  const docsRelative = docsRelativePath(relativePath);
  if (!indexLine.includes(docsRelative))
    fail(
      `INDEX entry does not reference the target record: expected docs/chat-relative path ${docsRelative}`
    );
  return { recordPath, relativePath, body, indexLine };
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
      consecutiveFailures: (state.consecutiveFailures ?? 0) + 1,
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
  const oldRecordExisted = fs2.existsSync(input.recordPath);
  const oldSize = oldRecordExisted ? fs2.statSync(input.recordPath).size : 0;
  let bodyUpdated = false;
  try {
    fs2.mkdirSync(path2.dirname(input.recordPath), { recursive: true });
    if (plan.recordTarget.appendMode) {
      if (!oldRecordExisted) fail("append target disappeared");
      fs2.appendFileSync(input.recordPath, input.body);
    } else {
      fs2.writeFileSync(input.recordPath, input.body, {
        encoding: "utf8",
        flag: "wx"
      });
    }
    bodyUpdated = true;
    const lines = indexExisted ? (oldIndex.endsWith("\n") ? oldIndex.slice(0, -1) : oldIndex).split("\n") : ["# Chat Records Index", ""];
    const matches = indexMatches(lines, input.relativePath);
    if (matches.length > 1) fail("INDEX contains duplicate target entries");
    if (matches.length === 1) lines[matches[0]] = input.indexLine;
    else insertIndexLine(lines, input.indexLine, input.relativePath);
    fs2.mkdirSync(path2.dirname(indexPath), { recursive: true });
    fs2.writeFileSync(indexPath, `${lines.join("\n")}
`, "utf8");
    const updatedRecord = fs2.readFileSync(input.recordPath, "utf8");
    const updatedIndex = fs2.readFileSync(indexPath, "utf8").split("\n");
    if (!updatedRecord.endsWith(input.body)) fail("record verification failed");
    if (indexMatches(updatedIndex, input.relativePath).length !== 1)
      fail("INDEX uniqueness verification failed");
    const nextState = {
      ...state,
      recordedLine: args.targetLine,
      attemptedLine: Math.max(state.attemptedLine, args.targetLine),
      lastSuccessAt: (/* @__PURE__ */ new Date()).toISOString(),
      recordPath: input.relativePath,
      lastError: null,
      consecutiveFailures: 0
    };
    atomicWriteJson(paths.statePath, nextState);
    appendLog(
      paths.logPath,
      `=== result=success recordedLine=${args.targetLine} ===`
    );
    for (const file of [
      args.bodyFile,
      args.indexLineFile,
      planPath,
      paths.lockPath
    ])
      fs2.rmSync(file, { force: true });
    return {
      ok: true,
      recordedLine: args.targetLine,
      recordPath: input.relativePath,
      indexUpdated: true
    };
  } catch (error) {
    let manualRepairRequired = false;
    if (bodyUpdated) {
      try {
        if (oldRecordExisted) fs2.truncateSync(input.recordPath, oldSize);
        else fs2.rmSync(input.recordPath);
        if (indexExisted) fs2.writeFileSync(indexPath, oldIndex, "utf8");
        else fs2.rmSync(indexPath, { force: true });
      } catch {
        manualRepairRequired = true;
      }
    }
    const message = error instanceof Error ? error.message : String(error);
    atomicWriteJson(paths.statePath, {
      ...state,
      consecutiveFailures: (state.consecutiveFailures ?? 0) + 1,
      lastError: {
        attemptId: args.attemptId,
        at: (/* @__PURE__ */ new Date()).toISOString(),
        phase: "commit",
        message,
        logPath: paths.logPath,
        manualRepairRequired,
        recordPath: input.relativePath,
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
