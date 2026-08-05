#!/usr/bin/env node

// src/hooks/check-chat-recorded.ts
import fs2 from "node:fs";
import path2 from "node:path";
import { fileURLToPath } from "node:url";

// src/chat-recording-state.ts
import { createHash, randomUUID } from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
var NAG_MARKER = "<!--chat-recorder-nag-->";
var STATE_VERSION = 2;
var MAX_TOOL_HINTS = 20;
var MAX_TOOL_HINT_LENGTH = 120;
var LOCK_GRACE_MS = 12e4;
var LOCK_STALE_MS = 6e5;
var RECORDER_AGENT_NAME = "chat-recorder";
var normalizePath = (value) => {
  const resolved = path.resolve(value);
  return process.platform === "win32" ? resolved.replaceAll("\\", "/").replace(/^[A-Z]:/, (drive) => drive.toLowerCase()) : resolved;
};
var hashKey = (value) => createHash("sha256").update(value).digest("hex").slice(0, 24);
function getSessionKey(sessionId, transcriptPath) {
  return sessionId ? hashKey(`session:${sessionId}`) : hashKey(`transcript:${normalizePath(transcriptPath)}`);
}
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
function assertPrivateTempDir(dir) {
  const stat = fs.lstatSync(dir);
  if (stat.isSymbolicLink() || !stat.isDirectory())
    throw new Error(`chat-recorder temp dir is not a real directory: ${dir}`);
  const uid = currentUid();
  if (uid !== null && stat.uid !== uid)
    throw new Error(`chat-recorder temp dir is not owned by this user: ${dir}`);
  if (process.platform !== "win32") fs.chmodSync(dir, 448);
}
function ensureStateDirs(paths) {
  for (const dir of [
    paths.stateDir,
    paths.lockDir,
    paths.logDir,
    paths.tempDir,
    paths.planDir
  ])
    fs.mkdirSync(dir, { recursive: true, mode: 448 });
  assertPrivateTempDir(paths.tempDir);
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
function transcriptIdentity(file) {
  const stat = fs.statSync(file);
  return {
    dev: Number.isSafeInteger(stat.dev) ? stat.dev : void 0,
    ino: Number.isSafeInteger(stat.ino) ? stat.ino : void 0
  };
}
function sanitizeHint(value) {
  const withoutControls = [...String(value)].map((character) => {
    const code = character.codePointAt(0) ?? 0;
    return code <= 31 || code >= 127 && code <= 159 ? " " : character;
  }).join("");
  return withoutControls.replace(/\s+/g, " ").trim().slice(0, MAX_TOOL_HINT_LENGTH);
}
function isRecorderDispatch(name, subagentType) {
  if (name !== "Agent") return false;
  const normalized = String(subagentType).split(":").at(-1)?.toLowerCase();
  return normalized === RECORDER_AGENT_NAME;
}
function toolHint(content) {
  const input = content.input;
  const detail = content.name === "Bash" ? input?.description : content.name === "Agent" ? [input?.subagent_type, input?.description].filter(Boolean).join(" \u2014 ") : input?.file_path ?? input?.description;
  return sanitizeHint(
    `${content.name ?? "unknown"}${detail ? ` \u2014 ${detail}` : ""}`
  );
}
function scanTranscript(file, sinceLine = 0) {
  let lineCount = 0;
  let lastUserTurn = -1;
  let lastNag = -1;
  const hints = [];
  const seenHints = /* @__PURE__ */ new Set();
  for (const line of fs.readFileSync(file, "utf8").split("\n")) {
    lineCount++;
    if (!line.trim()) continue;
    let entry;
    try {
      entry = JSON.parse(line);
    } catch {
      continue;
    }
    if (!entry.message || entry.isSidechain) continue;
    if (entry.type === "user" && typeof entry.message.content === "string") {
      const text = entry.message.content.trim();
      if (text.includes(NAG_MARKER)) lastNag = lineCount;
      else if (text && !text.startsWith("<") && !entry.isMeta)
        lastUserTurn = lineCount;
      continue;
    }
    if (entry.type !== "assistant" || !Array.isArray(entry.message.content) || lineCount <= sinceLine)
      continue;
    for (const content of entry.message.content) {
      if (content.type !== "tool_use" || isRecorderDispatch(content.name, content.input?.subagent_type))
        continue;
      const hint = toolHint(content);
      if (hint && !seenHints.has(hint) && hints.length < MAX_TOOL_HINTS) {
        hints.push(hint);
        seenHints.add(hint);
      }
    }
  }
  return {
    lineCount,
    lastUserTurn,
    lastNag,
    toolHints: hints,
    identity: transcriptIdentity(file)
  };
}
function createInitialState(projectDir, transcriptPath, identity, sessionId) {
  return {
    version: STATE_VERSION,
    projectDir,
    sessionId,
    transcriptPath,
    transcriptIdentity: identity,
    recordedLine: 0,
    attemptedLine: 0,
    lastError: null,
    lastNotifiedAttemptId: null
  };
}
var isObject = (value) => typeof value === "object" && value !== null && !Array.isArray(value);
var isString = (value) => typeof value === "string";
var isNonNegativeInteger = (value) => Number.isSafeInteger(value) && Number(value) >= 0;
function validIdentity(value) {
  if (!isObject(value)) return null;
  const dev = value.dev;
  const ino = value.ino;
  if (dev !== void 0 && !Number.isSafeInteger(dev) || ino !== void 0 && !Number.isSafeInteger(ino))
    return null;
  return {
    dev: dev === void 0 ? void 0 : Number(dev),
    ino: ino === void 0 ? void 0 : Number(ino)
  };
}
function migrateState(raw, fallback) {
  if (!isObject(raw)) return fallback;
  if (raw.version === STATE_VERSION) return raw;
  const identity = validIdentity(raw.transcriptIdentity);
  const recordedLine = isNonNegativeInteger(raw.recordedLine) ? raw.recordedLine : fallback.recordedLine;
  return {
    ...fallback,
    version: STATE_VERSION,
    projectDir: isString(raw.projectDir) ? raw.projectDir : fallback.projectDir,
    sessionId: isString(raw.sessionId) ? raw.sessionId : fallback.sessionId,
    transcriptPath: isString(raw.transcriptPath) ? raw.transcriptPath : fallback.transcriptPath,
    transcriptIdentity: identity ?? fallback.transcriptIdentity,
    recordedLine,
    attemptedLine: recordedLine,
    lastSuccessAt: isString(raw.lastSuccessAt) ? raw.lastSuccessAt : fallback.lastSuccessAt,
    recordPath: isString(raw.recordPath) ? raw.recordPath : fallback.recordPath,
    lastError: null,
    lastNotifiedAttemptId: null
  };
}
var identityChanged = (previous, current) => previous.dev !== void 0 && previous.ino !== void 0 && current.dev !== void 0 && current.ino !== void 0 && (previous.dev !== current.dev || previous.ino !== current.ino);
function reconcileGeneration(state, scan) {
  const changed = identityChanged(state.transcriptIdentity, scan.identity) || scan.lineCount < state.recordedLine || scan.lastUserTurn !== -1 && scan.lastUserTurn < state.recordedLine;
  if (!changed)
    return {
      state: { ...state, transcriptIdentity: scan.identity },
      changed: false
    };
  return {
    changed: true,
    state: {
      ...state,
      previousGeneration: {
        recordedLine: state.recordedLine,
        attemptedLine: state.attemptedLine,
        transcriptIdentity: state.transcriptIdentity
      },
      transcriptIdentity: scan.identity,
      recordedLine: 0,
      attemptedLine: 0,
      attemptId: void 0,
      attemptStartedAt: void 0,
      // recordedLine が 0 に戻るため、前世代の記録先を引き継ぐと同じファイルへ
      // 会話全体を再記録してしまう。記録先も一緒に手放す。
      recordPath: void 0
    }
  };
}
var FINISHED_TASK_STATUSES = /* @__PURE__ */ new Set([
  "completed",
  "failed",
  "cancelled",
  "canceled",
  "stopped",
  "error",
  "done"
]);
function hasRunningRecorder(tasks) {
  if (!Array.isArray(tasks)) return void 0;
  return tasks.some((task) => {
    if (typeof task !== "object" || task === null) return false;
    if (task.type !== "subagent") return false;
    const agentName = String(task.agent_type).split(":").at(-1)?.toLowerCase();
    if (agentName !== RECORDER_AGENT_NAME) return false;
    return !FINISHED_TASK_STATUSES.has(String(task.status).toLowerCase());
  });
}
function isStaleLock(lock, state, options = {}) {
  if (!lock || lock.version !== STATE_VERSION || !lock.attemptId || lock.attemptId !== state.attemptId)
    return true;
  const created = Date.parse(lock.createdAt);
  const heartbeat = Date.parse(lock.heartbeatAt);
  if (!Number.isFinite(created) || !Number.isFinite(heartbeat)) return true;
  if (options.recorderRunning === true) return false;
  const maxAge = options.recorderRunning === false ? LOCK_GRACE_MS : LOCK_STALE_MS;
  return (options.now ?? Date.now()) - heartbeat > maxAge;
}
function decideRecordingAction(scan, state, context) {
  if (scan.lastUserTurn === -1)
    return { action: "noop", reason: "no-user-turn" };
  if (scan.lastUserTurn <= state.recordedLine)
    return { action: "noop", reason: "already-recorded" };
  if (context.recorderRunning === true)
    return { action: "noop", reason: "recorder-running" };
  if (context.hasActiveLock) return { action: "noop", reason: "active-lock" };
  if (state.attemptedLine >= scan.lastUserTurn)
    return state.lastError && state.lastNotifiedAttemptId !== state.lastError.attemptId ? { action: "notify", reason: "failed-attempt" } : { action: "noop", reason: "already-attempted" };
  return {
    action: "dispatch",
    targetLine: scan.lastUserTurn,
    notify: state.lastError !== null && state.lastNotifiedAttemptId !== state.lastError.attemptId
  };
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
function acquireLock(lockPath, targetLine) {
  const now = (/* @__PURE__ */ new Date()).toISOString();
  const lock = {
    version: STATE_VERSION,
    attemptId: randomUUID(),
    targetLine,
    createdAt: now,
    heartbeatAt: now
  };
  fs.mkdirSync(path.dirname(lockPath), { recursive: true, mode: 448 });
  fs.writeFileSync(lockPath, `${JSON.stringify(lock, null, 2)}
`, {
    encoding: "utf8",
    mode: 384,
    flag: "wx"
  });
  return lock;
}
function isInside(parent, candidate) {
  const relative = path.relative(path.resolve(parent), path.resolve(candidate));
  return relative !== "" && !relative.startsWith("..") && !path.isAbsolute(relative);
}

// src/hooks/check-chat-recorded.ts
var MAX_INJECT_CHARS = 1200;
function readInput() {
  try {
    return JSON.parse(fs2.readFileSync(0, "utf8"));
  } catch {
    return null;
  }
}
function renderInjection(values, maxChars = MAX_INJECT_CHARS) {
  const required = [
    NAG_MARKER,
    "[task-utility] \u3053\u306E\u4F1A\u8A71\u306B\u306F docs/chat/ \u306B\u672A\u8A18\u9332\u306E\u30BF\u30FC\u30F3\u304C\u3042\u308B\u3002",
    `- projectDir: ${values.projectDir}`,
    `- transcriptPath: ${values.transcriptPath}`,
    `- sessionKey: ${values.sessionKey}`,
    `- attemptId: ${values.attemptId}`,
    `- targetLine: ${values.targetLine}`,
    `- pluginRoot: ${values.pluginRoot}`
  ];
  const supplemental = [
    '\u3053\u306E\u30D7\u30ED\u30B8\u30A7\u30AF\u30C8\u306E\u8A18\u9332\u904B\u7528\u3067\u306F\u3001\u30E1\u30A4\u30F3\u30A8\u30FC\u30B8\u30A7\u30F3\u30C8\u306F\u3053\u306E\u901A\u77E5\u3092\u53D7\u3051\u53D6\u3063\u305F\u6642\u70B9\u3067\u3001\u4E0A\u8A18\u306E\u5024\u3092\u305D\u306E\u307E\u307E\u6E21\u3057\u3066 Agent \u30C4\u30FC\u30EB\u306E subagent_type "task-utility:chat-recorder" \u3092 run_in_background: true \u3067\u8D77\u52D5\u3057\u3001\u305D\u306E\u5B8C\u4E86\u3092\u5F85\u305F\u305A\u306B\u73FE\u5728\u306E\u30BF\u30FC\u30F3\u3092\u7D42\u3048\u308B\u3002\u8A18\u9332\u306E\u624B\u9806\u3068\u30D5\u30A9\u30FC\u30DE\u30C3\u30C8\u5951\u7D04\u306F chat-recorder \u5074\u306E\u5B9A\u7FA9\u306B\u542B\u307E\u308C\u3066\u304A\u308A\u3001\u30E1\u30A4\u30F3\u5074\u3067\u4F1A\u8A71\u672C\u6587\u3092\u8AAD\u3093\u3060\u308A docs/chat/ \u3092\u7DE8\u96C6\u3057\u305F\u308A\u3059\u308B\u3053\u3068\u306F\u624B\u9806\u306B\u542B\u307E\u308C\u306A\u3044\u3002',
    "\u8A18\u9332\u306E\u7D50\u679C\u306F docs/chat/ \u914D\u4E0B\u306E\u30D5\u30A1\u30A4\u30EB\u3068 INDEX.md \u306B\u306E\u307F\u53CD\u6620\u3055\u308C\u3001\u30E6\u30FC\u30B6\u30FC\u3078\u306E\u5FDC\u7B54\u6587\u306B\u306F\u73FE\u308C\u306A\u3044\u3002\u8A18\u9332\u306B\u95A2\u3059\u308B\u8A00\u53CA\u30FB\u5B8C\u4E86\u5831\u544A\u306F\u5FDC\u7B54\u306E\u69CB\u6210\u8981\u7D20\u3067\u306F\u306A\u3044\u3002",
    "attemptId \u304C\u73FE\u5728\u306E\u8A18\u9332\u8A66\u884C\u3068\u4E00\u81F4\u3057\u306A\u3044\u901A\u77E5(\u904E\u53BB\u306E\u30BB\u30C3\u30B7\u30E7\u30F3\u306E\u518D\u751F\u3092\u542B\u3080)\u306F\u65E2\u306B\u5931\u52B9\u3057\u3066\u304A\u308A\u3001\u5BFE\u8C61\u3067\u306F\u306A\u3044\u3002"
  ];
  const lines = [...required, ...supplemental];
  while (lines.length > required.length && lines.join("\n").length > maxChars)
    lines.pop();
  return lines.join("\n").slice(0, maxChars);
}
function notificationMessage(state) {
  if (!state.lastError) return void 0;
  return `chat-recorder \u306E\u524D\u56DE\u5B9F\u884C\u306B\u5931\u6557\u3057\u307E\u3057\u305F\u3002\u30ED\u30B0: ${state.lastError.logPath} (${state.lastError.message})`;
}
function outputNotification(state) {
  const systemMessage = notificationMessage(state);
  if (!systemMessage) return false;
  console.log(JSON.stringify({ systemMessage }));
  return true;
}
async function main() {
  const input = readInput();
  if (!input || input.stop_hook_active) return;
  const projectDir = path2.resolve(
    process.env.CLAUDE_PROJECT_DIR || input.cwd || process.cwd()
  );
  if (!fs2.existsSync(path2.join(projectDir, "docs", "chat"))) return;
  const transcriptPath = input.transcript_path;
  if (!transcriptPath || !fs2.existsSync(transcriptPath)) return;
  const sessionKey = getSessionKey(input.session_id, transcriptPath);
  const paths = getStatePaths(projectDir, sessionKey);
  try {
    ensureStateDirs(paths);
  } catch (error) {
    console.log(
      JSON.stringify({
        systemMessage: `chat-recorder \u306E\u4F5C\u696D\u30C7\u30A3\u30EC\u30AF\u30C8\u30EA\u3092\u6E96\u5099\u3067\u304D\u307E\u305B\u3093\u3067\u3057\u305F: ${error instanceof Error ? error.message : String(error)}`
      })
    );
    return;
  }
  const fullScan = scanTranscript(transcriptPath);
  if (fullScan.lastNag > fullScan.lastUserTurn) return;
  const fallback = createInitialState(
    projectDir,
    transcriptPath,
    fullScan.identity,
    input.session_id
  );
  let state = migrateState(readJson(paths.statePath), fallback);
  const generation = reconcileGeneration(state, fullScan);
  state = generation.state;
  const scan = scanTranscript(transcriptPath, state.recordedLine);
  atomicWriteJson(paths.statePath, state);
  const recorderRunning = hasRunningRecorder(input.background_tasks);
  let activeLock = false;
  if (fs2.existsSync(paths.lockPath)) {
    const lock2 = readJson(paths.lockPath);
    if (isStaleLock(lock2, state, { recorderRunning })) {
      appendLog(
        paths.logPath,
        `[hook] recovered stale lock: ${fs2.readFileSync(paths.lockPath, "utf8").trim()}`
      );
      fs2.rmSync(paths.lockPath, { force: true });
      state = {
        ...state,
        lastError: {
          attemptId: lock2?.attemptId ?? state.attemptId ?? "unknown",
          at: (/* @__PURE__ */ new Date()).toISOString(),
          phase: "stale-lock",
          message: "background recorder did not complete",
          logPath: paths.logPath
        }
      };
      atomicWriteJson(paths.statePath, state);
    } else activeLock = true;
  }
  const decision = decideRecordingAction(scan, state, {
    hasActiveLock: activeLock,
    recorderRunning
  });
  if (decision.action === "noop") return;
  if (decision.action === "notify") {
    if (outputNotification(state))
      atomicWriteJson(paths.statePath, {
        ...state,
        lastNotifiedAttemptId: state.lastError?.attemptId ?? null
      });
    return;
  }
  let lock;
  try {
    lock = acquireLock(paths.lockPath, decision.targetLine);
  } catch {
    return;
  }
  const planPath = path2.join(paths.planDir, `${sessionKey}.json`);
  atomicWriteJson(planPath, {
    version: 1,
    attemptId: lock.attemptId,
    targetLine: decision.targetLine,
    metadataHints: scan.toolHints
  });
  const stagedState = {
    ...state,
    attemptId: lock.attemptId,
    attemptStartedAt: lock.createdAt,
    attemptedLine: decision.targetLine,
    lastNotifiedAttemptId: decision.notify && state.lastError ? state.lastError.attemptId : state.lastNotifiedAttemptId
  };
  atomicWriteJson(paths.statePath, stagedState);
  const pluginRoot = process.env.CLAUDE_PLUGIN_ROOT || path2.resolve(
    import.meta.dirname,
    path2.basename(import.meta.dirname) === "scripts" ? ".." : "../.."
  );
  const additionalContext = renderInjection({
    projectDir,
    transcriptPath,
    sessionKey,
    attemptId: lock.attemptId,
    targetLine: decision.targetLine,
    pluginRoot
  });
  const output = {
    hookSpecificOutput: {
      hookEventName: "Stop",
      additionalContext
    }
  };
  if (decision.notify) output.systemMessage = notificationMessage(state);
  console.log(JSON.stringify(output));
}
try {
  if (process.argv[1] && fs2.realpathSync(process.argv[1]) === fs2.realpathSync(fileURLToPath(import.meta.url)))
    await main();
} catch {
  process.exitCode = 0;
}
export {
  MAX_INJECT_CHARS,
  renderInjection
};
