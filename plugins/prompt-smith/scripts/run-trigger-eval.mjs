/**
 * Portions of this bundle are a TypeScript port of the skill-creator
 * Claude Code plugin (Apache License, Version 2.0), Copyright Anthropic, PBC.
 * Modified by amatsuka-koubou. See plugins/prompt-smith/NOTICE for the list
 * of changes and plugins/prompt-smith/LICENSE for the license text.
 */

// src/run-trigger-eval.ts
import { spawn } from "node:child_process";
import { readFile, writeFile as writeFile2 } from "node:fs/promises";
import { join as join2 } from "node:path";
import { pathToFileURL } from "node:url";
import { parseArgs } from "node:util";

// src/lib/claude-cli.ts
var AUTH_VARS = ["ANTHROPIC_API_KEY", "ANTHROPIC_AUTH_TOKEN"];
function buildEnv(env = process.env) {
  const copy = {};
  for (const [key, value] of Object.entries(env)) {
    if (key === "CLAUDECODE") continue;
    copy[key] = value;
  }
  return copy;
}
function describeEnvironment(model, env = process.env) {
  const authSource = AUTH_VARS.find((name) => env[name]) ?? "(claude.ai login)";
  return {
    base_url: env.ANTHROPIC_BASE_URL ?? "(default)",
    auth_source: authSource,
    model: model ?? null
  };
}

// src/lib/parse-skill-md.ts
function stripChar(value, ch) {
  let start = 0;
  let end = value.length;
  while (start < end && value[start] === ch) start++;
  while (end > start && value[end - 1] === ch) end--;
  return value.slice(start, end);
}
function unquote(value) {
  return stripChar(stripChar(value, '"'), "'");
}
var BLOCK_SCALARS = /* @__PURE__ */ new Set([">", "|", ">-", "|-"]);
function parseSkillMd(content) {
  const lines = content.split("\n");
  if (lines[0]?.trim() !== "---") {
    throw new Error("SKILL.md missing frontmatter (no opening ---)");
  }
  let endIdx = -1;
  for (let i2 = 1; i2 < lines.length; i2++) {
    if (lines[i2].trim() === "---") {
      endIdx = i2;
      break;
    }
  }
  if (endIdx === -1) {
    throw new Error("SKILL.md missing frontmatter (no closing ---)");
  }
  const frontmatter = lines.slice(1, endIdx);
  let name = "";
  let description = "";
  let i = 0;
  while (i < frontmatter.length) {
    const line = frontmatter[i];
    if (line.startsWith("name:")) {
      name = unquote(line.slice("name:".length).trim());
    } else if (line.startsWith("description:")) {
      const value = line.slice("description:".length).trim();
      if (BLOCK_SCALARS.has(value)) {
        const continuation = [];
        i++;
        while (i < frontmatter.length && (frontmatter[i].startsWith("  ") || frontmatter[i].startsWith("	"))) {
          continuation.push(frontmatter[i].trim());
          i++;
        }
        description = continuation.join(" ");
        continue;
      }
      description = unquote(value);
    }
    i++;
  }
  return { name, description, content };
}

// src/lib/pool.ts
async function pool(items, workers, fn) {
  const results = new Array(items.length);
  let next = 0;
  const limit = Math.max(1, Math.min(workers, items.length));
  const worker = async () => {
    while (true) {
      const index = next++;
      if (index >= items.length) return;
      results[index] = await fn(items[index], index);
    }
  };
  await Promise.all(Array.from({ length: limit }, () => worker()));
  return results;
}

// src/lib/sandbox.ts
import { randomBytes } from "node:crypto";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
function makeCleanName(skillName) {
  return `${skillName}-skill-${randomBytes(4).toString("hex")}`;
}
function splitFrontmatter(original) {
  const lines = original.split("\n");
  if (lines[0]?.trim() !== "---") {
    throw new Error("SKILL.md missing frontmatter (no opening ---)");
  }
  let endIdx = -1;
  for (let i = 1; i < lines.length; i++) {
    if (lines[i].trim() === "---") {
      endIdx = i;
      break;
    }
  }
  if (endIdx === -1) {
    throw new Error("SKILL.md missing frontmatter (no closing ---)");
  }
  return { frontmatter: lines.slice(1, endIdx), body: lines.slice(endIdx + 1) };
}
function joinFrontmatter(frontmatter, body) {
  return ["---", ...frontmatter, "---", ...body].join("\n");
}
function buildSandboxSkillMd(original, cleanName) {
  const { frontmatter, body } = splitFrontmatter(original);
  let sawInvocationKey = false;
  const rewritten = frontmatter.map((line) => {
    if (line.startsWith("name:")) return `name: ${cleanName}`;
    if (line.startsWith("disable-model-invocation:")) {
      sawInvocationKey = true;
      return "disable-model-invocation: false";
    }
    return line;
  });
  if (!sawInvocationKey) rewritten.push("disable-model-invocation: false");
  return joinFrontmatter(rewritten, body);
}
var BLOCK_SCALARS2 = /* @__PURE__ */ new Set([">", "|", ">-", "|-"]);
function replaceDescription(original, description) {
  const { frontmatter, body } = splitFrontmatter(original);
  const rewritten = [];
  let i = 0;
  let replaced = false;
  while (i < frontmatter.length) {
    const line = frontmatter[i];
    if (!line.startsWith("description:")) {
      rewritten.push(line);
      i++;
      continue;
    }
    const value = line.slice("description:".length).trim();
    i++;
    if (BLOCK_SCALARS2.has(value)) {
      while (i < frontmatter.length) {
        const next = frontmatter[i];
        if (next.trim() === "") {
          i++;
          continue;
        }
        if (next.startsWith("  ") || next.startsWith("	")) {
          i++;
          continue;
        }
        break;
      }
    }
    rewritten.push(`description: ${JSON.stringify(description)}`);
    replaced = true;
  }
  if (!replaced) rewritten.push(`description: ${JSON.stringify(description)}`);
  return joinFrontmatter(rewritten, body);
}
async function createSandbox(skillMd, cleanName) {
  const dir = await mkdtemp(join(tmpdir(), "prompt-smith-eval-"));
  const skillDir = join(dir, ".claude", "skills", cleanName);
  await mkdir(skillDir, { recursive: true });
  await writeFile(join(skillDir, "SKILL.md"), skillMd, "utf8");
  return {
    dir,
    cleanup: async () => {
      await rm(dir, { recursive: true, force: true });
    }
  };
}

// src/lib/stream-parse.ts
function judge(triggerRate, shouldTrigger, threshold) {
  return shouldTrigger ? triggerRate >= threshold : triggerRate < threshold;
}
var TriggerDetector = class {
  constructor(prefix) {
    this.prefix = prefix;
  }
  prefix;
  pendingSkillTool = false;
  accumulated = "";
  /** 判定が確定したら true/false、確定していなければ null を返す。 */
  push(line) {
    const trimmed = line.trim();
    if (trimmed === "") return null;
    let event;
    try {
      event = JSON.parse(trimmed);
    } catch {
      return null;
    }
    if (event.type === "stream_event") {
      return this.pushStreamEvent(
        event.event ?? {}
      );
    }
    if (event.type === "assistant") {
      return this.pushAssistant(event);
    }
    if (event.type === "result") {
      return false;
    }
    return null;
  }
  pushStreamEvent(se) {
    const seType = se.type;
    if (seType === "content_block_start") {
      const block = se.content_block ?? {};
      if (block.type !== "tool_use") return null;
      if (block.name === "Skill") {
        this.pendingSkillTool = true;
        this.accumulated = "";
        return null;
      }
      return false;
    }
    if (seType === "content_block_delta" && this.pendingSkillTool) {
      const delta = se.delta ?? {};
      if (delta.type === "input_json_delta") {
        this.accumulated += String(delta.partial_json ?? "");
        if (this.accumulated.includes(this.prefix)) return true;
      }
      return null;
    }
    if (seType === "content_block_stop" || seType === "message_stop") {
      if (this.pendingSkillTool) return this.accumulated.includes(this.prefix);
      if (seType === "message_stop") return false;
      return null;
    }
    return null;
  }
  pushAssistant(event) {
    const message = event.message ?? {};
    const content = message.content ?? [];
    for (const item of content) {
      if (item.type !== "tool_use") continue;
      if (item.name !== "Skill") return false;
      const input = item.input ?? {};
      return String(input.skill ?? "").includes(this.prefix);
    }
    return null;
  }
};

// src/run-trigger-eval.ts
async function runSingleQuery(query, skillName, skillContent, description, timeout, model) {
  const cleanName = makeCleanName(skillName);
  const measured = buildSandboxSkillMd(
    replaceDescription(skillContent, description),
    cleanName
  );
  const sandbox = await createSandbox(measured, cleanName);
  try {
    const args = [
      "-p",
      query,
      "--output-format",
      "stream-json",
      "--verbose",
      "--include-partial-messages"
    ];
    if (model) args.push("--model", model);
    const child = spawn("claude", args, {
      cwd: sandbox.dir,
      env: buildEnv(),
      stdio: ["ignore", "pipe", "ignore"]
    });
    return await new Promise((resolve) => {
      const detector = new TriggerDetector(`${skillName}-skill-`);
      let buffer = "";
      let settled = false;
      const finish = (value) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        if (child.exitCode === null && child.signalCode === null) {
          child.once("close", () => resolve(value));
          child.kill("SIGKILL");
          return;
        }
        resolve(value);
      };
      const timer = setTimeout(() => finish(false), timeout * 1e3);
      child.stdout.on("data", (chunk) => {
        if (settled) return;
        buffer += String(chunk);
        let newline = buffer.indexOf("\n");
        while (newline !== -1) {
          const line = buffer.slice(0, newline);
          buffer = buffer.slice(newline + 1);
          const verdict = detector.push(line);
          if (verdict !== null) {
            finish(verdict);
            return;
          }
          newline = buffer.indexOf("\n");
        }
      });
      child.on("error", (error) => {
        process.stderr.write(`Warning: query failed: ${error.message}
`);
        finish(false);
      });
      child.on("close", () => finish(false));
    });
  } finally {
    await sandbox.cleanup();
  }
}
async function runEval(options) {
  const jobs = options.evalSet.flatMap(
    (item) => Array.from({ length: options.runsPerQuery }, () => item)
  );
  const outcomes = await pool(jobs, options.numWorkers, async (item) => {
    try {
      return await runSingleQuery(
        item.query,
        options.skillName,
        options.skillContent,
        options.description,
        options.timeout,
        options.model
      );
    } catch (error) {
      process.stderr.write(
        `Warning: query failed: ${error.message}
`
      );
      return false;
    }
  });
  const triggersByQuery = /* @__PURE__ */ new Map();
  jobs.forEach((item, index) => {
    const list = triggersByQuery.get(item.query) ?? [];
    list.push(outcomes[index] ? 1 : 0);
    triggersByQuery.set(item.query, list);
  });
  const results = options.evalSet.map((item) => {
    const outcomesForQuery = triggersByQuery.get(item.query) ?? [];
    const triggers = outcomesForQuery.reduce((sum, value) => sum + value, 0);
    const runs = outcomesForQuery.length;
    const triggerRate = runs === 0 ? 0 : triggers / runs;
    const passed2 = judge(
      triggerRate,
      item.should_trigger,
      options.triggerThreshold
    );
    if (options.verbose) {
      process.stderr.write(
        `  [${passed2 ? "PASS" : "FAIL"}] rate=${triggers}/${runs} expected=${item.should_trigger}: ${item.query.slice(0, 60)}
`
      );
    }
    return {
      query: item.query,
      should_trigger: item.should_trigger,
      trigger_rate: triggerRate,
      triggers,
      runs,
      pass: passed2
    };
  });
  const passed = results.filter((r) => r.pass).length;
  return {
    skill_name: options.skillName,
    description: options.description,
    environment: describeEnvironment(options.model),
    results,
    summary: { total: results.length, passed, failed: results.length - passed }
  };
}
function parseNumericOption(name, value, defaultValue, integer = false) {
  if (value === void 0) return defaultValue;
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || integer && !Number.isInteger(parsed)) {
    throw new Error(`--${name} must be ${integer ? "an integer" : "a number"}`);
  }
  return parsed;
}
function parseEvalSet(content) {
  const value = JSON.parse(content);
  if (!Array.isArray(value))
    throw new Error("--eval-set must contain a JSON array");
  const evalSet = value.map((item, index) => {
    if (typeof item !== "object" || item === null || typeof item.query !== "string" || typeof item.should_trigger !== "boolean") {
      throw new Error(`invalid eval item at index ${index}`);
    }
    return item;
  });
  const seen = /* @__PURE__ */ new Set();
  for (const item of evalSet) {
    if (seen.has(item.query))
      throw new Error(`duplicate query in eval set: ${item.query}`);
    seen.add(item.query);
  }
  return evalSet;
}
async function main() {
  const { values } = parseArgs({
    options: {
      "skill-path": { type: "string" },
      "eval-set": { type: "string" },
      description: { type: "string" },
      out: { type: "string" },
      "runs-per-query": { type: "string" },
      "num-workers": { type: "string" },
      timeout: { type: "string" },
      "trigger-threshold": { type: "string" },
      model: { type: "string" },
      verbose: { type: "boolean", default: false }
    },
    strict: true,
    allowPositionals: false
  });
  if (!values["skill-path"]) throw new Error("--skill-path is required");
  if (!values["eval-set"]) throw new Error("--eval-set is required");
  const originalContent = await readFile(
    join2(values["skill-path"], "SKILL.md"),
    "utf8"
  );
  const parsed = parseSkillMd(originalContent);
  const description = values.description ?? parsed.description;
  const skillContent = values.description ? replaceDescription(parsed.content, description) : parsed.content;
  const evalSet = parseEvalSet(await readFile(values["eval-set"], "utf8"));
  const result = await runEval({
    evalSet,
    skillName: parsed.name,
    skillContent,
    description,
    runsPerQuery: parseNumericOption(
      "runs-per-query",
      values["runs-per-query"],
      3,
      true
    ),
    numWorkers: parseNumericOption(
      "num-workers",
      values["num-workers"],
      10,
      true
    ),
    timeout: parseNumericOption("timeout", values.timeout, 30),
    triggerThreshold: parseNumericOption(
      "trigger-threshold",
      values["trigger-threshold"],
      0.5
    ),
    model: values.model,
    verbose: values.verbose
  });
  const json = `${JSON.stringify(result, null, 2)}
`;
  if (values.out) {
    await writeFile2(values.out, json, "utf8");
  } else {
    process.stdout.write(json);
  }
}
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((error) => {
    process.stderr.write(`${error.message}
`);
    process.exitCode = 1;
  });
}
export {
  parseEvalSet,
  parseNumericOption,
  runEval
};
