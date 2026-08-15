#!/usr/bin/env node

// src/prepare-chat-recording.ts
import { execFileSync } from "node:child_process";
import fs3 from "node:fs";
import path3 from "node:path";
import { fileURLToPath as fileURLToPath2 } from "node:url";

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

// src/extract-conversation.ts
import fs2 from "node:fs";
import path2 from "node:path";
import { fileURLToPath } from "node:url";
var quote = (text) => text.split("\n").map((line) => line === "" ? ">" : `> ${line}`).join("\n");
function extractConversation(content, sinceLine = 0, targetLine = Number.POSITIVE_INFINITY, workerName = "unknown") {
  const sections = [];
  const push = (role, part) => {
    const last = sections.at(-1);
    if (last?.role === role) last.parts.push(part);
    else sections.push({ role, parts: [part] });
  };
  let lineNo = 0;
  for (const line of content.split("\n")) {
    lineNo++;
    if (lineNo <= sinceLine) continue;
    if (lineNo > targetLine) break;
    if (!line.trim()) continue;
    let entry;
    try {
      entry = JSON.parse(line);
    } catch {
      continue;
    }
    const message = entry.message;
    if (!message || entry.isSidechain) continue;
    if (entry.type === "user" && typeof message.content === "string") {
      const text = message.content.trim();
      if (!text || text.startsWith("<") || entry.isMeta) continue;
      push("USER", quote(text));
    } else if (entry.type === "assistant" && Array.isArray(message.content)) {
      for (const part of message.content)
        if (part.type === "text" && part.text?.trim())
          push("ASSISTANT", part.text.trim());
    }
  }
  return sections.map(
    (section) => `# ${section.role === "USER" ? workerName : "AI"}

${section.parts.join("\n\n")}`
  ).join("\n\n");
}
function extractConversationFile(file, sinceLine = 0, targetLine = Number.POSITIVE_INFINITY, workerName = "unknown") {
  return extractConversation(
    fs2.readFileSync(file, "utf8"),
    sinceLine,
    targetLine,
    workerName
  );
}
function main() {
  const args = process.argv.slice(2);
  const file = args[0];
  if (!file || file.startsWith("--") || !fs2.existsSync(file)) {
    console.error(
      "usage: node extract-conversation.mjs <transcript.jsonl> [--since-line <N>] [--worker <name>]"
    );
    process.exitCode = 1;
    return;
  }
  const sinceIndex = args.indexOf("--since-line");
  const sinceLine = sinceIndex === -1 ? 0 : Math.max(0, Number(args[sinceIndex + 1]) || 0);
  const workerIndex = args.indexOf("--worker");
  const workerName = workerIndex === -1 ? "unknown" : args[workerIndex + 1] ?? "unknown";
  console.log(
    extractConversationFile(
      file,
      sinceLine,
      Number.POSITIVE_INFINITY,
      workerName
    )
  );
}
if (process.argv[1] && fileURLToPath(import.meta.url) === pathResolve(process.argv[1]) && path2.basename(process.argv[1]).startsWith("extract-conversation."))
  main();
function pathResolve(value) {
  return fs2.realpathSync(value);
}

// src/prepare-chat-recording.ts
var fail = (message) => {
  throw new Error(message);
};
function parseArgs(argv) {
  const value = (name) => {
    const index = argv.indexOf(name);
    if (index === -1 || !argv[index + 1]) fail(`missing ${name}`);
    return argv[index + 1];
  };
  const targetLine = Number(value("--target-line"));
  if (!Number.isSafeInteger(targetLine) || targetLine <= 0)
    fail("invalid --target-line");
  return {
    project: path3.resolve(value("--project")),
    transcript: path3.resolve(value("--transcript")),
    sessionKey: value("--session-key"),
    attemptId: value("--attempt-id"),
    targetLine
  };
}
function gitUser(project) {
  try {
    return execFileSync("git", ["-C", project, "config", "user.name"], {
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"]
    }).trim() || "unknown";
  } catch {
    return "unknown";
  }
}
var safeWorker = (name) => {
  const normalized = name.replaceAll(/[\\/]/g, "-").replaceAll("..", "-").trim();
  return normalized && normalized !== "." ? normalized : "unknown";
};
function markdownFiles(dir) {
  if (!fs3.existsSync(dir)) return [];
  return fs3.readdirSync(dir, { withFileTypes: true }).filter((entry) => entry.isFile() && entry.name.endsWith(".md")).map((entry) => path3.join(dir, entry.name)).sort();
}
function lastSessionNumber(text) {
  let result = 0;
  for (const match of text.matchAll(/^##\s*セッション\s*(\d+)/gm))
    result = Math.max(result, Number(match[1]));
  return result;
}
function cleanStaleTemp(tempDir, sessionKey, attemptId) {
  let entries;
  try {
    entries = fs3.readdirSync(tempDir);
  } catch {
    return;
  }
  for (const name of entries) {
    if (!name.startsWith(`${sessionKey}-`) || name.includes(attemptId)) continue;
    try {
      fs3.rmSync(path3.join(tempDir, name), { force: true });
    } catch {
    }
  }
}
function prepareChatRecording(args) {
  if (!fs3.existsSync(args.project) || !fs3.statSync(args.project).isDirectory())
    fail("project directory does not exist");
  const paths = getStatePaths(args.project, args.sessionKey);
  const state = readJson(paths.statePath);
  const lock = readJson(paths.lockPath);
  const planPath = path3.join(paths.planDir, `${args.sessionKey}.json`);
  const plan = readJson(planPath);
  if (!state || !lock || !plan) throw new Error("attempt/lock/plan missing");
  if (state.attemptId !== args.attemptId || lock.attemptId !== args.attemptId || plan.attemptId !== args.attemptId || lock.targetLine !== args.targetLine || plan.targetLine !== args.targetLine)
    fail("attempt/lock/plan mismatch");
  if (!fs3.existsSync(args.transcript) || path3.resolve(state.transcriptPath) !== args.transcript)
    fail("transcript does not match the hook-approved path");
  if (args.targetLine <= state.recordedLine)
    fail("target line is already recorded");
  updateHeartbeat(paths.lockPath, args.attemptId);
  cleanStaleTemp(paths.tempDir, args.sessionKey, args.attemptId);
  const workerName = gitUser(args.project);
  const now = /* @__PURE__ */ new Date();
  const year = String(now.getFullYear());
  const monthDay = `${String(now.getMonth() + 1).padStart(2, "0")}${String(now.getDate()).padStart(2, "0")}`;
  const recordDir = path3.join(
    args.project,
    "docs",
    "chat",
    year,
    monthDay,
    safeWorker(workerName)
  );
  const candidates = markdownFiles(recordDir);
  const chatRoot = path3.join(args.project, "docs", "chat");
  const previous = state.recordPath ? path3.resolve(args.project, state.recordPath) : null;
  const resumable = previous && isInside(chatRoot, previous) && fs3.existsSync(previous) ? previous : null;
  const selected = resumable ?? (candidates.length === 1 ? candidates[0] : null);
  const relativeCandidates = candidates.map(
    (file) => path3.relative(args.project, file).replaceAll("\\", "/")
  );
  const relativePath = selected ? path3.relative(args.project, selected).replaceAll("\\", "/") : null;
  const docsRelativePath = relativePath?.replace(/^docs\/chat\//, "") ?? null;
  const recordText = selected ? fs3.readFileSync(selected, "utf8") : "";
  const tailContext = selected ? recordText.split("\n").slice(-60).join("\n") : "";
  const indexPath = path3.join(args.project, "docs", "chat", "INDEX.md");
  const indexLines = fs3.existsSync(indexPath) ? fs3.readFileSync(indexPath, "utf8").split("\n") : [];
  const indexLine = relativePath ? indexLines.find((line) => line.includes(docsRelativePath)) ?? "" : "";
  const skillPath = path3.join(
    path3.dirname(fileURLToPath2(import.meta.url)),
    "..",
    "skills",
    "chat",
    "SKILL.md"
  );
  const pluginSkillPath = process.env.CLAUDE_PLUGIN_ROOT ? path3.join(process.env.CLAUDE_PLUGIN_ROOT, "skills", "chat", "SKILL.md") : path3.resolve(skillPath);
  if (!fs3.existsSync(pluginSkillPath)) fail("chat SKILL.md not found");
  const recordTarget = {
    relativePath,
    appendMode: relativePath !== null
  };
  const allowedNewRecordDir = path3.relative(args.project, recordDir).replaceAll("\\", "/");
  const newRecordPathExample = `${allowedNewRecordDir}/conversation-topic.md`;
  const bodyFile = path3.join(
    paths.tempDir,
    `${args.sessionKey}-${args.attemptId}.body.md`
  );
  const indexLineFile = path3.join(
    paths.tempDir,
    `${args.sessionKey}-${args.attemptId}.index-line.md`
  );
  const sessionTitleFile = path3.join(
    paths.tempDir,
    `${args.sessionKey}-${args.attemptId}.session-title.md`
  );
  const headerFile = path3.join(
    paths.tempDir,
    `${args.sessionKey}-${args.attemptId}.header.md`
  );
  const conversation = extractConversationFile(
    args.transcript,
    state.recordedLine,
    args.targetLine,
    safeWorker(workerName)
  );
  const previousSessionNumber = lastSessionNumber(recordText);
  const sessionNumber = previousSessionNumber + 1;
  fs3.mkdirSync(paths.tempDir, { recursive: true, mode: 448 });
  fs3.writeFileSync(
    bodyFile,
    conversation.endsWith("\n") ? conversation : `${conversation}
`,
    { encoding: "utf8", mode: 384 }
  );
  atomicWriteJson(planPath, {
    ...plan,
    recordTarget,
    recordCandidates: relativeCandidates,
    allowedNewRecordDir,
    sessionNumber,
    preparedAt: (/* @__PURE__ */ new Date()).toISOString()
  });
  return {
    version: 1,
    attemptId: args.attemptId,
    recordedLine: state.recordedLine,
    targetLine: args.targetLine,
    workerName,
    date: `${year}-${monthDay.slice(0, 2)}-${monthDay.slice(2)}`,
    conversation,
    skillContract: fs3.readFileSync(pluginSkillPath, "utf8"),
    recordTarget,
    recordCandidates: relativeCandidates,
    allowedNewRecordDir,
    newRecordPathExample,
    bodyFile,
    indexLineFile,
    sessionTitleFile,
    headerFile,
    sessionNumber,
    indexEntryPath: docsRelativePath,
    indexLineExample: docsRelativePath ? `- \`${docsRelativePath}\` | ${year}-${monthDay.slice(0, 2)}-${monthDay.slice(2)} | ${workerName} | <\u8981\u65E8>` : `- \`YYYY/MMDD/<worker>/<kebab-case>.md\` | YYYY-MM-DD | <worker> | <\u8981\u65E8>`,
    lastSessionNumber: previousSessionNumber,
    tailContext,
    indexLine,
    metadataHints: plan.metadataHints
  };
}
function main2() {
  try {
    console.log(
      JSON.stringify(prepareChatRecording(parseArgs(process.argv.slice(2))))
    );
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  }
}
if (process.argv[1] && fs3.realpathSync(process.argv[1]) === fileURLToPath2(import.meta.url))
  main2();
export {
  prepareChatRecording,
  safeWorker
};
