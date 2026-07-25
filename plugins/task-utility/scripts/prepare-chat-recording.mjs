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
var MAX_TOOL_HINT = 120;
var quote = (text) => text.split("\n").map((line) => line === "" ? ">" : `> ${line}`).join("\n");
function extractConversation(content, sinceLine = 0, targetLine = Number.POSITIVE_INFINITY) {
  const sections = [];
  const push = (role, part) => {
    const last = sections.at(-1);
    if (last?.role === role) last.parts.push(part);
    else sections.push({ role, parts: [part] });
  };
  let lineNo = 0;
  let seenUser = sinceLine <= 0;
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
      seenUser = true;
      push("USER", quote(text));
    } else if (entry.type === "assistant" && Array.isArray(message.content) && seenUser) {
      for (const part of message.content) {
        if (part.type === "text" && part.text?.trim()) {
          push("ASSISTANT", part.text.trim());
        } else if (part.type === "tool_use") {
          const hint = part.input?.description ?? part.input?.file_path ?? "";
          push(
            "ASSISTANT",
            `(tool: ${part.name}${hint ? ` \u2014 ${String(hint).slice(0, MAX_TOOL_HINT)}` : ""})`
          );
        }
      }
    }
  }
  return sections.map((section) => `## ${section.role}

${section.parts.join("\n\n")}`).join("\n\n---\n\n");
}
function extractConversationFile(file, sinceLine = 0, targetLine = Number.POSITIVE_INFINITY) {
  return extractConversation(
    fs2.readFileSync(file, "utf8"),
    sinceLine,
    targetLine
  );
}
function main() {
  const args = process.argv.slice(2);
  const file = args[0];
  if (!file || file.startsWith("--") || !fs2.existsSync(file)) {
    console.error(
      "usage: node extract-conversation.mjs <transcript.jsonl> [--since-line <N>]"
    );
    process.exitCode = 1;
    return;
  }
  const sinceIndex = args.indexOf("--since-line");
  const sinceLine = sinceIndex === -1 ? 0 : Math.max(0, Number(args[sinceIndex + 1]) || 0);
  console.log(extractConversationFile(file, sinceLine));
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
function tailLines(file, count) {
  return fs3.readFileSync(file, "utf8").split("\n").slice(-count).join("\n");
}
function lastSessionNumber(text) {
  let result = 0;
  for (const match of text.matchAll(/^## セッション\s+(\d+)/gm))
    result = Math.max(result, Number(match[1]));
  return result;
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
  const tailContext = selected ? tailLines(selected, 60) : "";
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
  atomicWriteJson(planPath, {
    ...plan,
    recordTarget,
    recordCandidates: relativeCandidates,
    allowedNewRecordDir,
    preparedAt: (/* @__PURE__ */ new Date()).toISOString()
  });
  return {
    version: 1,
    attemptId: args.attemptId,
    recordedLine: state.recordedLine,
    targetLine: args.targetLine,
    workerName,
    date: `${year}-${monthDay.slice(0, 2)}-${monthDay.slice(2)}`,
    conversation: extractConversationFile(
      args.transcript,
      state.recordedLine,
      args.targetLine
    ),
    skillContract: fs3.readFileSync(pluginSkillPath, "utf8"),
    recordTarget,
    recordCandidates: relativeCandidates,
    allowedNewRecordDir,
    newRecordPathExample,
    indexEntryPath: docsRelativePath,
    indexLineExample: docsRelativePath ? `- \`${docsRelativePath}\` | ${year}-${monthDay.slice(0, 2)}-${monthDay.slice(2)} | ${workerName} | <\u8981\u65E8>` : `- \`YYYY/MMDD/<worker>/<kebab-case>.md\` | YYYY-MM-DD | <worker> | <\u8981\u65E8>`,
    lastSessionNumber: lastSessionNumber(tailContext),
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
