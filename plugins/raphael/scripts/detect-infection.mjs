#!/usr/bin/env node

// src/lib/config.ts
import fs from "node:fs";
import path from "node:path";
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
  antibodiesGitPolicy: "commit"
};
function configPath(projectDir) {
  return path.join(projectDir, ".claude", "raphael.local.md");
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
    raw = fs.readFileSync(configPath(projectDir), "utf8");
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
function isBenignExit1Command(command, exitCode, additionalCommands = []) {
  if (exitCode !== 1) return false;
  const normalized = normalizeCommand(command);
  return [...BUILTIN_BENIGN_EXIT1_COMMANDS, ...additionalCommands].some(
    (candidate) => commandStartsWith(normalized, normalizeCommand(candidate))
  );
}
function classifyCommandOutcome(input) {
  const exitCode = extractExitCode(input.toolResponse, input.error);
  const failedByEvent = input.hookEvent === "PostToolUseFailure";
  const failedByCode = input.hookEvent === "PostToolUse" && exitCode !== null && exitCode !== 0;
  const benign = isBenignExit1Command(
    input.command,
    exitCode,
    input.benignExit1Commands
  );
  return {
    command: input.command,
    normalized_command: normalizeCommand(input.command),
    exit_code: exitCode,
    failed: (failedByEvent || failedByCode) && !benign,
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
function commandOutcomeFromHookInput(input, benignExit1Commands = []) {
  if (input.hook_event_name !== "PostToolUse" && input.hook_event_name !== "PostToolUseFailure" || input.tool_name !== "Bash" || typeof input.tool_input?.command !== "string") {
    return null;
  }
  return classifyCommandOutcome({
    hookEvent: input.hook_event_name,
    command: input.tool_input.command,
    toolResponse: input.tool_response,
    error: input.error,
    benignExit1Commands
  });
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

// src/lib/hook-io.ts
import fs2 from "node:fs";
import path2 from "node:path";
function readStdinSync() {
  try {
    const value = JSON.parse(fs2.readFileSync(0, "utf8"));
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
    const logDir = path2.join(projectDir, ".raphael", "log");
    fs2.mkdirSync(logDir, { recursive: true });
    const message = error instanceof Error ? error.stack ?? error.message : String(error);
    fs2.appendFileSync(
      path2.join(logDir, "errors.log"),
      `${(/* @__PURE__ */ new Date()).toISOString()} [${context}] ${message}
`
    );
  } catch {
  }
}

// src/lib/infection-store.ts
import crypto2 from "node:crypto";
import fs4 from "node:fs";
import path4 from "node:path";

// src/lib/atomic.ts
import crypto from "node:crypto";
import fs3 from "node:fs";
import path3 from "node:path";
function writeFileAtomic(filePath, content) {
  const dir = path3.dirname(filePath);
  fs3.mkdirSync(dir, { recursive: true });
  const tempPath = path3.join(
    dir,
    `.tmp-${process.pid}-${crypto.randomBytes(4).toString("hex")}`
  );
  try {
    fs3.writeFileSync(tempPath, content);
    fs3.renameSync(tempPath, filePath);
  } catch (error) {
    fs3.rmSync(tempPath, { force: true });
    throw error;
  }
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
  return path4.join(
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
    const raw = fs4.readFileSync(filePath, "utf8");
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
import fs5 from "node:fs";
import path5 from "node:path";
var TOOLS2 = ["Bash", "Edit", "Write"];
function stateFilePath(projectDir) {
  return path5.join(projectDir, ".raphael", "state.json");
}
function createInitialState(session) {
  return {
    schema_version: 1,
    session,
    next_event_seq: 1,
    recent_commands: [],
    recent_edits: [],
    last_tool: null,
    injected: [],
    last_distill_nag_digest: null
  };
}
function loadState(projectDir, currentSession) {
  try {
    const parsed = JSON.parse(
      fs5.readFileSync(stateFilePath(projectDir), "utf8")
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
  const projectRoot = path5.resolve(projectDir);
  const resolvedFile = path5.resolve(projectRoot, filePath);
  const relative = path5.relative(projectRoot, resolvedFile);
  if (relative === "" || relative === ".." || relative.startsWith(`..${path5.sep}`) || path5.isAbsolute(relative)) {
    return null;
  }
  let content;
  try {
    content = fs5.readFileSync(resolvedFile, "utf8");
  } catch {
    return null;
  }
  return findUniqueEditFootprint(
    relative.split(path5.sep).join("/"),
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
    recent_commands: state.recent_commands.slice(-20).map((command) => ({
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
  if (!Array.isArray(value.recent_commands) || !value.recent_commands.every(isRecentCommand) || !Array.isArray(value.recent_edits) || !value.recent_edits.every(isRecentEdit) || !Array.isArray(value.injected) || !value.injected.every(isInjected))
    return null;
  if (!(value.last_tool === null || isLastTool(value.last_tool))) return null;
  if (!(value.last_distill_nag_digest === null || isString2(value.last_distill_nag_digest) && /^[0-9a-f]{64}$/.test(value.last_distill_nag_digest)))
    return null;
  return value;
}
function isRecentCommand(value) {
  return isObject2(value) && isIsoDate2(value.ts) && isString2(value.normalized_command) && typeof value.failed === "boolean" && isNullableFiniteNumber(value.exit_code) && (value.infection_id === null || isString2(value.infection_id));
}
function isRecentEdit(value) {
  return isObject2(value) && isIsoDate2(value.ts) && isString2(value.file_path) && isPositiveInteger2(value.line_start) && isPositiveInteger2(value.line_end) && value.line_end >= value.line_start;
}
function isLastTool(value) {
  return isObject2(value) && isIsoDate2(value.ts) && isTool2(value.tool) && isString2(value.input_digest);
}
function isInjected(value) {
  return isObject2(value) && isIsoDate2(value.ts) && isString2(value.antibody_id) && isString2(value.trigger_fingerprint);
}
function isObject2(value) {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
function isString2(value) {
  return typeof value === "string";
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
function setLastTool(state, tool, inputDigest, now) {
  state.last_tool = { ts: now, tool, input_digest: inputDigest };
}
function processBash(projectDir, session, input, event, state, eventSeq) {
  const config = loadConfig(projectDir);
  const now = (/* @__PURE__ */ new Date()).toISOString();
  const inputDigest = digest(input.tool_input);
  setLastTool(state, "Bash", inputDigest, now);
  const outcome = commandOutcomeFromHookInput(input, config.benignExit1Commands);
  if (!outcome) return;
  const commandFailure = config.detectCommandFailure ? detectCommandFailure({
    hookEvent: event,
    command: outcome.command,
    toolResponse: input.tool_response,
    error: input.error,
    benignExit1Commands: config.benignExit1Commands
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
  state.recent_commands.push({
    ts: now,
    normalized_command: outcome.normalized_command,
    failed: outcome.failed,
    exit_code: outcome.exit_code,
    infection_id: infectionId
  });
  state.recent_commands = state.recent_commands.slice(-20);
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
