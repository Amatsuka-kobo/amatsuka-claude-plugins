#!/usr/bin/env node

// src/check-distill-needed.ts
import fs6 from "node:fs";
import path6 from "node:path";
import { fileURLToPath } from "node:url";

// src/lib/antibody-store.ts
import fs2 from "node:fs";
import path2 from "node:path";

// src/lib/atomic.ts
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
function writeFileAtomic(filePath, content) {
  const dir = path.dirname(filePath);
  fs.mkdirSync(dir, { recursive: true });
  const tempPath = path.join(
    dir,
    `.tmp-${process.pid}-${crypto.randomBytes(4).toString("hex")}`
  );
  try {
    fs.writeFileSync(tempPath, content);
    fs.renameSync(tempPath, filePath);
  } catch (error) {
    fs.rmSync(tempPath, { force: true });
    throw error;
  }
}

// src/lib/frontmatter.ts
var ID_PATTERN = /^ab-\d{4}-\d{4}-\d{3}$/;
var DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;
var TOOLS = [
  "Bash",
  "Edit",
  "Write",
  "*"
];
var STATUSES = ["active", "expired", "confirmed"];
var AntibodyValidationError = class extends Error {
  field;
  constructor(message, field) {
    super(message);
    this.name = "AntibodyValidationError";
    this.field = field;
  }
};
function parseAntibodyMarkdown(markdown) {
  const normalized = markdown.replace(/\r\n?/g, "\n");
  if (!normalized.startsWith("---\n")) {
    throw validationError("frontmatter", "must start with ---");
  }
  const closing = normalized.indexOf("\n---\n", 4);
  if (closing < 0) {
    throw validationError("frontmatter", "must end with ---");
  }
  const frontmatter = normalized.slice(4, closing);
  let body = normalized.slice(closing + 5);
  if (body.startsWith("\n")) body = body.slice(1);
  if (body.endsWith("\n")) body = body.slice(0, -1);
  const lines = frontmatter.split("\n");
  let index = 0;
  const take = (indent, key) => {
    const line = lines[index];
    if (line === void 0) {
      throw validationError(key, "is required");
    }
    const prefix = `${indent}${key}:`;
    if (!line.startsWith(prefix)) {
      throw validationError(key, `expected ${prefix}`);
    }
    const next = line.slice(prefix.length);
    if (next !== "" && !/^\s/.test(next)) {
      throw validationError(key, "must be followed by whitespace");
    }
    index += 1;
    return next.trimStart();
  };
  const takeGroup = (key) => {
    const line = lines[index];
    if (line !== `${key}:`) {
      throw validationError(key, `expected ${key}:`);
    }
    index += 1;
  };
  const id = parseString(take("", "id"), "id");
  const created = parseString(take("", "created"), "created");
  const source = parseString(take("", "source"), "source");
  takeGroup("trigger");
  const event = parseString(take("  ", "event"), "trigger.event");
  const tool = parseString(take("  ", "tool"), "trigger.tool");
  const pattern = parseString(take("  ", "pattern"), "trigger.pattern");
  let scope;
  if (lines[index]?.startsWith("  scope:")) {
    scope = parseString(take("  ", "scope"), "trigger.scope");
  }
  const status = parseString(take("", "status"), "status");
  takeGroup("stats");
  const fired = parseInteger(take("  ", "fired"), "stats.fired");
  const lastFired = parseNullableString(
    take("  ", "last_fired"),
    "stats.last_fired"
  );
  const expires = parseString(take("", "expires"), "expires");
  if (index !== lines.length) {
    throw validationError("frontmatter", `unexpected field: ${lines[index]}`);
  }
  return validateAntibody({
    id,
    created,
    source,
    trigger: {
      event,
      tool,
      pattern,
      ...scope === void 0 ? {} : { scope }
    },
    status,
    stats: { fired, last_fired: lastFired },
    expires,
    body
  });
}
function serializeAntibodyMarkdown(value) {
  const antibody = validateAntibody(value);
  const lines = [
    "---",
    `id: ${antibody.id}`,
    `created: ${antibody.created}`,
    `source: ${JSON.stringify(antibody.source)}`,
    "trigger:",
    `  event: ${antibody.trigger.event}`,
    `  tool: ${antibody.trigger.tool}`,
    `  pattern: ${JSON.stringify(antibody.trigger.pattern)}`
  ];
  if (antibody.trigger.scope !== void 0) {
    lines.push(`  scope: ${JSON.stringify(antibody.trigger.scope)}`);
  }
  lines.push(
    `status: ${antibody.status}`,
    "stats:",
    `  fired: ${antibody.stats.fired}`,
    `  last_fired: ${antibody.stats.last_fired ?? "null"}`,
    `expires: ${antibody.expires}`,
    "---",
    "",
    antibody.body
  );
  return `${lines.join("\n")}
`;
}
function validateAntibody(value) {
  if (!isRecord(value)) throw validationError("antibody", "must be an object");
  assertExactKeys(value, [
    "id",
    "created",
    "source",
    "trigger",
    "status",
    "stats",
    "expires",
    "body"
  ]);
  const id = requireString(value.id, "id");
  if (!ID_PATTERN.test(id)) {
    throw validationError("id", "must match ab-YYYY-MMDD-NNN");
  }
  const created = requireDate(value.created, "created");
  const source = requireString(value.source, "source");
  if (source.length > 500) {
    throw validationError("source", "must be at most 500 characters");
  }
  const trigger = validateTrigger(value.trigger);
  const status = requireString(value.status, "status");
  if (!STATUSES.includes(status)) {
    throw validationError("status", "must be active, expired, or confirmed");
  }
  if (!isRecord(value.stats)) {
    throw validationError("stats", "must be an object");
  }
  assertExactKeys(value.stats, ["fired", "last_fired"], "stats");
  if (typeof value.stats.fired !== "number" || !Number.isInteger(value.stats.fired) || value.stats.fired < 0) {
    throw validationError("stats.fired", "must be a non-negative integer");
  }
  const lastFired = value.stats.last_fired === null ? null : requireDate(value.stats.last_fired, "stats.last_fired");
  const expires = requireDate(value.expires, "expires");
  const body = requireString(value.body, "body");
  if (body.trim() === "") throw validationError("body", "must not be empty");
  if (body.length > 9e3) {
    throw validationError("body", "must be at most 9000 characters");
  }
  return {
    id,
    created,
    source,
    trigger,
    status,
    stats: { fired: value.stats.fired, last_fired: lastFired },
    expires,
    body
  };
}
function validateTrigger(value) {
  if (!isRecord(value)) {
    throw validationError("trigger", "must be an object");
  }
  assertExactKeys(value, ["event", "tool", "pattern"], "trigger", ["scope"]);
  if (value.event !== "PreToolUse") {
    throw validationError("trigger.event", "must be PreToolUse");
  }
  const tool = requireString(value.tool, "trigger.tool");
  if (!TOOLS.includes(tool)) {
    throw validationError("trigger.tool", "must be Bash, Edit, Write, or *");
  }
  const pattern = requireString(value.pattern, "trigger.pattern");
  if (pattern.length > 1e3) {
    throw validationError("trigger.pattern", "must be at most 1000 characters");
  }
  try {
    new RegExp(pattern);
  } catch {
    throw validationError(
      "trigger.pattern",
      "must be a valid regular expression"
    );
  }
  const scope = value.scope === void 0 ? void 0 : requireString(value.scope, "trigger.scope");
  return {
    event: "PreToolUse",
    tool,
    pattern,
    ...scope === void 0 ? {} : { scope }
  };
}
function parseString(raw, field) {
  const scalar = stripInlineComment(raw).trim();
  if (scalar.startsWith('"')) {
    try {
      const parsed = JSON.parse(scalar);
      return requireString(parsed, field);
    } catch (error) {
      if (error instanceof AntibodyValidationError) throw error;
      throw validationError(field, "must be a valid JSON string");
    }
  }
  if (scalar === "") throw validationError(field, "is required");
  return scalar;
}
function parseNullableString(raw, field) {
  const scalar = stripInlineComment(raw).trim();
  return scalar === "null" ? null : parseString(scalar, field);
}
function parseInteger(raw, field) {
  const scalar = stripInlineComment(raw).trim();
  if (!/^\d+$/.test(scalar)) {
    throw validationError(field, "must be a non-negative integer");
  }
  const value = Number(scalar);
  if (!Number.isSafeInteger(value)) {
    throw validationError(field, "must be a safe integer");
  }
  return value;
}
function stripInlineComment(raw) {
  let quoted = false;
  let escaped = false;
  for (let index = 0; index < raw.length; index += 1) {
    const character = raw[index];
    if (quoted) {
      if (escaped) escaped = false;
      else if (character === "\\") escaped = true;
      else if (character === '"') quoted = false;
    } else if (character === '"') quoted = true;
    else if (character === "#" && (index === 0 || /\s/.test(raw[index - 1]))) {
      return raw.slice(0, index);
    }
  }
  return raw;
}
function requireString(value, field) {
  if (typeof value !== "string") {
    throw validationError(field, "must be a string");
  }
  return value;
}
function requireDate(value, field) {
  const date = requireString(value, field);
  if (!DATE_PATTERN.test(date)) {
    throw validationError(field, "must be YYYY-MM-DD");
  }
  const [year, month, day] = date.split("-").map(Number);
  const candidate = new Date(Date.UTC(year, month - 1, day));
  if (candidate.getUTCFullYear() !== year || candidate.getUTCMonth() !== month - 1 || candidate.getUTCDate() !== day) {
    throw validationError(field, "must be a valid calendar date");
  }
  return date;
}
function assertExactKeys(value, required, field = "antibody", optional = []) {
  for (const key of required) {
    if (!(key in value)) throw validationError(`${field}.${key}`, "is required");
  }
  const allowed = /* @__PURE__ */ new Set([...required, ...optional]);
  for (const key of Object.keys(value)) {
    if (!allowed.has(key)) {
      throw validationError(`${field}.${key}`, "is not supported");
    }
  }
}
function isRecord(value) {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
function validationError(field, message) {
  return new AntibodyValidationError(`${field}: ${message}`, field);
}

// src/lib/antibody-store.ts
var ID_PATTERN2 = /^ab-(\d{4})-(\d{4})-(\d{3})$/;
var AntibodyIoError = class extends Error {
  cause;
  constructor(message, cause) {
    super(message);
    this.name = "AntibodyIoError";
    this.cause = cause;
  }
};
var AntibodyNotFoundError = class extends AntibodyValidationError {
  constructor(id) {
    super(`id: antibody not found: ${id}`, "id");
    this.name = "AntibodyNotFoundError";
  }
};
function antibodiesDirectory(projectDir) {
  return path2.join(projectDir, ".raphael", "antibodies");
}
function antibodyFilePath(projectDir, id) {
  assertAntibodyId(id);
  return path2.join(antibodiesDirectory(projectDir), `${id}.md`);
}
function listAntibodies(projectDir) {
  const directory = antibodiesDirectory(projectDir);
  let entries;
  try {
    entries = fs2.readdirSync(directory, { withFileTypes: true });
  } catch (error) {
    if (isErrorCode(error, "ENOENT")) return { antibodies: [], errors: [] };
    throw new AntibodyIoError("Failed to list antibodies", error);
  }
  const antibodies = [];
  const errors = [];
  const files = entries.filter((entry) => entry.isFile() && entry.name.endsWith(".md")).map((entry) => entry.name).sort(codePointCompare);
  for (const file of files) {
    try {
      const raw = fs2.readFileSync(path2.join(directory, file), "utf8");
      const antibody = parseAntibodyMarkdown(raw);
      if (file !== `${antibody.id}.md`) {
        throw new AntibodyValidationError(
          `id: filename must be ${antibody.id}.md`,
          "id"
        );
      }
      antibodies.push(antibody);
    } catch (error) {
      if (error instanceof AntibodyValidationError) {
        errors.push({ file, message: error.message });
        continue;
      }
      throw new AntibodyIoError(`Failed to read antibody: ${file}`, error);
    }
  }
  return { antibodies, errors };
}
function readAntibody(projectDir, id) {
  const filePath = antibodyFilePath(projectDir, id);
  let raw;
  try {
    raw = fs2.readFileSync(filePath, "utf8");
  } catch (error) {
    if (isErrorCode(error, "ENOENT")) throw new AntibodyNotFoundError(id);
    throw new AntibodyIoError(`Failed to read antibody: ${id}`, error);
  }
  try {
    const antibody = parseAntibodyMarkdown(raw);
    if (antibody.id !== id) {
      throw new AntibodyValidationError(
        `id: expected ${id}, found ${antibody.id}`,
        "id"
      );
    }
    return antibody;
  } catch (error) {
    if (error instanceof AntibodyValidationError) throw error;
    throw new AntibodyIoError(`Failed to parse antibody: ${id}`, error);
  }
}
function setAntibodyStatus(projectDir, id, status) {
  const current = readAntibody(projectDir, id);
  const updated = validateAntibody({ ...current, status });
  writeAntibodyReplace(projectDir, updated);
  return updated;
}
function writeAntibodyReplace(projectDir, antibody) {
  const filePath = antibodyFilePath(projectDir, antibody.id);
  try {
    writeFileAtomic(filePath, serializeAntibodyMarkdown(antibody));
  } catch (error) {
    throw new AntibodyIoError(
      `Failed to update antibody: ${antibody.id}`,
      error
    );
  }
}
function assertAntibodyId(id) {
  if (!ID_PATTERN2.test(id)) {
    throw new AntibodyValidationError("id: must match ab-YYYY-MMDD-NNN", "id");
  }
}
function isErrorCode(error, code) {
  return typeof error === "object" && error !== null && "code" in error && error.code === code;
}
function codePointCompare(left, right) {
  const leftPoints = Array.from(left, (value) => value.codePointAt(0) ?? 0);
  const rightPoints = Array.from(right, (value) => value.codePointAt(0) ?? 0);
  const length = Math.min(leftPoints.length, rightPoints.length);
  for (let index = 0; index < length; index += 1) {
    const difference = leftPoints[index] - rightPoints[index];
    if (difference !== 0) return difference;
  }
  return leftPoints.length - rightPoints.length;
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
  const detectCommandFailure = booleanValue(
    fields.get("detect_command_failure")
  );
  if (detectCommandFailure !== null)
    config.detectCommandFailure = detectCommandFailure;
  const detectRetryLoop = booleanValue(fields.get("detect_retry_loop"));
  if (detectRetryLoop !== null) config.detectRetryLoop = detectRetryLoop;
  const detectUserRejection = booleanValue(fields.get("detect_user_rejection"));
  if (detectUserRejection !== null)
    config.detectUserRejection = detectUserRejection;
  const detectEditChurn = booleanValue(fields.get("detect_edit_churn"));
  if (detectEditChurn !== null) config.detectEditChurn = detectEditChurn;
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

// src/lib/hook-io.ts
import fs4 from "node:fs";
import path4 from "node:path";
function readStdinSync() {
  try {
    const value = JSON.parse(fs4.readFileSync(0, "utf8"));
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
    const logDir = path4.join(projectDir, ".raphael", "log");
    fs4.mkdirSync(logDir, { recursive: true });
    const message = error instanceof Error ? error.stack ?? error.message : String(error);
    fs4.appendFileSync(
      path4.join(logDir, "errors.log"),
      `${(/* @__PURE__ */ new Date()).toISOString()} [${context}] ${message}
`
    );
  } catch {
  }
}

// src/lib/infection-store.ts
import crypto2 from "node:crypto";

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
var TOOLS2 = ["Bash", "Edit", "Write"];
var HOOK_EVENTS = [
  "PostToolUse",
  "PostToolUseFailure",
  "UserPromptSubmit"
];
function sha256Hex(value) {
  return crypto2.createHash("sha256").update(value).digest("hex");
}
function computeDistillNagDigest(ids) {
  return sha256Hex([...new Set(ids)].sort(codePointCompare2).join("\0"));
}
function parseInfectionLine(line) {
  if (line.trim() === "") return null;
  try {
    return validateRecord(JSON.parse(line));
  } catch {
    return null;
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
  return typeof value === "string" && TOOLS2.includes(value);
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
function codePointCompare2(left, right) {
  const leftPoints = Array.from(left, (value) => value.codePointAt(0) ?? 0);
  const rightPoints = Array.from(right, (value) => value.codePointAt(0) ?? 0);
  const length = Math.min(leftPoints.length, rightPoints.length);
  for (let index = 0; index < length; index += 1) {
    const difference = leftPoints[index] - rightPoints[index];
    if (difference !== 0) return difference;
  }
  return leftPoints.length - rightPoints.length;
}

// src/lib/state-store.ts
import fs5 from "node:fs";
import path5 from "node:path";
var TOOLS3 = ["Bash", "Edit", "Write"];
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
      input_digest: truncate(
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
  return typeof value === "string" && TOOLS3.includes(value);
}
function isIsoDate2(value) {
  return typeof value === "string" && !Number.isNaN(Date.parse(value)) && new Date(value).toISOString() === value;
}
function truncate(value, maximum) {
  return value.slice(0, maximum);
}

// src/check-distill-needed.ts
var DISTILLED_RETENTION_MS = 14 * 24 * 60 * 60 * 1e3;
function cleanupProject(projectDir, now = /* @__PURE__ */ new Date()) {
  const undistilledIds = cleanupInfections(projectDir, now);
  expireAntibodies(projectDir, now);
  return { undistilledIds };
}
function localDateString(value) {
  const year = String(value.getFullYear()).padStart(4, "0");
  const month = String(value.getMonth() + 1).padStart(2, "0");
  const day = String(value.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}
function cleanupInfections(projectDir, now) {
  const directory = path6.join(projectDir, ".raphael", "infections");
  let entries;
  try {
    entries = fs6.readdirSync(directory, { withFileTypes: true });
  } catch (error) {
    if (isErrorCode2(error, "ENOENT")) return [];
    throw error;
  }
  const cutoff = now.getTime() - DISTILLED_RETENTION_MS;
  const undistilledIds = [];
  const files = entries.filter((entry) => entry.isFile() && entry.name.endsWith(".jsonl")).map((entry) => entry.name).sort(codePointCompare3);
  for (const file of files) {
    const filePath = path6.join(directory, file);
    const raw = fs6.readFileSync(filePath, "utf8");
    const lines = raw.split(/\r?\n/);
    if (lines.at(-1) === "") lines.pop();
    const retained = [];
    for (const line of lines) {
      if (line.trim() === "") continue;
      const record = parseInfectionLine(line);
      if (!record) {
        retained.push(line);
        continue;
      }
      if (!record.distilled) {
        undistilledIds.push(record.id);
        retained.push(line);
        continue;
      }
      const distilledAt = record.distilled_at === null ? Number.NaN : Date.parse(record.distilled_at);
      if (!Number.isFinite(distilledAt) || distilledAt >= cutoff) {
        retained.push(line);
      }
    }
    if (retained.length === 0) {
      fs6.rmSync(filePath);
    } else if (retained.length !== lines.length || retained.some((line, index) => line !== lines[index])) {
      writeFileAtomic(filePath, `${retained.join("\n")}
`);
    }
  }
  return undistilledIds;
}
function expireAntibodies(projectDir, now) {
  const today = localDateString(now);
  const { antibodies } = listAntibodies(projectDir);
  for (const antibody of antibodies) {
    if (antibody.status === "active" && antibody.expires < today) {
      setAntibodyStatus(projectDir, antibody.id, "expired");
    }
  }
}
function buildReason(projectDir, pluginRoot, undistilledCount) {
  const listScript = path6.join(pluginRoot, "scripts", "list-antibodies.mjs");
  const updateScript = path6.join(pluginRoot, "scripts", "update-antibody.mjs");
  return [
    "Raphael \u306B\u672A\u84B8\u7559\u306E infection record \u304C\u84C4\u7A4D\u3057\u3066\u3044\u307E\u3059\u3002\u611F\u67D3\u5185\u5BB9\u3084 secret \u3092\u3053\u306E\u30E1\u30C3\u30BB\u30FC\u30B8\u3078\u5C55\u958B\u305B\u305A\u3001\u84B8\u7559\u3092\u5C02\u7528\u30B5\u30D6\u30A8\u30FC\u30B8\u30A7\u30F3\u30C8\u3078\u59D4\u8B72\u3057\u3066\u304F\u3060\u3055\u3044\u3002",
    'Agent \u30C4\u30FC\u30EB\u3067 subagent_type "raphael:antibody-synthesizer" \u3092\u8D77\u52D5\u3057\u3066\u304F\u3060\u3055\u3044\u3002',
    `\u5BFE\u8C61 project: ${projectDir}`,
    `\u672A\u84B8\u7559 infection \u4EF6\u6570: ${undistilledCount}`,
    "\u6297\u4F53\u306E\u78BA\u8A8D\u3068\u66F4\u65B0\u306B\u306F\u6B21\u306E\u7D76\u5BFE plugin path \u3092\u4F7F\u7528\u3059\u308B\u3088\u3046\u6307\u793A\u3057\u3066\u304F\u3060\u3055\u3044\u3002",
    `- node "${listScript}" --json --include-body`,
    `- node "${updateScript}"`,
    "\u6CE8\u5165\u5F8C\u306E\u6210\u529F\u30D5\u30A3\u30FC\u30C9\u30D0\u30C3\u30AF\u306F synthesizer \u304C state.injected \u3068\u73FE\u5728\u306E session infections \u3092\u8AAD\u3093\u3067\u5224\u65AD\u3057\u3001\u3053\u306E hook \u3067\u306F\u5224\u65AD\u3057\u307E\u305B\u3093\u3002"
  ].join("\n");
}
function run() {
  const input = readStdinSync();
  if (!input || input.stop_hook_active) return;
  const session = validSession(input);
  if (session === null) return;
  const projectDir = path6.resolve(resolveProjectDir(input));
  try {
    const config = loadConfig(projectDir);
    const { undistilledIds } = cleanupProject(projectDir);
    if (undistilledIds.length < config.distillThreshold) return;
    const digest = computeDistillNagDigest(undistilledIds);
    const state = loadState(projectDir, session);
    if (state.last_distill_nag_digest === digest) return;
    const pluginRoot = path6.resolve(
      process.env.CLAUDE_PLUGIN_ROOT || "<raphael plugin root>"
    );
    const reason = buildReason(projectDir, pluginRoot, undistilledIds.length);
    const nextState = { ...state, last_distill_nag_digest: digest };
    saveState(projectDir, nextState);
    process.stdout.write(JSON.stringify({ decision: "block", reason }));
  } catch (error) {
    logError(projectDir, "check-distill-needed", error);
  }
}
function validSession(input) {
  return typeof input.session_id === "string" && input.session_id !== "" ? input.session_id : null;
}
function isErrorCode2(error, code) {
  return typeof error === "object" && error !== null && "code" in error && error.code === code;
}
function codePointCompare3(left, right) {
  const leftPoints = Array.from(left, (value) => value.codePointAt(0) ?? 0);
  const rightPoints = Array.from(right, (value) => value.codePointAt(0) ?? 0);
  const length = Math.min(leftPoints.length, rightPoints.length);
  for (let index = 0; index < length; index += 1) {
    const difference = leftPoints[index] - rightPoints[index];
    if (difference !== 0) return difference;
  }
  return leftPoints.length - rightPoints.length;
}
if (path6.resolve(process.argv[1] ?? "") === fileURLToPath(import.meta.url))
  run();
export {
  cleanupProject,
  localDateString
};
