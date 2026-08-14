// src/setup-agents.ts
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
var PROFILES = {
  gpt: {
    assetsDirectory: "skills/setup-gpt/assets",
    defaultAlias: (name) => {
      if (!name.startsWith("gpt-")) {
        throw new Error(`Unexpected GPT agent name: ${name}`);
      }
      return `claude-gpt-5-6-${name.slice("gpt-".length)}`;
    }
  },
  grok: {
    assetsDirectory: "skills/setup-grok/assets",
    defaultAlias: () => "claude-grok-4-5"
  }
};
function main() {
  const options = parseArgs(process.argv.slice(2));
  const profile = PROFILES[options.profile];
  const templates = loadTemplates(
    path.join(resolvePluginRoot(), profile.assetsDirectory)
  );
  validateRequestedAgents(options, templates);
  const outputRoot = resolveOutputRoot(options.dir);
  const outDir = path.join(outputRoot, ".claude", "agents");
  const agents = templates.filter(
    (template) => options.agents === void 0 || options.agents.includes(template.name)
  ).map(
    (template) => writeAgent(template, profile, options, outputRoot, outDir)
  );
  respond({ ok: true, profile: options.profile, outDir, agents });
}
function parseArgs(args) {
  let profile;
  let check = false;
  let overwrite = false;
  let agents;
  const aliases = /* @__PURE__ */ new Map();
  let dir;
  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];
    switch (arg) {
      case "--profile":
        profile = parseProfile(requireValue(args, ++index, "profile"));
        break;
      case "--check":
        check = true;
        break;
      case "--overwrite":
        overwrite = true;
        break;
      case "--agents":
        agents = parseAgents(requireValue(args, ++index, "agents"));
        break;
      case "--alias": {
        const [name, alias] = parseAlias(requireValue(args, ++index, "alias"));
        aliases.set(name, alias);
        break;
      }
      case "--dir":
        dir = requireValue(args, ++index, "dir");
        break;
      default:
        throw new Error(`Unsupported option: ${arg}`);
    }
  }
  if (profile === void 0) {
    throw new Error("profile: is required");
  }
  return {
    profile,
    check,
    overwrite,
    ...agents === void 0 ? {} : { agents },
    aliases,
    ...dir === void 0 ? {} : { dir }
  };
}
function parseProfile(value) {
  if (value === "gpt" || value === "grok") return value;
  throw new Error("profile: must be gpt or grok");
}
function parseAgents(value) {
  const agents = value.split(",").map((agent) => agent.trim());
  if (agents.length === 0 || agents.some((agent) => agent.length === 0)) {
    throw new Error("agents: must be a non-empty CSV");
  }
  return [...new Set(agents)];
}
function parseAlias(value) {
  const separator = value.indexOf("=");
  if (separator <= 0 || separator === value.length - 1) {
    throw new Error("alias: must be <name>=<alias>");
  }
  return [value.slice(0, separator), value.slice(separator + 1)];
}
function requireValue(args, index, field) {
  const value = args[index];
  if (value === void 0 || value.startsWith("--")) {
    throw new Error(`${field}: is required`);
  }
  return value;
}
function resolvePluginRoot() {
  return process.env.CLAUDE_PLUGIN_ROOT ?? path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
}
function loadTemplates(directory) {
  const files = fs.readdirSync(directory, { withFileTypes: true }).filter((entry) => entry.isFile() && entry.name.endsWith(".template.md")).map((entry) => entry.name).sort((left, right) => left.localeCompare(right));
  if (files.length === 0) {
    throw new Error(`No templates found: ${directory}`);
  }
  return files.map((file) => parseTemplate(path.join(directory, file)));
}
function parseTemplate(file) {
  const content = fs.readFileSync(file, "utf8");
  const lines = content.split("\n");
  const name = lines.slice(1, lines.indexOf("---", 1)).find((line) => line.startsWith("name: "));
  if (content.split("{{MODEL_ALIAS}}").length !== 2) {
    throw new Error(`Template must contain one model placeholder: ${file}`);
  }
  if (name === void 0 || name.length === "name: ".length) {
    throw new Error(`Template name is missing: ${file}`);
  }
  return { name: name.slice("name: ".length), content };
}
function validateRequestedAgents(options, templates) {
  const names = new Set(templates.map((template) => template.name));
  for (const name of options.agents ?? []) {
    if (!names.has(name)) {
      throw new Error(`agents: unknown agent: ${name}`);
    }
  }
  for (const name of options.aliases.keys()) {
    if (!names.has(name)) {
      throw new Error(`alias: unknown agent: ${name}`);
    }
  }
}
function resolveOutputRoot(dir) {
  if (dir !== void 0) return path.resolve(dir);
  const cwd = process.cwd();
  try {
    const root = execFileSync("git", ["rev-parse", "--show-toplevel"], {
      cwd,
      stdio: ["ignore", "pipe", "ignore"]
    }).toString().trim();
    if (root.length > 0) return root;
  } catch {
  }
  return cwd;
}
function writeAgent(template, profile, options, outputRoot, outDir) {
  const alias = options.aliases.get(template.name) ?? profile.defaultAlias(template.name);
  const content = template.content.replace("{{MODEL_ALIAS}}", alias);
  const target = path.join(outDir, `${template.name}.md`);
  const existing = readExisting(target);
  const exists = existing !== void 0;
  const upToDate = existing?.equals(Buffer.from(content, "utf8")) ?? false;
  let action;
  if (options.check) {
    action = "checked";
  } else if (exists && !options.overwrite) {
    action = "skipped";
  } else {
    fs.mkdirSync(outDir, { recursive: true });
    fs.writeFileSync(target, content);
    action = "written";
  }
  return {
    name: template.name,
    alias,
    path: path.relative(outputRoot, target).split(path.sep).join("/"),
    exists,
    upToDate,
    action
  };
}
function readExisting(target) {
  try {
    return fs.readFileSync(target);
  } catch (error) {
    if (isNotFound(error)) return void 0;
    throw error;
  }
}
function isNotFound(error) {
  return error !== null && typeof error === "object" && "code" in error && error.code === "ENOENT";
}
function respond(value) {
  process.stdout.write(`${JSON.stringify(value)}
`);
}
try {
  main();
} catch (error) {
  respond({
    ok: false,
    error: error instanceof Error ? error.message : "Unexpected error"
  });
  process.exitCode = 1;
}
