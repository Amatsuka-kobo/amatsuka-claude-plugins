// src/check-skill-definition.ts
import fs from "node:fs";
import path from "node:path";

// src/lib/frontmatter.ts
var FIELD_LINE = /^([^:\s][^:]*):(?:\s*(.*))?$/;
function parseFrontmatter(source) {
  const lines = source.split(/\r?\n/);
  const errors = [];
  if (lines[0] !== "---") {
    return {
      fields: {},
      body: source.trim(),
      errors: ["frontmatter \u304C --- \u3067\u59CB\u307E\u3063\u3066\u3044\u306A\u3044"]
    };
  }
  const end = lines.findIndex((line, index) => index > 0 && line === "---");
  if (end === -1) {
    return {
      fields: {},
      body: "",
      errors: ["frontmatter \u306E\u7D42\u7AEF --- \u304C\u306A\u3044"]
    };
  }
  const fields = {};
  for (let index = 1; index < end; index += 1) {
    const match = lines[index].match(FIELD_LINE);
    if (!match) continue;
    const [, key, value = ""] = match;
    const hasIndentedValue = value === "|" || value === ">" || value === "" && /^\s/.test(lines[index + 1] ?? "");
    if (!hasIndentedValue) {
      fields[key] = value;
      continue;
    }
    const values = [];
    index += 1;
    while (index < end && (/^\s/.test(lines[index]) || lines[index] === "")) {
      values.push(lines[index]);
      index += 1;
    }
    index -= 1;
    fields[key] = values.join("\n").trim();
  }
  return {
    fields,
    body: lines.slice(end + 1).join("\n").trim(),
    errors
  };
}

// src/check-skill-definition.ts
var KNOWN_FIELDS = /* @__PURE__ */ new Set([
  "name",
  "description",
  "when_to_use",
  "argument-hint",
  "arguments",
  "disable-model-invocation",
  "user-invocable",
  "allowed-tools",
  "disallowed-tools",
  "model",
  "effort",
  "context",
  "agent",
  "background",
  "hooks",
  "paths",
  "shell"
]);
function usage() {
  console.error(
    "usage: node scripts/check-skill-definition.mjs <definition.md> [--type skill|command]"
  );
}
function parseArgs(args2) {
  if (args2.length === 0) return null;
  const [file, ...options] = args2;
  let type;
  for (let index = 0; index < options.length; index += 1) {
    if (options[index] !== "--type") return null;
    const value = options[index + 1];
    if (value !== "skill" && value !== "command") return null;
    type = value;
    index += 1;
  }
  return { file, type };
}
function normalizedPath(file) {
  return path.resolve(file).split(path.sep).join("/");
}
function inferType(file) {
  const normalized = normalizedPath(file);
  if (normalized.includes("/commands/") && normalized.endsWith(".md"))
    return "command";
  if (path.basename(file) === "SKILL.md") return "skill";
  return null;
}
function isValidName(name) {
  return /^[a-z0-9]$/.test(name) || /^[a-z0-9][a-z0-9-]*[a-z0-9]$/.test(name);
}
function resolveCommand(file, type, name) {
  const normalized = normalizedPath(file);
  const match = normalized.match(/\/plugins\/([^/]+)\/(?:skills|commands)\//);
  if (match) return `/${match[1]}:${name}`;
  return `/${name}`;
}
function checkDefinition(file, type, source) {
  const { fields, body, errors } = parseFrontmatter(source);
  const warnings = [];
  const hasName = "name" in fields;
  const filename = path.basename(file, path.extname(file));
  const name = type === "skill" ? hasName ? fields.name : path.basename(path.dirname(file)) : filename;
  if (type === "skill" && hasName && !isValidName(fields.name) || type === "command" && !isValidName(filename)) {
    errors.push(
      "name \u306F\u82F1\u5C0F\u6587\u5B57\u30FB\u6570\u5B57\u30FB\u30CF\u30A4\u30D5\u30F3\u306E\u307F\u3067\u6307\u5B9A\u3057\u3001\u5148\u982D\u3068\u672B\u5C3E\u306F\u30CF\u30A4\u30D5\u30F3\u4EE5\u5916\u306B\u3059\u308B"
    );
  }
  if (!fields.description && !body)
    errors.push("description \u3082\u672C\u6587\u3082\u7121\u3044\u3002\u3069\u3061\u3089\u304B\u4E00\u65B9\u306F\u8981\u308B");
  for (const key of Object.keys(fields)) {
    if (!KNOWN_FIELDS.has(key))
      errors.push(`\u4F7F\u7528\u3067\u304D\u306A\u3044 frontmatter \u30D5\u30A3\u30FC\u30EB\u30C9: ${key}`);
  }
  if (!fields.description && body)
    warnings.push("description \u304C\u672A\u6307\u5B9A\u3002\u672C\u6587\u306E\u7B2C 1 \u6BB5\u843D\u304C\u4F7F\u308F\u308C\u308B");
  const descriptionLength = [...fields.description ?? ""].length;
  const whenToUseLength = [...fields.when_to_use ?? ""].length;
  const metadataLength = descriptionLength + whenToUseLength;
  if (metadataLength > 1536) {
    warnings.push(
      `description \u3068 when_to_use \u306E\u5408\u8A08\u304C 1536 \u6587\u5B57\u3092\u8D85\u3048\u3066\u3044\u308B(${metadataLength} \u6587\u5B57)\u3002\u4E00\u89A7\u3067\u5207\u308A\u8A70\u3081\u3089\u308C\u308B`
    );
  } else if (metadataLength > 1300) {
    warnings.push(
      `description \u3068 when_to_use \u306E\u5408\u8A08\u304C\u4E0A\u9650\u306B\u8FD1\u3044(${metadataLength} \u6587\u5B57 / 1536)`
    );
  }
  const bodyLines = body ? body.split(/\r?\n/).length : 0;
  if (bodyLines > 500)
    warnings.push(
      `\u672C\u6587\u304C 500 \u884C\u3092\u8D85\u3048\u3066\u3044\u308B(${bodyLines} \u884C)\u3002references/ \u3078\u306E\u5206\u5272\u3092\u691C\u8A0E\u3059\u308B`
    );
  if (fields.context === "fork" && !fields.agent)
    warnings.push("context: fork \u306B\u5BFE\u3059\u308B agent \u304C\u672A\u6307\u5B9A");
  if (type === "command" && hasName)
    warnings.push(
      `command \u306E name \u306F\u30B3\u30DE\u30F3\u30C9\u540D\u3092\u6C7A\u3081\u306A\u3044\u3002\u547C\u3073\u51FA\u3057\u540D\u306F\u30D5\u30A1\u30A4\u30EB\u540D(${filename})\u306B\u306A\u308B`
    );
  return {
    path: file,
    type,
    name,
    command: resolveCommand(file, type, name),
    errors,
    warnings
  };
}
var args = parseArgs(process.argv.slice(2));
if (!args) {
  usage();
  process.exitCode = 2;
} else {
  const type = args.type ?? inferType(args.file);
  if (!type) {
    console.error("\u5B9A\u7FA9\u7A2E\u5225\u3092\u5224\u5225\u3067\u304D\u306A\u3044\u3002--type \u3092\u6307\u5B9A\u3059\u308B");
    process.exitCode = 2;
  } else {
    let source;
    try {
      source = fs.readFileSync(args.file, "utf8");
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      console.error(`\u5B9A\u7FA9\u30D5\u30A1\u30A4\u30EB\u3092\u8AAD\u3081\u306A\u3044: ${args.file}: ${message}`);
      process.exitCode = 2;
      process.exit();
    }
    const result = checkDefinition(args.file, type, source);
    console.log(JSON.stringify(result, null, 2));
    process.exitCode = result.errors.length === 0 ? 0 : 1;
  }
}
