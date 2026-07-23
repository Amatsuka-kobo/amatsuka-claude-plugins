// src/lib/antibody-store.ts
import fs from "node:fs";
import path from "node:path";

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
var AntibodyIoError = class extends Error {
  cause;
  constructor(message, cause) {
    super(message);
    this.name = "AntibodyIoError";
    this.cause = cause;
  }
};
function antibodiesDirectory(projectDir) {
  return path.join(projectDir, ".raphael", "antibodies");
}
function listAntibodies(projectDir) {
  const directory = antibodiesDirectory(projectDir);
  let entries;
  try {
    entries = fs.readdirSync(directory, { withFileTypes: true });
  } catch (error) {
    if (isErrorCode(error, "ENOENT")) return { antibodies: [], errors: [] };
    throw new AntibodyIoError("Failed to list antibodies", error);
  }
  const antibodies = [];
  const errors = [];
  const files = entries.filter((entry) => entry.isFile() && entry.name.endsWith(".md")).map((entry) => entry.name).sort(codePointCompare);
  for (const file of files) {
    try {
      const raw = fs.readFileSync(path.join(directory, file), "utf8");
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

// src/list-antibodies.ts
function main() {
  try {
    const options = parseArgs(process.argv.slice(2));
    const result = listAntibodies(options.dir);
    const antibodies = result.antibodies.filter(
      (antibody) => options.status === void 0 || antibody.status === options.status
    ).filter(
      (antibody) => options.id === void 0 || antibody.id === options.id
    ).sort((left, right) => left.id.localeCompare(right.id)).map((antibody) => serializeForJson(antibody, options.includeBody));
    if (options.json) {
      respond({ ok: true, antibodies, errors: result.errors });
    } else {
      process.stdout.write(table(antibodies));
    }
  } catch (error) {
    fail(error);
  }
}
function parseArgs(args) {
  let dir;
  let json = false;
  let includeBody = false;
  let status;
  let id;
  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];
    switch (arg) {
      case "--dir":
        dir = requireValue(args, ++index, "dir");
        break;
      case "--json":
        json = true;
        break;
      case "--include-body":
        includeBody = true;
        break;
      case "--status": {
        const value = requireValue(args, ++index, "status");
        if (value !== "active" && value !== "expired" && value !== "confirmed") {
          throw new AntibodyValidationError(
            "status: must be active, expired, or confirmed",
            "status"
          );
        }
        status = value;
        break;
      }
      case "--id":
        id = requireValue(args, ++index, "id");
        break;
      default:
        throw new AntibodyValidationError(
          `argument: unsupported option: ${arg}`,
          "argument"
        );
    }
  }
  return {
    dir: dir ?? process.env.CLAUDE_PROJECT_DIR ?? process.cwd(),
    json,
    includeBody,
    ...status === void 0 ? {} : { status },
    ...id === void 0 ? {} : { id }
  };
}
function requireValue(args, index, field) {
  const value = args[index];
  if (value === void 0 || value.startsWith("--")) {
    throw new AntibodyValidationError(`${field}: is required`, field);
  }
  return value;
}
function serializeForJson(antibody, includeBody) {
  if (includeBody) return antibody;
  const { body: _body, ...withoutBody } = antibody;
  return withoutBody;
}
function table(antibodies) {
  const columns = ["ID", "STATUS", "FIRED", "LAST_FIRED", "EXPIRES", "SOURCE"];
  const rows = antibodies.map((antibody) => [
    antibody.id,
    antibody.status,
    String(antibody.stats.fired),
    antibody.stats.last_fired ?? "-",
    antibody.expires,
    antibody.source
  ]);
  const widths = columns.map(
    (column, index) => Math.max(column.length, ...rows.map((row) => row[index]?.length ?? 0))
  );
  const format = (row) => row.map((value, index) => value.padEnd(widths[index] ?? 0)).join("  ").trimEnd();
  return `${format(columns)}
${rows.map(format).join("\n")}${rows.length === 0 ? "" : "\n"}`;
}
function fail(error) {
  const failure = toFailure(error);
  respond({ ok: false, error: failure });
  process.exitCode = failure.code === "IO_ERROR" ? 1 : 2;
  throw new ExitHandledError();
}
function toFailure(error) {
  if (error instanceof AntibodyIoError) {
    return { code: "IO_ERROR", message: error.message };
  }
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
function respond(value) {
  process.stdout.write(`${JSON.stringify(value)}
`);
}
var ExitHandledError = class extends Error {
};
try {
  main();
} catch (error) {
  if (!(error instanceof ExitHandledError)) {
    process.stdout.write(
      `${JSON.stringify({ ok: false, error: toFailure(error) })}
`
    );
    process.exitCode = error instanceof AntibodyIoError ? 1 : 2;
  }
}
