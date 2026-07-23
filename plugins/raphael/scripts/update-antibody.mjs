// src/update-antibody.ts
import fs5 from "node:fs";
import path5 from "node:path";

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
var MAX_COLLISION_REALLOCATIONS = 3;
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
function createAntibody(projectDir, draft2, now = /* @__PURE__ */ new Date()) {
  const created = localDate(now);
  const datePart = `${created.slice(0, 4)}-${created.slice(5, 7)}${created.slice(8, 10)}`;
  let collisionFloor = 0;
  for (let reallocation = 0; reallocation <= MAX_COLLISION_REALLOCATIONS; reallocation += 1) {
    const sequence = nextDailySequence(projectDir, datePart, collisionFloor);
    if (sequence > 999) {
      throw new AntibodyValidationError(
        `id: daily antibody limit exceeded for ${created}`,
        "id"
      );
    }
    const id = `ab-${datePart}-${String(sequence).padStart(3, "0")}`;
    const antibody = validateAntibody({
      id,
      created,
      source: draft2.source,
      trigger: draft2.trigger,
      status: "active",
      stats: { fired: 0, last_fired: null },
      expires: draft2.expires,
      body: draft2.body
    });
    try {
      writeAntibodyCreate(projectDir, antibody);
      return antibody;
    } catch (error) {
      if (isErrorCode(error, "EEXIST")) {
        collisionFloor = sequence;
        continue;
      }
      throw error;
    }
  }
  throw new AntibodyIoError(
    `Failed to allocate antibody ID after ${MAX_COLLISION_REALLOCATIONS} reallocations`
  );
}
function writeAntibodyCreate(projectDir, value) {
  const antibody = validateAntibody(value);
  const directory = antibodiesDirectory(projectDir);
  const filePath = antibodyFilePath(projectDir, antibody.id);
  fs2.mkdirSync(directory, { recursive: true });
  try {
    fs2.writeFileSync(filePath, serializeAntibodyMarkdown(antibody), {
      encoding: "utf8",
      flag: "wx"
    });
    return antibody;
  } catch (error) {
    if (isErrorCode(error, "EEXIST")) {
      const collision = new AntibodyValidationError(
        `id: antibody already exists: ${antibody.id}`,
        "id"
      );
      collision.code = "EEXIST";
      throw collision;
    }
    throw new AntibodyIoError(
      `Failed to create antibody: ${antibody.id}`,
      error
    );
  }
}
function patchAntibody(projectDir, id, patch2) {
  assertPatch(patch2);
  const current = readAntibody(projectDir, id);
  const updated = validateAntibody({
    ...current,
    ...patch2.source === void 0 ? {} : { source: patch2.source },
    ...patch2.trigger === void 0 ? {} : { trigger: patch2.trigger },
    ...patch2.body === void 0 ? {} : { body: patch2.body }
  });
  writeAntibodyReplace(projectDir, updated);
  return updated;
}
function setAntibodyStatus(projectDir, id, status) {
  const current = readAntibody(projectDir, id);
  const updated = validateAntibody({ ...current, status });
  writeAntibodyReplace(projectDir, updated);
  return updated;
}
function extendAntibodyExpires(projectDir, id, expires) {
  const current = readAntibody(projectDir, id);
  const updated = validateAntibody({ ...current, expires });
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
function nextDailySequence(projectDir, datePart, floor) {
  const { antibodies } = listAntibodies(projectDir);
  let maximum = floor;
  for (const antibody of antibodies) {
    const match = ID_PATTERN2.exec(antibody.id);
    if (match?.[1] === datePart.slice(0, 4) && match[2] === datePart.slice(5)) {
      maximum = Math.max(maximum, Number(match[3]));
    }
  }
  return maximum + 1;
}
function assertPatch(patch2) {
  if (!isRecord2(patch2)) {
    throw new AntibodyValidationError("patch: must be an object", "patch");
  }
  for (const key of Object.keys(patch2)) {
    if (key !== "source" && key !== "trigger" && key !== "body") {
      throw new AntibodyValidationError(
        `patch.${key}: is not supported`,
        `patch.${key}`
      );
    }
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
function isRecord2(value) {
  return typeof value === "object" && value !== null && !Array.isArray(value);
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

// src/lib/infection-store.ts
import crypto2 from "node:crypto";
import fs4 from "node:fs";
import path4 from "node:path";
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
function markInfectionsDistilled(projectDir, session, ids, now = /* @__PURE__ */ new Date()) {
  const filePath = infectionFilePath(projectDir, session);
  const rawLines = readRawLines(filePath);
  if (rawLines.length === 0) return 0;
  const targetIds = new Set(ids);
  const distilledAt = now.toISOString();
  let updated = 0;
  const rewritten = rawLines.map((line) => {
    const record = parseInfectionLine(line);
    if (!record || !targetIds.has(record.id) || record.distilled) return line;
    updated += 1;
    return JSON.stringify({
      ...record,
      distilled: true,
      distilled_at: distilledAt
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
    const raw = fs4.readFileSync(filePath, "utf8");
    const lines = raw.split(/\r?\n/);
    if (lines.at(-1) === "") lines.pop();
    return lines;
  } catch {
    return [];
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

// src/update-antibody.ts
function main() {
  const options = parseArgs(process.argv.slice(2));
  const body = readRequest();
  let result;
  switch (options.operation) {
    case "create":
      assertOperandCount(options, 0);
      result = { ok: true, antibody: createAntibody(options.dir, draft(body)) };
      break;
    case "patch":
      assertOperandCount(options, 1);
      result = patch(options, body);
      break;
    case "set-status":
      assertOperandCount(options, 2);
      result = setStatus(options);
      break;
    case "extend":
      assertOperandCount(options, 1);
      result = extend(options);
      break;
    case "record-fire":
      assertOperandCount(options, 1);
      result = {
        ok: true,
        antibody: recordAntibodyFire(options.dir, options.operands[0] ?? "")
      };
      break;
    case "mark-distilled":
      assertOperandCount(options, 0);
      result = markDistilled(options.dir, body);
      break;
    default:
      throw new AntibodyValidationError(
        `operation: unsupported operation: ${options.operation}`,
        "operation"
      );
  }
  respond(result);
}
function parseArgs(args) {
  let dir;
  let dryRun = false;
  const positional = [];
  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];
    if (arg === "--dir") {
      const value = args[++index];
      if (value === void 0 || value.startsWith("--")) {
        throw new AntibodyValidationError("dir: is required", "dir");
      }
      dir = value;
    } else if (arg === "--dry-run") {
      dryRun = true;
    } else if (arg.startsWith("--")) {
      throw new AntibodyValidationError(
        `argument: unsupported option: ${arg}`,
        "argument"
      );
    } else {
      positional.push(arg);
    }
  }
  const operation = positional.shift();
  if (operation === void 0) {
    throw new AntibodyValidationError("operation: is required", "operation");
  }
  if (dryRun && operation !== "patch") {
    throw new AntibodyValidationError(
      "dry-run: is supported only by patch",
      "dry-run"
    );
  }
  return {
    dir: dir ?? process.env.CLAUDE_PROJECT_DIR ?? process.cwd(),
    operation,
    operands: positional,
    dryRun
  };
}
function readRequest() {
  let raw;
  try {
    raw = fs5.readFileSync(0, "utf8");
  } catch (error) {
    throw new AntibodyIoError("Failed to read request", error);
  }
  try {
    return JSON.parse(raw);
  } catch {
    throw new RequestError("INVALID_JSON", "request: must be valid JSON");
  }
}
function draft(value) {
  if (!isRecord3(value)) throw validation("request", "must be an object");
  assertKeys(value, ["source", "trigger", "expires", "body"]);
  return {
    source: stringField(value, "source"),
    trigger: triggerField(value.trigger),
    expires: stringField(value, "expires"),
    body: stringField(value, "body")
  };
}
function patch(options, value) {
  if (!isRecord3(value)) throw validation("patch", "must be an object");
  assertKeys(value, [], ["source", "trigger", "body"]);
  const current = readAntibody(options.dir, options.operands[0] ?? "");
  const normalized = validateAntibody({ ...current, ...value });
  if (options.dryRun) {
    return {
      ok: true,
      dry_run: true,
      antibody: normalized,
      diff: Object.keys(value).filter(
        (key) => JSON.stringify(current[key]) !== JSON.stringify(normalized[key])
      )
    };
  }
  return {
    ok: true,
    antibody: patchAntibody(options.dir, options.operands[0] ?? "", value)
  };
}
function setStatus(options) {
  const id = options.operands[0] ?? "";
  const status = statusField(options.operands[1]);
  const current = readAntibody(options.dir, id);
  assertTransition(current.status, status);
  return { ok: true, antibody: setAntibodyStatus(options.dir, id, status) };
}
function extend(options) {
  const id = options.operands[0] ?? "";
  const current = readAntibody(options.dir, id);
  if (current.status === "confirmed") {
    return { ok: true, no_op: true, antibody: current };
  }
  if (current.stats.last_fired === null) {
    throw validation("stats.last_fired", "is required to extend");
  }
  const days = loadConfig(options.dir).defaultExpiryDays;
  const expires = minDate(
    addDays(current.stats.last_fired, days),
    addDays(current.created, 90)
  );
  const antibody = extendAntibodyExpires(options.dir, id, expires);
  return {
    ok: true,
    antibody: antibody.status === "active" ? antibody : setAntibodyStatus(options.dir, id, "active")
  };
}
function markDistilled(projectDir, value) {
  if (!isRecord3(value)) throw validation("request", "must be an object");
  assertKeys(value, ["ids"]);
  if (!Array.isArray(value.ids) || !value.ids.every((id) => typeof id === "string")) {
    throw validation("ids", "must be an array of strings");
  }
  const ids = [...new Set(value.ids)];
  const found = /* @__PURE__ */ new Set();
  let updated = 0;
  const directory = path5.join(projectDir, ".raphael", "infections");
  let entries;
  try {
    entries = fs5.readdirSync(directory, { withFileTypes: true });
  } catch (error) {
    if (isErrorCode2(error, "ENOENT")) {
      return { ok: true, updated: 0, not_found: ids };
    }
    throw new AntibodyIoError("Failed to list infections", error);
  }
  for (const entry of entries) {
    if (!entry.isFile() || !entry.name.endsWith(".jsonl")) continue;
    const filePath = path5.join(directory, entry.name);
    let raw;
    try {
      raw = fs5.readFileSync(filePath, "utf8");
    } catch (error) {
      throw new AntibodyIoError(
        `Failed to read infection file: ${entry.name}`,
        error
      );
    }
    const records = raw.split(/\r?\n/).map(parseInfectionLine).filter((record) => record !== null);
    const session = records[0]?.session;
    if (session === void 0) continue;
    for (const record of records) {
      if (ids.includes(record.id)) found.add(record.id);
    }
    updated += markInfectionsDistilled(projectDir, session, ids);
  }
  return { ok: true, updated, not_found: ids.filter((id) => !found.has(id)) };
}
function assertOperandCount(options, expected) {
  if (options.operands.length !== expected) {
    throw new AntibodyValidationError(
      `operation: ${options.operation} expects ${expected} argument${expected === 1 ? "" : "s"}`,
      "operation"
    );
  }
}
function assertTransition(from, to) {
  const allowed = {
    active: ["expired", "confirmed"],
    expired: ["active", "confirmed"],
    confirmed: ["active", "expired"]
  };
  if (from !== to && !allowed[from].includes(to)) {
    throw validation("status", `cannot transition from ${from} to ${to}`);
  }
}
function statusField(value) {
  if (value === "active" || value === "expired" || value === "confirmed")
    return value;
  throw validation("status", "must be active, expired, or confirmed");
}
function triggerField(value) {
  const candidate = validateAntibody({
    id: "ab-2026-0724-001",
    created: "2026-07-24",
    source: "request",
    trigger: value,
    status: "active",
    stats: { fired: 0, last_fired: null },
    expires: "2026-08-23",
    body: "validation"
  });
  return candidate.trigger;
}
function assertKeys(value, required, optional = []) {
  for (const key of required) {
    if (!(key in value)) throw validation(key, "is required");
  }
  const allowed = /* @__PURE__ */ new Set([...required, ...optional]);
  for (const key of Object.keys(value)) {
    if (!allowed.has(key)) throw validation(key, "is not supported");
  }
}
function stringField(value, field) {
  if (typeof value[field] !== "string")
    throw validation(field, "must be a string");
  return value[field];
}
function validation(field, message) {
  return new AntibodyValidationError(`${field}: ${message}`, field);
}
function isRecord3(value) {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
function addDays(date, days) {
  const value = /* @__PURE__ */ new Date(`${date}T00:00:00.000Z`);
  value.setUTCDate(value.getUTCDate() + days);
  return value.toISOString().slice(0, 10);
}
function minDate(left, right) {
  return left <= right ? left : right;
}
function isErrorCode2(error, code) {
  return typeof error === "object" && error !== null && "code" in error && error.code === code;
}
function respond(value) {
  process.stdout.write(`${JSON.stringify(value)}
`);
}
var RequestError = class extends Error {
  constructor(code, message, field) {
    super(message);
    this.code = code;
    this.field = field;
    this.name = "RequestError";
  }
  code;
  field;
};
function failure(error) {
  if (error instanceof RequestError) {
    return {
      code: error.code,
      message: error.message,
      ...error.field === void 0 ? {} : { field: error.field }
    };
  }
  if (error instanceof AntibodyNotFoundError) {
    return {
      code: "NOT_FOUND",
      message: error.message,
      ...error.field === void 0 ? {} : { field: error.field }
    };
  }
  if (error instanceof AntibodyIoError)
    return { code: "IO_ERROR", message: error.message };
  if (error instanceof AntibodyValidationError) {
    return {
      code: "VALIDATION_ERROR",
      message: error.message,
      ...error.field === void 0 ? {} : { field: error.field }
    };
  }
  return {
    code: "RUNTIME_ERROR",
    message: error instanceof Error ? error.message : "Unexpected error"
  };
}
try {
  main();
} catch (error) {
  const result = failure(error);
  respond({ ok: false, error: result });
  process.exitCode = result.code === "IO_ERROR" || result.code === "RUNTIME_ERROR" ? 1 : 2;
}
