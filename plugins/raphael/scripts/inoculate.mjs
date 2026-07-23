#!/usr/bin/env node

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
function recordAntibodyFire(projectDir, id, now = /* @__PURE__ */ new Date()) {
  const current = readAntibody(projectDir, id);
  const updated = validateAntibody({
    ...current,
    stats: {
      fired: current.stats.fired + 1,
      last_fired: localDate(now)
    }
  });
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
function localDate(value) {
  const year = String(value.getFullYear()).padStart(4, "0");
  const month = String(value.getMonth() + 1).padStart(2, "0");
  const day = String(value.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
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
function sha256Hex(value) {
  return crypto2.createHash("sha256").update(value).digest("hex");
}

// src/lib/match-antibody.ts
import path4 from "node:path";
var MAX_PATTERN_TEXT_LENGTH = 2e4;
var DEFAULT_MAX_INJECTIONS = 3;
var DEFAULT_MAX_CONTEXT_LENGTH = 9e3;
function buildMatchTarget(tool, input, projectDir) {
  const text = targetText(tool, input).slice(0, MAX_PATTERN_TEXT_LENGTH);
  return {
    tool,
    text,
    path: tool === "Bash" ? null : projectRelativePosixPath(input.file_path, projectDir)
  };
}
function matchAntibodies(antibodies, target, options = {}) {
  const today = utcDate(options.now ?? /* @__PURE__ */ new Date());
  const expiredActiveIds = [];
  const matching = [];
  for (const antibody of antibodies) {
    if (antibody.status === "active" && antibody.expires < today) {
      expiredActiveIds.push(antibody.id);
      continue;
    }
    if (antibody.status !== "active" && antibody.status !== "confirmed")
      continue;
    if (antibody.trigger.event !== "PreToolUse") continue;
    if (antibody.trigger.tool !== "*" && antibody.trigger.tool !== target.tool) {
      continue;
    }
    if (!scopeMatches(antibody.trigger.scope, target)) continue;
    if (!patternMatches(antibody.trigger.pattern, target.text)) continue;
    matching.push(antibody);
  }
  matching.sort(compareAntibodies);
  return {
    selected: matching.slice(0, normalizedLimit(options.limit)),
    expiredActiveIds: expiredActiveIds.sort(codePointCompare2)
  };
}
function renderAntibodyContext(antibodies, options = {}) {
  const maxChars = normalizedMaxChars(options.maxChars);
  let context = "";
  for (const antibody of antibodies) {
    const separator = context === "" ? "" : "\n\n";
    const heading = `[raphael:${antibody.id}]
`;
    const available = maxChars - context.length;
    if (separator.length + heading.length > available) break;
    const body = truncateToLength(
      antibody.body,
      available - separator.length - heading.length
    );
    context += `${separator}${heading}${body}`;
    if (context.length === maxChars) break;
  }
  return context;
}
function targetText(tool, input) {
  if (tool === "Bash") return input.command ?? "";
  if (tool === "Edit")
    return `${input.old_string ?? ""}
${input.new_string ?? ""}`;
  return input.content ?? "";
}
function projectRelativePosixPath(filePath, projectDir) {
  if (!filePath) return null;
  const relative = path4.relative(
    path4.resolve(projectDir),
    path4.resolve(projectDir, filePath)
  );
  if (relative === "" || relative === ".." || relative.startsWith(`..${path4.sep}`)) {
    return null;
  }
  return relative.split(path4.sep).join("/");
}
function scopeMatches(scope, target) {
  if (!scope || target.tool === "Bash") return true;
  if (target.path === null) return false;
  return globToRegExp(scope).test(target.path);
}
function patternMatches(pattern, text) {
  try {
    return new RegExp(pattern).test(text);
  } catch {
    return false;
  }
}
function globToRegExp(glob) {
  let source = "^";
  for (let index = 0; index < glob.length; index += 1) {
    const character = glob[index];
    if (character === "*" && glob[index + 1] === "*") {
      if (glob[index + 2] === "/") {
        source += "(?:[^/]+/)*";
        index += 2;
      } else {
        source += ".*";
        index += 1;
      }
    } else if (character === "*") {
      source += "[^/]*";
    } else if (character === "?") {
      source += "[^/]";
    } else {
      source += escapeRegExp(character);
    }
  }
  return new RegExp(`${source}$`);
}
function escapeRegExp(value) {
  return value.replace(/[\\^$.*+?()[\]{}|]/g, "\\$&");
}
function compareAntibodies(left, right) {
  const lastFired = compareNullableDescending(
    left.stats.last_fired,
    right.stats.last_fired
  );
  if (lastFired !== 0) return lastFired;
  const created = compareDescending(left.created, right.created);
  if (created !== 0) return created;
  return codePointCompare2(left.id, right.id);
}
function compareNullableDescending(left, right) {
  if (left === null && right === null) return 0;
  if (left === null) return 1;
  if (right === null) return -1;
  return compareDescending(left, right);
}
function compareDescending(left, right) {
  if (left < right) return 1;
  if (left > right) return -1;
  return 0;
}
function normalizedLimit(value) {
  if (value === void 0) return DEFAULT_MAX_INJECTIONS;
  return Math.max(0, Math.floor(value));
}
function normalizedMaxChars(value) {
  if (value === void 0) return DEFAULT_MAX_CONTEXT_LENGTH;
  return Math.max(0, Math.floor(value));
}
function truncateToLength(value, maxLength) {
  if (value.length <= maxLength) return value;
  let result = "";
  for (const character of value) {
    if (result.length + character.length > maxLength) break;
    result += character;
  }
  return result;
}
function utcDate(value) {
  const year = String(value.getUTCFullYear()).padStart(4, "0");
  const month = String(value.getUTCMonth() + 1).padStart(2, "0");
  const day = String(value.getUTCDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
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
  if (!isObject(value) || value.schema_version !== 1) return null;
  if (!isString(value.session) || !isPositiveInteger(value.next_event_seq))
    return null;
  if (!Array.isArray(value.recent_commands) || !value.recent_commands.every(isRecentCommand) || !Array.isArray(value.recent_edits) || !value.recent_edits.every(isRecentEdit) || !Array.isArray(value.injected) || !value.injected.every(isInjected))
    return null;
  if (!(value.last_tool === null || isLastTool(value.last_tool))) return null;
  if (!(value.last_distill_nag_digest === null || isString(value.last_distill_nag_digest) && /^[0-9a-f]{64}$/.test(value.last_distill_nag_digest)))
    return null;
  return value;
}
function isRecentCommand(value) {
  return isObject(value) && isIsoDate(value.ts) && isString(value.normalized_command) && typeof value.failed === "boolean" && isNullableFiniteNumber(value.exit_code) && (value.infection_id === null || isString(value.infection_id));
}
function isRecentEdit(value) {
  return isObject(value) && isIsoDate(value.ts) && isString(value.file_path) && isPositiveInteger(value.line_start) && isPositiveInteger(value.line_end) && value.line_end >= value.line_start;
}
function isLastTool(value) {
  return isObject(value) && isIsoDate(value.ts) && isTool(value.tool) && isString(value.input_digest);
}
function isInjected(value) {
  return isObject(value) && isIsoDate(value.ts) && isString(value.antibody_id) && isString(value.trigger_fingerprint);
}
function isObject(value) {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
function isString(value) {
  return typeof value === "string";
}
function isPositiveInteger(value) {
  return typeof value === "number" && Number.isInteger(value) && value >= 1;
}
function isNullableFiniteNumber(value) {
  return value === null || typeof value === "number" && Number.isFinite(value);
}
function isTool(value) {
  return typeof value === "string" && TOOLS2.includes(value);
}
function isIsoDate(value) {
  return typeof value === "string" && !Number.isNaN(Date.parse(value)) && new Date(value).toISOString() === value;
}
function truncate(value, maximum) {
  return value.slice(0, maximum);
}

// src/inoculate.ts
var TOOLS3 = ["Bash", "Edit", "Write"];
function isTool2(value) {
  return typeof value === "string" && TOOLS3.includes(value);
}
function sessionFor(input) {
  return typeof input.session_id === "string" && input.session_id !== "" ? input.session_id : "unknown";
}
function isToolInput(value) {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
function triggerFingerprint(target) {
  return sha256Hex(`${target.tool}\0${target.path ?? ""}\0${target.text}`);
}
function expireAntibodies(projectDir, ids) {
  for (const id of ids) {
    try {
      setAntibodyStatus(projectDir, id, "expired");
    } catch {
    }
  }
}
function main() {
  const input = readStdinSync();
  if (input?.hook_event_name !== "PreToolUse" || !isTool2(input.tool_name) || !isToolInput(input.tool_input)) {
    return;
  }
  const projectDir = resolveProjectDir(input);
  try {
    const listed = listAntibodies(projectDir);
    if (listed.errors.length > 0) return;
    const config = loadConfig(projectDir);
    const target = buildMatchTarget(
      input.tool_name,
      input.tool_input,
      projectDir
    );
    if (input.tool_name !== "Bash" && target.path === null) return;
    const matched = matchAntibodies(listed.antibodies, target, {
      limit: config.maxInjections
    });
    expireAntibodies(projectDir, matched.expiredActiveIds);
    if (matched.selected.length === 0) return;
    const fired = [];
    for (const antibody of matched.selected) {
      try {
        fired.push(recordAntibodyFire(projectDir, antibody.id));
      } catch {
      }
    }
    if (fired.length === 0) return;
    const state = loadState(projectDir, sessionFor(input));
    const ts = (/* @__PURE__ */ new Date()).toISOString();
    const fingerprint = triggerFingerprint(target);
    for (const antibody of fired) {
      state.injected.push({
        ts,
        antibody_id: antibody.id,
        trigger_fingerprint: fingerprint
      });
    }
    saveState(projectDir, state);
    const additionalContext = renderAntibodyContext(fired);
    if (additionalContext === "") return;
    process.stdout.write(
      `${JSON.stringify({
        hookSpecificOutput: { hookEventName: "PreToolUse", additionalContext }
      })}
`
    );
  } catch {
  }
}
main();
