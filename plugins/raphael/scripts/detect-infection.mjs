#!/usr/bin/env node

// src/lib/command-log.ts
import fs2 from "node:fs";
import path2 from "node:path";

// src/lib/hook-io.ts
import fs from "node:fs";
import path from "node:path";
function readStdinSync() {
  try {
    const value = JSON.parse(fs.readFileSync(0, "utf8"));
    return typeof value === "object" && value !== null && !Array.isArray(value) ? value : null;
  } catch {
    return null;
  }
}
function resolveProjectDir(input) {
  return process.env.CLAUDE_PROJECT_DIR || input.cwd || process.cwd();
}
function logError(projectDir, context, error) {
  try {
    const logDir = path.join(projectDir, ".raphael", "log");
    fs.mkdirSync(logDir, { recursive: true });
    const message = error instanceof Error ? error.stack ?? error.message : String(error);
    fs.appendFileSync(
      path.join(logDir, "errors.log"),
      `${(/* @__PURE__ */ new Date()).toISOString()} [${context}] ${message}
`
    );
  } catch {
  }
}

// src/lib/command-log.ts
function commandLogPath(projectDir) {
  return path2.join(projectDir, ".raphael", "commands.jsonl");
}
function appendCommandLog(projectDir, entry) {
  try {
    if (!isCommandLogEntry(entry)) return;
    const filePath = commandLogPath(projectDir);
    fs2.mkdirSync(path2.dirname(filePath), { recursive: true });
    fs2.appendFileSync(filePath, `${JSON.stringify(entry)}
`, "utf8");
  } catch (error) {
    logError(projectDir, "command-log", error);
  }
}
function isCommandLogEntry(value) {
  return typeof value === "object" && value !== null && !Array.isArray(value) && typeof value.ts === "string" && typeof value.session === "string" && typeof value.normalized_command === "string" && (value.exit_code === null || typeof value.exit_code === "number" && Number.isInteger(value.exit_code)) && typeof value.failed === "boolean";
}

// src/lib/config.ts
import fs3 from "node:fs";
import path3 from "node:path";
var DEFAULT_CONFIG = {
  detectCommandFailure: true,
  detectRetryLoop: true,
  detectUserRejection: true,
  detectEditChurn: true,
  retryThreshold: 3,
  editChurnThreshold: 3,
  distillThreshold: 3,
  defaultExpiryDays: 30,
  maxInjections: 3,
  rejectionPatterns: [],
  benignExit1Commands: [],
  benignExit1Extended: true,
  breadthMaxRatio: 10,
  breadthMinCorpus: 50,
  missWindowMinutes: 30,
  ineffectiveMinFired: 10,
  ineffectiveMissRatio: 50,
  antibodiesGitPolicy: "commit"
};
function configPath(projectDir) {
  return path3.join(projectDir, ".claude", "raphael.local.md");
}
function parseFrontmatter(raw) {
  const match = raw.match(/^---\r?\n([\s\S]*?)\r?\n---(?:\r?\n|$)/);
  if (!match) return null;
  const entries = /* @__PURE__ */ new Map();
  for (const line of match[1].split(/\r?\n/)) {
    if (line.trim() === "") continue;
    const field = line.match(/^([a-z0-9_]+):(?:\s?(.*))$/);
    if (!field) return null;
    entries.set(field[1], field[2]);
  }
  return entries;
}
function booleanValue(value) {
  if (value === "true") return true;
  if (value === "false") return false;
  return null;
}
function integerInRange(value, minimum, maximum) {
  if (!value || !/^-?\d+$/.test(value)) return null;
  const parsed = Number(value);
  return Number.isSafeInteger(parsed) && parsed >= minimum && parsed <= maximum ? parsed : null;
}
function stringArray(value) {
  if (value === void 0) return null;
  try {
    const parsed = JSON.parse(value);
    return Array.isArray(parsed) && parsed.every((item) => typeof item === "string") ? parsed : null;
  } catch {
    return null;
  }
}
function gitPolicy(value) {
  return value === "commit" || value === "ignore" ? value : null;
}
function loadConfig(projectDir) {
  const config = {
    ...DEFAULT_CONFIG,
    rejectionPatterns: [...DEFAULT_CONFIG.rejectionPatterns],
    benignExit1Commands: [...DEFAULT_CONFIG.benignExit1Commands]
  };
  let raw;
  try {
    raw = fs3.readFileSync(configPath(projectDir), "utf8");
  } catch {
    return config;
  }
  const fields = parseFrontmatter(raw);
  if (!fields) return config;
  const detectCommandFailure2 = booleanValue(
    fields.get("detect_command_failure")
  );
  if (detectCommandFailure2 !== null)
    config.detectCommandFailure = detectCommandFailure2;
  const detectRetryLoop2 = booleanValue(fields.get("detect_retry_loop"));
  if (detectRetryLoop2 !== null) config.detectRetryLoop = detectRetryLoop2;
  const detectUserRejection2 = booleanValue(fields.get("detect_user_rejection"));
  if (detectUserRejection2 !== null)
    config.detectUserRejection = detectUserRejection2;
  const detectEditChurn2 = booleanValue(fields.get("detect_edit_churn"));
  if (detectEditChurn2 !== null) config.detectEditChurn = detectEditChurn2;
  const retryThreshold = integerInRange(fields.get("retry_threshold"), 2, 10);
  if (retryThreshold !== null) config.retryThreshold = retryThreshold;
  const editChurnThreshold = integerInRange(
    fields.get("edit_churn_threshold"),
    2,
    10
  );
  if (editChurnThreshold !== null)
    config.editChurnThreshold = editChurnThreshold;
  const distillThreshold = integerInRange(
    fields.get("distill_threshold"),
    1,
    100
  );
  if (distillThreshold !== null) config.distillThreshold = distillThreshold;
  const defaultExpiryDays = integerInRange(
    fields.get("default_expiry_days"),
    1,
    365
  );
  if (defaultExpiryDays !== null) config.defaultExpiryDays = defaultExpiryDays;
  const maxInjections = integerInRange(fields.get("max_injections"), 1, 10);
  if (maxInjections !== null) config.maxInjections = maxInjections;
  const rejectionPatterns = stringArray(fields.get("rejection_patterns"));
  if (rejectionPatterns !== null) config.rejectionPatterns = rejectionPatterns;
  const benignExit1Commands = stringArray(fields.get("benign_exit1_commands"));
  if (benignExit1Commands !== null)
    config.benignExit1Commands = benignExit1Commands;
  const benignExit1Extended = booleanValue(fields.get("benign_exit1_extended"));
  if (benignExit1Extended !== null)
    config.benignExit1Extended = benignExit1Extended;
  const breadthMaxRatio = integerInRange(
    fields.get("breadth_max_ratio"),
    1,
    100
  );
  if (breadthMaxRatio !== null) config.breadthMaxRatio = breadthMaxRatio;
  const breadthMinCorpus = integerInRange(
    fields.get("breadth_min_corpus"),
    1,
    5e3
  );
  if (breadthMinCorpus !== null) config.breadthMinCorpus = breadthMinCorpus;
  const missWindowMinutes = integerInRange(
    fields.get("miss_window_minutes"),
    1,
    1440
  );
  if (missWindowMinutes !== null) config.missWindowMinutes = missWindowMinutes;
  const ineffectiveMinFired = integerInRange(
    fields.get("ineffective_min_fired"),
    1,
    1e3
  );
  if (ineffectiveMinFired !== null)
    config.ineffectiveMinFired = ineffectiveMinFired;
  const ineffectiveMissRatio = integerInRange(
    fields.get("ineffective_miss_ratio"),
    1,
    100
  );
  if (ineffectiveMissRatio !== null)
    config.ineffectiveMissRatio = ineffectiveMissRatio;
  const antibodiesGitPolicy = gitPolicy(fields.get("antibodies_git_policy"));
  if (antibodiesGitPolicy !== null)
    config.antibodiesGitPolicy = antibodiesGitPolicy;
  return config;
}

// src/lib/detect-command.ts
var BUILTIN_BENIGN_EXIT1_COMMANDS = [
  "grep",
  "rg",
  "git grep",
  "diff",
  "git diff --quiet",
  "cmp",
  "test",
  "["
];
var EXTENDED_BENIGN_RUNNERS = [
  "vitest",
  "jest",
  "mocha",
  "pytest",
  "biome",
  "eslint",
  "prettier",
  "tsc"
];
var EXTENDED_BENIGN_SCRIPTS = ["test", "lint", "typecheck", "check"];
var SIGNAL_EXIT_CODES = /* @__PURE__ */ new Set([130, 137, 143]);
function normalizeCommand(command) {
  return command.trim().replace(/\s+/g, " ");
}
function extractExitCode(toolResponse, error) {
  if (isRecord(toolResponse)) {
    for (const key of ["exit_code", "exitCode", "code"]) {
      const parsed = parseExitCode(toolResponse[key]);
      if (parsed !== null) return parsed;
    }
  }
  if (typeof error === "string") {
    const match = error.match(/(?:status code|exit code)\s+(-?\d+)/i);
    if (match) return parseExitCode(match[1]);
  }
  return null;
}
function isBenignExit1Command(command, exitCode, additionalCommands = [], extendedEnabled = true) {
  const normalized = normalizeCommand(command);
  if (exitCode === 1 && [...BUILTIN_BENIGN_EXIT1_COMMANDS, ...additionalCommands].some(
    (candidate) => commandStartsWith(normalized, normalizeCommand(candidate))
  )) {
    return true;
  }
  if (!extendedEnabled || exitCode !== 1 && exitCode !== 2) return false;
  const extended = normalizeExtendedCommand(command);
  if (extended.command === "") return false;
  const tokens = extended.command.split(" ");
  const runner = tokens[0];
  if (EXTENDED_BENIGN_RUNNERS.some((candidate) => runner === candidate)) {
    return true;
  }
  return extended.scriptsEligible && EXTENDED_BENIGN_SCRIPTS.some(
    (candidate) => commandStartsWith(extended.command, candidate)
  );
}
function classifyCommandOutcome(input) {
  const exitCode = extractExitCode(input.toolResponse, input.error);
  const failedByEvent = input.hookEvent === "PostToolUseFailure";
  const failedByCode = input.hookEvent === "PostToolUse" && exitCode !== null && exitCode !== 0;
  const benign = isBenignExit1Command(
    input.command,
    exitCode,
    input.benignExit1Commands,
    input.benignExit1Extended
  );
  const signalled = exitCode !== null && SIGNAL_EXIT_CODES.has(exitCode);
  return {
    command: input.command,
    normalized_command: normalizeCommand(input.command),
    exit_code: exitCode,
    failed: (failedByEvent || failedByCode) && !benign && !signalled,
    output_tail: commandOutput(input.toolResponse, input.error)
  };
}
function detectCommandFailure(input) {
  const outcome = classifyCommandOutcome(input);
  if (!outcome.failed) return null;
  return {
    type: "command-failure",
    command: outcome.command,
    normalized_command: outcome.normalized_command,
    exit_code: outcome.exit_code,
    output_tail: outcome.output_tail
  };
}
function detectRetryLoop(command, recentCommands, threshold = 3) {
  if (!Number.isInteger(threshold) || threshold < 2) return null;
  const normalized = normalizeCommand(command);
  const trailing = recentCommands.slice(-threshold);
  if (trailing.length !== threshold || trailing.some(
    (entry) => !entry.failed || entry.normalized_command !== normalized
  )) {
    return null;
  }
  return {
    type: "retry-loop",
    command,
    normalized_command: normalized,
    consecutive_failures: threshold,
    exit_codes: trailing.map((entry) => entry.exit_code)
  };
}
function commandOutcomeFromHookInput(input, benignExit1Commands = [], benignExit1Extended = true) {
  if (input.hook_event_name !== "PostToolUse" && input.hook_event_name !== "PostToolUseFailure" || input.tool_name !== "Bash" || typeof input.tool_input?.command !== "string") {
    return null;
  }
  return classifyCommandOutcome({
    hookEvent: input.hook_event_name,
    command: input.tool_input.command,
    toolResponse: input.tool_response,
    error: input.error,
    benignExit1Commands,
    benignExit1Extended
  });
}
function normalizeExtendedCommand(command) {
  const lastSegment = command.split(/&&|;|\|\|/).at(-1) ?? "";
  let tokens = normalizeCommand(lastSegment).split(" ").filter(Boolean);
  while (tokens.length > 0 && /^[A-Za-z_][A-Za-z0-9_]*=/.test(tokens[0])) {
    tokens = tokens.slice(1);
  }
  let scriptsEligible = false;
  if (tokens[0] === "npx") {
    tokens = tokens.slice(1);
  } else if (tokens[0] === "pnpm" && tokens[1] === "dlx") {
    tokens = tokens.slice(2);
  }
  if (tokens[0] === "pnpm" || tokens[0] === "npm" || tokens[0] === "yarn") {
    let index = 1;
    let usedExec = false;
    while (index < tokens.length) {
      const token = tokens[index];
      if (token === "--dir" || token === "-C" || token === "--filter") {
        index += 2;
      } else if (token === "exec") {
        usedExec = true;
        index += 1;
      } else if (token === "run") {
        scriptsEligible = true;
        index += 1;
      } else {
        break;
      }
    }
    scriptsEligible = scriptsEligible || !usedExec && ["pnpm", "npm", "yarn"].includes(tokens[0]);
    tokens = tokens.slice(index);
  }
  if (tokens.length === 0) return { command: "", scriptsEligible: false };
  tokens[0] = tokens[0].replace(/^.*\//, "");
  return { command: tokens.join(" "), scriptsEligible };
}
function parseExitCode(value) {
  if (typeof value === "number")
    return Number.isFinite(value) && Number.isInteger(value) ? value : null;
  if (typeof value !== "string" || !/^-?\d+$/.test(value)) return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) && Number.isInteger(parsed) ? parsed : null;
}
function commandStartsWith(command, candidate) {
  if (candidate === "" || !command.startsWith(candidate)) return false;
  return command.length === candidate.length || /\s/.test(command[candidate.length]);
}
function commandOutput(toolResponse, error) {
  const parts = [];
  if (typeof toolResponse === "string") parts.push(toolResponse);
  else if (isRecord(toolResponse)) {
    if (typeof toolResponse.stdout === "string") parts.push(toolResponse.stdout);
    if (typeof toolResponse.stderr === "string") parts.push(toolResponse.stderr);
  }
  if (typeof error === "string" && error !== "") parts.push(error);
  return parts.filter((part) => part !== "").join("\n");
}
function isRecord(value) {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

// src/lib/detect-edit-churn.ts
function findUniqueEditFootprint(filePath, postEditContent, newString) {
  if (newString === "") return null;
  const firstIndex = postEditContent.indexOf(newString);
  if (firstIndex < 0 || postEditContent.indexOf(newString, firstIndex + 1) >= 0) {
    return null;
  }
  const lineStart = 1 + countNewlines(postEditContent.slice(0, firstIndex));
  return {
    file_path: filePath,
    line_start: lineStart,
    line_end: lineStart + countNewlines(newString)
  };
}
function detectEditChurn(recentEdits, threshold = 3) {
  if (!Number.isInteger(threshold) || threshold < 2 || recentEdits.length === 0)
    return null;
  const latest = recentEdits.at(-1);
  if (!latest) return null;
  const sameFile = recentEdits.filter(
    (edit) => edit.file_path === latest.file_path
  );
  const window = sameFile.slice(-threshold);
  if (window.length !== threshold) return null;
  const lineStart = Math.max(...window.map((edit) => edit.line_start));
  const lineEnd = Math.min(...window.map((edit) => edit.line_end));
  if (lineStart > lineEnd) return null;
  return {
    type: "edit-churn",
    file_path: latest.file_path,
    line_start: lineStart,
    line_end: lineEnd,
    edits_in_window: threshold
  };
}
function countNewlines(value) {
  return (value.match(/\n/g) ?? []).length;
}

// src/lib/detect-rejection.ts
var BUILTIN_PATTERNS = [
  { id: "ja-not-that", source: "\u305D\u3046(\u3058\u3083\u306A\u3044|\u3067\u306F\u306A\u3044)" },
  { id: "ja-wrong-target", source: "(\u305D\u308C|\u305D\u3053)(\u3058\u3083\u306A\u3044|\u3067\u306F\u306A\u3044)" },
  {
    id: "ja-not-intended",
    source: "(\u610F\u56F3|\u304A\u9858\u3044\u3057\u305F\u3053\u3068|\u983C\u3093\u3060\u3053\u3068)\u3068(\u9055\u3046|\u7570\u306A\u308B)"
  },
  { id: "ja-restore", source: "(\u5143\u306B)?\u623B\u3057\u3066" },
  { id: "ja-cancel", source: "(\u53D6\u308A\u6D88\u3057\u3066|\u53D6\u308A\u6D88\u3057\u306B\u3057\u3066)" },
  { id: "ja-redo", source: "(\u3084\u308A\u76F4\u3057\u3066|\u6700\u521D\u304B\u3089\u3084\u3063\u3066)" },
  { id: "ja-misunderstood", source: "(\u52D8\u9055\u3044\u3057\u3066\u3044\u308B|\u8AA4\u89E3\u3057\u3066\u3044\u308B)" },
  {
    id: "ja-dont-change",
    source: "(\u52DD\u624B\u306B\u5909\u3048\u306A\u3044\u3067|\u305D\u3053\u306F\u5909\u3048\u306A\u3044\u3067)"
  },
  { id: "ja-no", source: "^(\u3044\u3084|\u3044\u3048)[\u3001,\u3002!\uFF01\\s]" },
  {
    id: "ja-wrong",
    source: "^(\u9055\u3046|\u9055\u3044\u307E\u3059|\u9055\u3044\u307E\u3059\u306D|\u9055\u3044\u307E\u3059\u3002)(?:[\u3001,\u3002!\uFF01\\s]|$)"
  },
  {
    id: "en-thats-wrong",
    source: "\\b(that(?:'s| is) wrong|that(?:'s| is) not right)\\b",
    flags: "i"
  },
  {
    id: "en-not-requested",
    source: "\\b(not what i (asked|requested|meant|wanted))\\b",
    flags: "i"
  },
  {
    id: "en-revert-that",
    source: "\\b(revert|undo|roll back) (that|this|the last change)\\b",
    flags: "i"
  },
  {
    id: "en-redo",
    source: "\\b(start over|do it again|try again)\\b",
    flags: "i"
  },
  {
    id: "en-misunderstood",
    source: "\\b(you misunderstood|you misread)\\b",
    flags: "i"
  },
  {
    id: "en-dont-change",
    source: "\\b(do not|don't) change (that|this)\\b",
    flags: "i"
  },
  { id: "en-no", source: "^(no|nope)[,.:;!\\s]", flags: "i" },
  {
    id: "en-wrong",
    source: "^(wrong|incorrect)[,.:;!\\s]",
    flags: "i"
  },
  {
    id: "en-imperative-revert",
    source: "^(please\\s+)?(revert|undo|roll back)(?:[\\s,.!]|$)",
    flags: "i"
  }
];
function detectUserRejection(prompt, additionalPatterns = [], previousTool = null) {
  const normalized = normalizePrompt(prompt);
  if (startsWithXmlLikeTag(normalized)) return null;
  for (const pattern of BUILTIN_PATTERNS) {
    if (new RegExp(pattern.source, pattern.flags).test(normalized)) {
      return rejectionDetails(prompt, pattern.id, previousTool);
    }
  }
  for (const source of additionalPatterns) {
    try {
      if (new RegExp(source, "iu").test(normalized))
        return rejectionDetails(prompt, source, previousTool);
    } catch {
    }
  }
  return null;
}
function normalizePrompt(prompt) {
  return prompt.normalize("NFKC").replace(/\s+/gu, " ").trimStart();
}
function startsWithXmlLikeTag(prompt) {
  return /^<[A-Za-z][A-Za-z0-9:_-]*(?:\s[^>]*)?>/.test(prompt);
}
function rejectionDetails(prompt, matchedPattern, previousTool) {
  return {
    type: "user-rejection",
    prompt_excerpt: prompt.slice(0, 1e3),
    matched_pattern: matchedPattern,
    previous_tool: previousTool
  };
}

// src/lib/infection-store.ts
import crypto2 from "node:crypto";
import fs5 from "node:fs";
import path5 from "node:path";

// src/lib/atomic.ts
import crypto from "node:crypto";
import fs4 from "node:fs";
import path4 from "node:path";
function writeFileAtomic(filePath, content) {
  const dir = path4.dirname(filePath);
  fs4.mkdirSync(dir, { recursive: true });
  const tempPath = path4.join(
    dir,
    `.tmp-${process.pid}-${crypto.randomBytes(4).toString("hex")}`
  );
  try {
    fs4.writeFileSync(tempPath, content);
    fs4.renameSync(tempPath, filePath);
  } catch (error) {
    fs4.rmSync(tempPath, { force: true });
    throw error;
  }
}

// src/lib/recurrence.ts
function recurrenceKey(kind, target) {
  return sha256Hex(`${kind}\0${target}`);
}

// src/lib/redact.ts
var ENV_ASSIGNMENT = /\b([A-Za-z_][A-Za-z0-9_]*)=(?:"[^"]*"|'[^']*'|[^\s;|&]*)/g;
var SECRET_NAME_PART = /TOKEN|KEY|SECRET|PASSWORD|PASSWD/i;
var BEARER_AUTHORIZATION = /(Authorization\s*:\s*Bearer\s+)([^\s'";,]+)/gi;
function redactSecrets(value) {
  return value.replace(
    ENV_ASSIGNMENT,
    (match, name) => SECRET_NAME_PART.test(name) ? `${name}=<redacted>` : match
  ).replace(BEARER_AUTHORIZATION, "$1<redacted>");
}

// src/lib/infection-store.ts
var KINDS = [
  "command-failure",
  "retry-loop",
  "user-rejection",
  "edit-churn"
];
var TOOLS = ["Bash", "Edit", "Write"];
var HOOK_EVENTS = [
  "PostToolUse",
  "PostToolUseFailure",
  "UserPromptSubmit"
];
function sha256Hex(value) {
  return crypto2.createHash("sha256").update(value).digest("hex");
}
function generateInfectionId(now = /* @__PURE__ */ new Date()) {
  const timestamp = now.toISOString().replace(/[-:]/g, "").replace("T", "-").replace(".", "").replace("Z", "");
  return `infection-${timestamp}-${crypto2.randomBytes(4).toString("hex")}`;
}
function sessionFileName(session) {
  return `session-${sha256Hex(session).slice(0, 16)}.jsonl`;
}
function infectionFilePath(projectDir, session) {
  return path5.join(
    projectDir,
    ".raphael",
    "infections",
    sessionFileName(session)
  );
}
function readInfections(projectDir, session) {
  const records = [];
  for (const line of readRawLines(infectionFilePath(projectDir, session))) {
    const record = parseInfectionLine(line);
    if (record) records.push(record);
  }
  return records;
}
function appendInfection(projectDir, input) {
  const record = sanitizeRecord(input);
  if (!record || record.session !== input.session) return false;
  const filePath = infectionFilePath(projectDir, record.session);
  const rawLines = readRawLines(filePath);
  if (record.tool_use_id !== null && rawLines.some((line) => {
    const existing = parseInfectionLine(line);
    return existing?.session === record.session && existing.tool_use_id === record.tool_use_id && existing.kind === record.kind;
  })) {
    return false;
  }
  rawLines.push(JSON.stringify(record));
  writeFileAtomic(filePath, `${rawLines.join("\n")}
`);
  return true;
}
function markInfectionsResolved(projectDir, session, ids, now = /* @__PURE__ */ new Date()) {
  const filePath = infectionFilePath(projectDir, session);
  const rawLines = readRawLines(filePath);
  if (rawLines.length === 0) return 0;
  const targetIds = new Set(ids);
  const resolvedAt = now.toISOString();
  let updated = 0;
  const rewritten = rawLines.map((line) => {
    const record = parseInfectionLine(line);
    if (!record || !targetIds.has(record.id) || record.resolved === true)
      return line;
    updated += 1;
    return JSON.stringify({
      ...record,
      resolved: true,
      resolved_at: resolvedAt
    });
  });
  if (updated > 0) writeFileAtomic(filePath, `${rewritten.join("\n")}
`);
  return updated;
}
function parseInfectionLine(line) {
  if (line.trim() === "") return null;
  try {
    return validateRecord(JSON.parse(line));
  } catch {
    return null;
  }
}
function readRawLines(filePath) {
  try {
    const raw = fs5.readFileSync(filePath, "utf8");
    const lines = raw.split(/\r?\n/);
    if (lines.at(-1) === "") lines.pop();
    return lines;
  } catch {
    return [];
  }
}
function sanitizeRecord(input) {
  const validated = validateRecord(input);
  if (!validated) return null;
  const details = sanitizeDetails(validated.details);
  return {
    ...validated,
    input_digest: truncate(redactSecrets(validated.input_digest), 500),
    evidence: truncate(redactSecrets(validated.evidence), 2e3),
    details
  };
}
function sanitizeDetails(details) {
  switch (details.type) {
    case "command-failure":
      return {
        ...details,
        command: truncate(redactSecrets(details.command), 1e3),
        normalized_command: redactSecrets(details.normalized_command),
        output_tail: tailLines(
          truncateFromEnd(redactSecrets(details.output_tail), 2e3),
          20
        )
      };
    case "retry-loop":
      return {
        ...details,
        command: truncate(redactSecrets(details.command), 1e3),
        normalized_command: redactSecrets(details.normalized_command),
        exit_codes: details.exit_codes.slice(-3)
      };
    case "user-rejection":
      return {
        ...details,
        prompt_excerpt: truncate(redactSecrets(details.prompt_excerpt), 1e3),
        previous_tool: details.previous_tool === null ? null : {
          ...details.previous_tool,
          input_digest: truncate(
            redactSecrets(details.previous_tool.input_digest),
            500
          )
        }
      };
    case "edit-churn":
      return details;
  }
}
function validateRecord(value) {
  if (!isObject(value) || value.schema_version !== 1) return null;
  if (!isString(value.id) || !isIsoDate(value.ts)) return null;
  if (!isKind(value.kind) || !isString(value.session)) return null;
  if (!isHookEvent(value.hook_event)) return null;
  if (!(value.tool === null || isTool(value.tool))) return null;
  if (!(value.tool_use_id === null || isString(value.tool_use_id))) return null;
  if (!isString(value.input_digest) || !isString(value.evidence)) return null;
  if (!isSha256(value.fingerprint)) return null;
  if (typeof value.distilled !== "boolean") return null;
  if (!(value.distilled_at === null || isIsoDate(value.distilled_at)))
    return null;
  if ("resolved" in value && typeof value.resolved !== "boolean") return null;
  if ("resolved_at" in value && !(value.resolved_at === null || isIsoDate(value.resolved_at)))
    return null;
  const details = validateDetails(value.details);
  if (!details || details.type !== value.kind) return null;
  return { ...value, details };
}
function validateDetails(value) {
  if (!isObject(value) || !isKind(value.type)) return null;
  switch (value.type) {
    case "command-failure":
      if (!isString(value.command) || !isString(value.normalized_command) || !isNullableNumber(value.exit_code) || !isString(value.output_tail))
        return null;
      return value;
    case "retry-loop":
      if (!isString(value.command) || !isString(value.normalized_command) || !isIntegerAtLeast(value.consecutive_failures, 3) || !Array.isArray(value.exit_codes) || !value.exit_codes.every(isNullableNumber))
        return null;
      return value;
    case "user-rejection":
      if (!isString(value.prompt_excerpt) || !isString(value.matched_pattern))
        return null;
      if (value.previous_tool !== null && (!isObject(value.previous_tool) || !isTool(value.previous_tool.tool) || !isString(value.previous_tool.input_digest)))
        return null;
      return value;
    case "edit-churn":
      if (!isString(value.file_path) || !isPositiveInteger(value.line_start) || !isPositiveInteger(value.line_end) || value.line_end < value.line_start || !isIntegerAtLeast(value.edits_in_window, 3))
        return null;
      return value;
  }
}
function isObject(value) {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
function isString(value) {
  return typeof value === "string";
}
function isKind(value) {
  return typeof value === "string" && KINDS.includes(value);
}
function isTool(value) {
  return typeof value === "string" && TOOLS.includes(value);
}
function isHookEvent(value) {
  return typeof value === "string" && HOOK_EVENTS.includes(value);
}
function isIsoDate(value) {
  return typeof value === "string" && !Number.isNaN(Date.parse(value)) && new Date(value).toISOString() === value;
}
function isSha256(value) {
  return typeof value === "string" && /^[0-9a-f]{64}$/.test(value);
}
function isNullableNumber(value) {
  return value === null || typeof value === "number" && Number.isFinite(value);
}
function isPositiveInteger(value) {
  return typeof value === "number" && Number.isInteger(value) && value >= 1;
}
function isIntegerAtLeast(value, minimum) {
  return typeof value === "number" && Number.isInteger(value) && value >= minimum;
}
function truncate(value, maximum) {
  return value.slice(0, maximum);
}
function truncateFromEnd(value, maximum) {
  return value.length <= maximum ? value : value.slice(-maximum);
}
function tailLines(value, maximum) {
  return value.split(/\r?\n/).slice(-maximum).join("\n");
}

// src/lib/state-store.ts
import fs6 from "node:fs";
import path6 from "node:path";
var TOOLS2 = ["Bash", "Edit", "Write"];
function stateFilePath(projectDir) {
  return path6.join(projectDir, ".raphael", "state.json");
}
function createInitialState(session) {
  return {
    schema_version: 1,
    session,
    next_event_seq: 1,
    recent_commands: [],
    recent_edits: [],
    last_tool: null,
    injected: []
  };
}
function loadState(projectDir, currentSession) {
  try {
    const parsed = JSON.parse(
      fs6.readFileSync(stateFilePath(projectDir), "utf8")
    );
    const state = validateState(parsed);
    if (!state || state.session !== currentSession)
      return createInitialState(currentSession);
    return normalizeState(state);
  } catch {
    return createInitialState(currentSession);
  }
}
function saveState(projectDir, state) {
  const validated = validateState(state);
  if (!validated) throw new TypeError("Invalid Raphael state");
  const normalized = normalizeState(validated);
  writeFileAtomic(stateFilePath(projectDir), `${JSON.stringify(normalized)}
`);
}
function applyEditToState(projectDir, state, input) {
  const nextState = {
    ...state,
    recent_commands: [...state.recent_commands],
    recent_edits: [...state.recent_edits],
    injected: [...state.injected],
    last_tool: {
      ts: input.ts,
      tool: "Edit",
      input_digest: truncate2(redactSecrets(input.inputDigest), 500)
    }
  };
  const footprint = restoreEditFootprint(
    projectDir,
    input.filePath,
    input.newString
  );
  if (footprint) {
    nextState.recent_edits.push({ ts: input.ts, ...footprint });
    nextState.recent_edits = nextState.recent_edits.slice(-50);
  }
  return { state: nextState, footprint };
}
function restoreEditFootprint(projectDir, filePath, newString) {
  if (newString === "") return null;
  const projectRoot = path6.resolve(projectDir);
  const resolvedFile = path6.resolve(projectRoot, filePath);
  const relative = path6.relative(projectRoot, resolvedFile);
  if (relative === "" || relative === ".." || relative.startsWith(`..${path6.sep}`) || path6.isAbsolute(relative)) {
    return null;
  }
  let content;
  try {
    content = fs6.readFileSync(resolvedFile, "utf8");
  } catch {
    return null;
  }
  return findUniqueEditFootprint(
    relative.split(path6.sep).join("/"),
    content,
    newString
  );
}
function normalizeState(state) {
  const injected = /* @__PURE__ */ new Map();
  for (const entry of state.injected) {
    const previous = injected.get(entry.antibody_id);
    if (!previous || entry.ts >= previous.ts)
      injected.set(entry.antibody_id, entry);
  }
  return {
    ...state,
    recent_commands: state.recent_commands.slice(-50).map((command) => ({
      ...command,
      normalized_command: redactSecrets(command.normalized_command)
    })),
    recent_edits: state.recent_edits.slice(-50),
    last_tool: state.last_tool === null ? null : {
      ...state.last_tool,
      input_digest: truncate2(
        redactSecrets(state.last_tool.input_digest),
        500
      )
    },
    injected: [...injected.values()]
  };
}
function validateState(value) {
  if (!isObject2(value) || value.schema_version !== 1) return null;
  if (!isString2(value.session) || !isPositiveInteger2(value.next_event_seq))
    return null;
  const recent_commands = Array.isArray(value.recent_commands) ? value.recent_commands.map((command) => {
    if (isObject2(command) && "resolved" in command && typeof command.resolved !== "boolean") {
      return { ...command, resolved: false };
    }
    return command;
  }) : null;
  const injected = Array.isArray(value.injected) ? value.injected.map((entry) => {
    if (!isObject2(entry)) return entry;
    const recurrenceKey2 = entry.recurrence_key;
    return {
      ...entry,
      recurrence_key: recurrenceKey2 === void 0 || !isRecurrenceKey(recurrenceKey2) ? null : recurrenceKey2
    };
  }) : null;
  if (recent_commands === null || !recent_commands.every(isRecentCommand) || !Array.isArray(value.recent_edits) || !value.recent_edits.every(isRecentEdit) || injected === null || !injected.every(isInjected))
    return null;
  if (!(value.last_tool === null || isLastTool(value.last_tool))) return null;
  return { ...value, recent_commands, injected };
}
function isRecentCommand(value) {
  return isObject2(value) && isIsoDate2(value.ts) && isString2(value.normalized_command) && typeof value.failed === "boolean" && isNullableFiniteNumber(value.exit_code) && (value.infection_id === null || isString2(value.infection_id)) && (value.resolved === void 0 || typeof value.resolved === "boolean");
}
function isRecentEdit(value) {
  return isObject2(value) && isIsoDate2(value.ts) && isString2(value.file_path) && isPositiveInteger2(value.line_start) && isPositiveInteger2(value.line_end) && value.line_end >= value.line_start;
}
function isLastTool(value) {
  return isObject2(value) && isIsoDate2(value.ts) && isTool2(value.tool) && isString2(value.input_digest);
}
function isInjected(value) {
  return isObject2(value) && isIsoDate2(value.ts) && isString2(value.antibody_id) && isString2(value.trigger_fingerprint) && isRecurrenceKey(value.recurrence_key);
}
function isObject2(value) {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
function isString2(value) {
  return typeof value === "string";
}
function isRecurrenceKey(value) {
  return value === null || typeof value === "string" && /^[0-9a-f]{64}$/.test(value);
}
function isPositiveInteger2(value) {
  return typeof value === "number" && Number.isInteger(value) && value >= 1;
}
function isNullableFiniteNumber(value) {
  return value === null || typeof value === "number" && Number.isFinite(value);
}
function isTool2(value) {
  return typeof value === "string" && TOOLS2.includes(value);
}
function isIsoDate2(value) {
  return typeof value === "string" && !Number.isNaN(Date.parse(value)) && new Date(value).toISOString() === value;
}
function truncate2(value, maximum) {
  return value.slice(0, maximum);
}

// src/lib/stats-store.ts
import fs7 from "node:fs";
import path7 from "node:path";
var ANTIBODY_ID_PATTERN = /^ab-\d{4}-\d{4}-\d{3}$/;
var DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;
var DIGEST_PATTERN = /^[0-9a-f]{64}$/;
function statsFilePath(projectDir) {
  return path7.join(projectDir, ".raphael", "stats.json");
}
function loadStats(projectDir) {
  try {
    const parsed = JSON.parse(
      fs7.readFileSync(statsFilePath(projectDir), "utf8")
    );
    if (!isRecord2(parsed) || !isRecord2(parsed.antibodies)) {
      return initialStats();
    }
    const antibodies = {};
    for (const [id, value] of Object.entries(parsed.antibodies)) {
      if (!ANTIBODY_ID_PATTERN.test(id)) continue;
      antibodies[id] = validStats(value) ? value : initialAntibodyStats();
    }
    return {
      schema_version: 1,
      antibodies,
      distill: normalizeDistill(parsed.distill)
    };
  } catch {
    return initialStats();
  }
}
function saveStats(projectDir, stats) {
  writeFileAtomic(
    statsFilePath(projectDir),
    `${JSON.stringify(stats, null, 2)}
`
  );
}
function statsFor(stats, id) {
  const value = stats.antibodies[id];
  return value === void 0 ? initialAntibodyStats() : { ...value };
}
function recordMiss(projectDir, id, now = /* @__PURE__ */ new Date()) {
  const stats = loadStats(projectDir);
  const current = statsFor(stats, id);
  const updated = {
    ...current,
    misses: current.misses + 1,
    last_miss: maxDate(current.last_miss, localDate(now))
  };
  stats.antibodies[id] = updated;
  saveStats(projectDir, stats);
  return { ...updated };
}
function initialStats() {
  return {
    schema_version: 1,
    antibodies: {},
    distill: { last_nag_digest: null }
  };
}
function initialAntibodyStats() {
  return { fired: 0, last_fired: null, misses: 0, last_miss: null };
}
function validStats(value) {
  if (!isRecord2(value)) return false;
  return isNonNegativeInteger(value.fired) && isNullableDate(value.last_fired) && isNonNegativeInteger(value.misses) && isNullableDate(value.last_miss);
}
function normalizeDistill(value) {
  if (!isRecord2(value) || !(value.last_nag_digest === null || typeof value.last_nag_digest === "string" && DIGEST_PATTERN.test(value.last_nag_digest))) {
    return { last_nag_digest: null };
  }
  return { last_nag_digest: value.last_nag_digest };
}
function maxDate(left, right) {
  if (left === null) return right;
  if (right === null) return left;
  return left >= right ? left : right;
}
function localDate(value) {
  const year = String(value.getFullYear()).padStart(4, "0");
  const month = String(value.getMonth() + 1).padStart(2, "0");
  const day = String(value.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}
function isNonNegativeInteger(value) {
  return typeof value === "number" && Number.isInteger(value) && value >= 0;
}
function isNullableDate(value) {
  return value === null || typeof value === "string" && DATE_PATTERN.test(value);
}
function isRecord2(value) {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

// src/detect-infection.ts
var TOOLS3 = ["Bash", "Edit", "Write"];
var EVENTS = [
  "PostToolUse",
  "PostToolUseFailure",
  "UserPromptSubmit"
];
function isHookEvent2(value) {
  return typeof value === "string" && EVENTS.includes(value);
}
function isTool3(value) {
  return typeof value === "string" && TOOLS3.includes(value);
}
function sessionFor(input) {
  return typeof input.session_id === "string" && input.session_id !== "" ? input.session_id : "unknown";
}
function digest(value) {
  try {
    return JSON.stringify(value) ?? "";
  } catch {
    return "";
  }
}
function recordFingerprint(kind, normalizedTarget, eventSeq) {
  return sha256Hex(
    eventSeq === null ? `${kind}\0${normalizedTarget}` : `${kind}\0${normalizedTarget}\0${eventSeq}`
  );
}
function evidence(kind, details) {
  if (kind !== details.type) return "Infection detected";
  switch (details.type) {
    case "command-failure":
      return `Bash command failed: ${details.normalized_command}`;
    case "retry-loop":
      return `${details.consecutive_failures} consecutive failures: ${details.normalized_command}`;
    case "user-rejection":
      return `User rejection matched ${details.matched_pattern}: ${details.prompt_excerpt}`;
    case "edit-churn":
      return `${details.edits_in_window} overlapping edits in ${details.file_path}:${details.line_start}-${details.line_end}`;
  }
}
function appendRecord(projectDir, session, input, event, tool, kind, details, inputDigest, normalizedTarget, eventSeq) {
  const record = {
    schema_version: 1,
    id: generateInfectionId(),
    ts: (/* @__PURE__ */ new Date()).toISOString(),
    kind,
    session,
    hook_event: event,
    tool,
    tool_use_id: typeof input.tool_use_id === "string" ? input.tool_use_id : null,
    input_digest: inputDigest,
    evidence: evidence(kind, details),
    fingerprint: recordFingerprint(kind, normalizedTarget, eventSeq),
    details,
    distilled: false,
    distilled_at: null
  };
  return appendInfection(projectDir, record) ? record.id : null;
}
function recordMissesForFailure(projectDir, state, normalizedCommand, now, windowMinutes) {
  try {
    const key = recurrenceKey("command-failure", normalizedCommand);
    const minTimestamp = now.getTime() - windowMinutes * 6e4;
    const antibodyIds = /* @__PURE__ */ new Set();
    for (const entry of state.injected) {
      if (entry.recurrence_key !== key) continue;
      const timestamp = Date.parse(entry.ts);
      const age = now.getTime() - timestamp;
      if (Number.isFinite(timestamp) && age >= 0 && timestamp >= minTimestamp)
        antibodyIds.add(entry.antibody_id);
    }
    for (const antibodyId of antibodyIds) {
      try {
        recordMiss(projectDir, antibodyId, now);
      } catch (error) {
        logError(projectDir, "detect-infection", error);
      }
    }
  } catch (error) {
    logError(projectDir, "detect-infection", error);
  }
}
function setLastTool(state, tool, inputDigest, now) {
  state.last_tool = { ts: now, tool, input_digest: inputDigest };
}
function processBash(projectDir, session, input, event, state, eventSeq) {
  const config = loadConfig(projectDir);
  const now = (/* @__PURE__ */ new Date()).toISOString();
  const inputDigest = digest(input.tool_input);
  setLastTool(state, "Bash", inputDigest, now);
  const outcome = commandOutcomeFromHookInput(
    input,
    config.benignExit1Commands,
    config.benignExit1Extended
  );
  if (!outcome) return;
  const normalizedCommand = redactSecrets(outcome.normalized_command);
  appendCommandLog(projectDir, {
    ts: now,
    session,
    normalized_command: normalizedCommand,
    exit_code: outcome.exit_code,
    failed: outcome.failed
  });
  const commandFailure = config.detectCommandFailure ? detectCommandFailure({
    hookEvent: event,
    command: outcome.command,
    toolResponse: input.tool_response,
    error: input.error,
    benignExit1Commands: config.benignExit1Commands,
    benignExit1Extended: config.benignExit1Extended
  }) : null;
  const infectionId = commandFailure === null ? null : appendRecord(
    projectDir,
    session,
    input,
    event,
    "Bash",
    "command-failure",
    commandFailure,
    inputDigest,
    outcome.normalized_command,
    eventSeq
  );
  let missRecorded = false;
  if (infectionId !== null && outcome.failed) {
    recordMissesForFailure(
      projectDir,
      state,
      outcome.normalized_command,
      new Date(now),
      config.missWindowMinutes
    );
    missRecorded = true;
  }
  if (outcome.failed === false && outcome.exit_code === 0) {
    const resolvedCommands = state.recent_commands.filter(
      (command) => command.normalized_command === normalizedCommand && command.failed === true && command.infection_id !== null && command.resolved !== true
    );
    const resolvedIds = [
      ...new Set(
        resolvedCommands.flatMap(
          (command) => command.infection_id === null ? [] : [command.infection_id]
        )
      )
    ];
    if (resolvedIds.length > 0) {
      try {
        markInfectionsResolved(projectDir, session, resolvedIds, new Date(now));
      } catch (error) {
        logError(projectDir, "detect-infection", error);
      }
      for (const command of resolvedCommands) command.resolved = true;
    }
  }
  state.recent_commands.push({
    ts: now,
    normalized_command: normalizedCommand,
    failed: outcome.failed,
    exit_code: outcome.exit_code,
    infection_id: infectionId
  });
  state.recent_commands = state.recent_commands.slice(-50);
  const retryLoop = config.detectRetryLoop ? detectRetryLoop(
    outcome.command,
    state.recent_commands,
    config.retryThreshold
  ) : null;
  if (retryLoop) {
    appendRecord(
      projectDir,
      session,
      input,
      event,
      "Bash",
      "retry-loop",
      retryLoop,
      inputDigest,
      `${retryLoop.normalized_command}\0${retryLoop.exit_codes.join(",")}`,
      eventSeq
    );
    if (!missRecorded && commandFailure === null && outcome.failed) {
      recordMissesForFailure(
        projectDir,
        state,
        retryLoop.normalized_command,
        new Date(now),
        config.missWindowMinutes
      );
    }
  }
}
function churnWindowTarget(state, filePath, threshold) {
  return state.recent_edits.filter((edit) => edit.file_path === filePath).slice(-threshold).map(
    (edit) => `${edit.ts}:${edit.file_path}:${edit.line_start}-${edit.line_end}`
  ).sort().join("\0");
}
function processEditOrWrite(projectDir, session, input, tool, state, eventSeq) {
  const now = (/* @__PURE__ */ new Date()).toISOString();
  const inputDigest = digest(input.tool_input);
  if (tool === "Write") {
    setLastTool(state, tool, inputDigest, now);
    return;
  }
  const filePath = input.tool_input?.file_path;
  const newString = input.tool_input?.new_string;
  const result = applyEditToState(projectDir, state, {
    ts: now,
    filePath: typeof filePath === "string" ? filePath : "",
    newString: typeof newString === "string" ? newString : "",
    inputDigest
  });
  Object.assign(state, result.state);
  const config = loadConfig(projectDir);
  if (!config.detectEditChurn || !result.footprint) return;
  const churn = detectEditChurn(state.recent_edits, config.editChurnThreshold);
  if (!churn) return;
  const target = churnWindowTarget(
    state,
    churn.file_path,
    config.editChurnThreshold
  );
  const fingerprint = recordFingerprint("edit-churn", target, eventSeq);
  const alreadyRecorded = readInfections(projectDir, session).some(
    (record) => record.kind === "edit-churn" && record.fingerprint === fingerprint
  );
  if (alreadyRecorded) return;
  appendRecord(
    projectDir,
    session,
    input,
    "PostToolUse",
    "Edit",
    "edit-churn",
    churn,
    inputDigest,
    target,
    eventSeq
  );
}
function processPrompt(projectDir, session, input, state, eventSeq) {
  const prompt = typeof input.prompt === "string" ? input.prompt : typeof input.user_prompt === "string" ? input.user_prompt : null;
  if (prompt === null) return;
  const config = loadConfig(projectDir);
  if (!config.detectUserRejection) return;
  const rejection = detectUserRejection(
    prompt,
    config.rejectionPatterns,
    state.last_tool === null ? null : {
      tool: state.last_tool.tool,
      input_digest: state.last_tool.input_digest
    }
  );
  if (!rejection) return;
  appendRecord(
    projectDir,
    session,
    input,
    "UserPromptSubmit",
    null,
    "user-rejection",
    rejection,
    prompt,
    rejection.prompt_excerpt,
    eventSeq
  );
}
function main() {
  const input = readStdinSync();
  if (!input || !isHookEvent2(input.hook_event_name)) return;
  const projectDir = resolveProjectDir(input);
  const session = sessionFor(input);
  try {
    const state = loadState(projectDir, session);
    const eventSeq = typeof input.tool_use_id === "string" ? null : state.next_event_seq++;
    if ((input.hook_event_name === "PostToolUse" || input.hook_event_name === "PostToolUseFailure") && input.tool_name === "Bash") {
      processBash(
        projectDir,
        session,
        input,
        input.hook_event_name,
        state,
        eventSeq
      );
    } else if (input.hook_event_name === "PostToolUse" && isTool3(input.tool_name) && (input.tool_name === "Edit" || input.tool_name === "Write")) {
      processEditOrWrite(
        projectDir,
        session,
        input,
        input.tool_name,
        state,
        eventSeq
      );
    } else if (input.hook_event_name === "UserPromptSubmit") {
      processPrompt(projectDir, session, input, state, eventSeq);
    } else {
      return;
    }
    saveState(projectDir, state);
  } catch (error) {
    logError(projectDir, "detect-infection", error);
  }
}
main();
