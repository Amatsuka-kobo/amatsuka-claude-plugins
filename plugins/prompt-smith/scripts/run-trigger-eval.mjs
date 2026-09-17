/**
 * Portions of this bundle are a TypeScript port of the skill-creator
 * Claude Code plugin (Apache License, Version 2.0), Copyright Anthropic, PBC.
 * Modified by amatsuka-koubou. See plugins/prompt-smith/NOTICE for the list
 * of changes and plugins/prompt-smith/LICENSE for the license text.
 */

// src/run-trigger-eval.ts
import { spawn } from "node:child_process";
import { readFile, writeFile as writeFile2 } from "node:fs/promises";
import { basename, extname, join as join2 } from "node:path";
import { parseArgs } from "node:util";

// src/lib/sandbox.ts
import { randomBytes } from "node:crypto";
import { mkdir, mkdtemp, realpath, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
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
var BLOCK_SCALARS = /* @__PURE__ */ new Set([">", "|", ">-", "|-"]);
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
    if (BLOCK_SCALARS.has(value)) {
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
var ancestorClaudeChecks = /* @__PURE__ */ new Map();
async function findAncestorClaude(dir) {
  let current = await realpath(dirname(dir));
  while (true) {
    const candidate = join(current, ".claude");
    try {
      await realpath(candidate);
      return candidate;
    } catch (error) {
      if (error.code !== "ENOENT") throw error;
    }
    const parent = await realpath(dirname(current));
    if (parent === current) return void 0;
    current = parent;
  }
}
async function assertIsolatedWorkspace(dir) {
  const tmpdirKey = await realpath(tmpdir());
  let check = ancestorClaudeChecks.get(tmpdirKey);
  if (!check) {
    check = (async () => {
      const claudeDir = await findAncestorClaude(dir);
      if (claudeDir) {
        throw new Error(
          `\u4E00\u6642\u30C7\u30A3\u30EC\u30AF\u30C8\u30EA\u306E\u7956\u5148\u306B ${claudeDir} \u304C\u898B\u3064\u304B\u308A\u307E\u3057\u305F\u3002TMPDIR \u3092 .claude \u3092\u6301\u305F\u306A\u3044\u5834\u6240\u3078\u5909\u3048\u308B\u5FC5\u8981\u304C\u3042\u308A\u307E\u3059\u3002`
        );
      }
    })();
    ancestorClaudeChecks.set(tmpdirKey, check);
  }
  await check;
}
async function createIsolatedWorkspace() {
  const dir = await mkdtemp(join(tmpdir(), "prompt-smith-cwd-"));
  try {
    await assertIsolatedWorkspace(dir);
  } catch (error) {
    await rm(dir, { recursive: true, force: true });
    throw error;
  }
  return {
    dir,
    cleanup: async () => {
      await rm(dir, { recursive: true, force: true });
    }
  };
}
async function createSandbox(skillMd, cleanName) {
  const sandbox = await createIsolatedWorkspace();
  const skillDir = join(sandbox.dir, ".claude", "skills", cleanName);
  await mkdir(skillDir, { recursive: true });
  await writeFile(join(skillDir, "SKILL.md"), skillMd, "utf8");
  return sandbox;
}

// src/lib/claude-cli.ts
var AUTH_VARS = ["ANTHROPIC_API_KEY", "ANTHROPIC_AUTH_TOKEN"];
var ISOLATION_ARGS = [
  "--setting-sources",
  "project",
  "--strict-mcp-config",
  "--settings",
  '{"disableAllHooks":true}',
  "--no-session-persistence"
];
function buildEnv(env = process.env) {
  const copy = {};
  for (const [key, value] of Object.entries(env)) {
    if (key === "CLAUDECODE") continue;
    copy[key] = value;
  }
  return copy;
}
function buildSpawnOptions(cwd, env = process.env) {
  return { cwd, env: buildEnv(env) };
}
function buildEvalArgs(query, model) {
  const args = [
    "-p",
    query,
    "--output-format",
    "stream-json",
    "--verbose",
    "--include-partial-messages"
  ];
  if (model) args.push("--model", model);
  args.push(...ISOLATION_ARGS);
  return args;
}
function killThenSettle(child, settle) {
  if (child.exitCode === null && child.signalCode === null) {
    child.once("close", settle);
    child.kill("SIGKILL");
    return;
  }
  settle();
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
var BLOCK_SCALARS2 = /* @__PURE__ */ new Set([">", "|", ">-", "|-"]);
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
      if (BLOCK_SCALARS2.has(value)) {
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

// src/lib/stream-parse.ts
function readResultError(line) {
  let event;
  try {
    event = JSON.parse(line.trim());
  } catch {
    return null;
  }
  if (event.type !== "result" || event.is_error !== true) return null;
  return String(event.result ?? "");
}
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
async function runSingleQuery(options) {
  const cleanName = makeCleanName(options.skillName);
  const measured = buildSandboxSkillMd(
    replaceDescription(options.skillContent, options.description),
    cleanName
  );
  const createQuerySandbox = options.createSandbox ?? createSandbox;
  const spawnClaude = options.spawn ?? spawn;
  const sandbox = await createQuerySandbox(measured, cleanName);
  try {
    const child = spawnClaude(
      "claude",
      buildEvalArgs(options.query, options.model),
      {
        ...buildSpawnOptions(sandbox.dir),
        stdio: ["ignore", "pipe", "ignore"]
      }
    );
    return await new Promise((resolve) => {
      const detector = new TriggerDetector(`${options.skillName}-skill-`);
      let buffer = "";
      let settled = false;
      const finish = (outcome) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        killThenSettle(child, () => resolve(outcome));
      };
      const timer = setTimeout(
        () => finish({ status: "not_triggered" }),
        options.timeout * 1e3
      );
      child.stdout.on("data", (chunk) => {
        if (settled) return;
        buffer += String(chunk);
        let newline = buffer.indexOf("\n");
        while (newline !== -1) {
          const line = buffer.slice(0, newline);
          buffer = buffer.slice(newline + 1);
          const message = readResultError(line);
          if (message !== null) {
            finish({ status: "error", message });
            return;
          }
          const verdict = detector.push(line);
          if (verdict !== null) {
            finish({ status: verdict ? "triggered" : "not_triggered" });
            return;
          }
          newline = buffer.indexOf("\n");
        }
      });
      child.on("error", (error) => {
        finish({ status: "error", message: error.message });
      });
      child.on("close", (code) => {
        if (code !== 0 && code !== null) {
          finish({ status: "error", message: `claude -p exited ${code}` });
          return;
        }
        finish({ status: "not_triggered" });
      });
    });
  } finally {
    await sandbox.cleanup();
  }
}
function aggregateOutcomes(evalSet, jobs, outcomes, triggerThreshold) {
  const outcomesByQuery = /* @__PURE__ */ new Map();
  jobs.forEach((item, index) => {
    const list = outcomesByQuery.get(item.query) ?? [];
    list.push(outcomes[index]);
    outcomesByQuery.set(item.query, list);
  });
  let errors = 0;
  const results = evalSet.map((item) => {
    const outcomesForQuery = outcomesByQuery.get(item.query) ?? [];
    const queryErrors = outcomesForQuery.filter(
      (outcome) => outcome.status === "error"
    ).length;
    const triggers = outcomesForQuery.filter(
      (outcome) => outcome.status === "triggered"
    ).length;
    const runs = outcomesForQuery.length - queryErrors;
    const triggerRate = runs === 0 ? 0 : triggers / runs;
    errors += queryErrors;
    return {
      query: item.query,
      should_trigger: item.should_trigger,
      trigger_rate: triggerRate,
      triggers,
      runs,
      errors: queryErrors,
      pass: judge(triggerRate, item.should_trigger, triggerThreshold)
    };
  });
  return { results, errors };
}
var MeasurementFailedError = class extends Error {
  name = "MeasurementFailedError";
};
function assertMeasurable(results) {
  const failed = results.find((result) => result.runs === 0);
  if (!failed) return;
  throw new MeasurementFailedError(
    `Measurement failed for query: ${failed.query}. All runs ended in errors. If authentication depends on apiKeyHelper, awsAuthRefresh, or settings env, switch to authentication through environment variables (\u74B0\u5883\u5909\u6570).`
  );
}
async function runEval(options, deps) {
  const jobs = options.evalSet.flatMap(
    (item) => Array.from({ length: options.runsPerQuery }, () => item)
  );
  const runQuery = deps?.runSingleQuery ?? runSingleQuery;
  const outcomes = await pool(jobs, options.numWorkers, async (item) => {
    try {
      return await runQuery({
        query: item.query,
        skillName: options.skillName,
        skillContent: options.skillContent,
        description: options.description,
        timeout: options.timeout,
        model: options.model
      });
    } catch (error) {
      return {
        status: "error",
        message: error instanceof Error ? error.message : String(error)
      };
    }
  });
  const aggregated = aggregateOutcomes(
    options.evalSet,
    jobs,
    outcomes,
    options.triggerThreshold
  );
  if (aggregated.errors > 0) {
    process.stderr.write(
      `Warning: ${aggregated.errors} query run(s) failed and were excluded from trigger rates.
`
    );
    const errorMessages = [
      ...new Set(
        outcomes.flatMap(
          (outcome) => outcome.status === "error" ? [outcome.message] : []
        )
      )
    ];
    const displayedMessages = errorMessages.slice(0, 5);
    for (const message of displayedMessages) {
      process.stderr.write(`  Cause: ${message}
`);
    }
    if (errorMessages.length > displayedMessages.length) {
      process.stderr.write(
        `  ... ${errorMessages.length - displayedMessages.length} additional error cause(s) omitted.
`
      );
    }
  }
  if (options.verbose) {
    for (const result of aggregated.results) {
      process.stderr.write(
        `  [${result.pass ? "PASS" : "FAIL"}] rate=${result.triggers}/${result.runs} expected=${result.should_trigger}: ${result.query.slice(0, 60)}
`
      );
    }
  }
  assertMeasurable(aggregated.results);
  const passed = aggregated.results.filter((result) => result.pass).length;
  return {
    skill_name: options.skillName,
    description: options.description,
    environment: describeEnvironment(options.model),
    results: aggregated.results,
    summary: {
      total: aggregated.results.length,
      passed,
      failed: aggregated.results.length - passed
    },
    errors: aggregated.errors
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
function isDirectRun(expected) {
  const entry = process.argv[1];
  if (!entry) return false;
  return basename(entry, extname(entry)) === expected;
}
if (isDirectRun("run-trigger-eval")) {
  main().catch((error) => {
    process.stderr.write(`${error.message}
`);
    process.exitCode = 1;
  });
}
export {
  MeasurementFailedError,
  aggregateOutcomes,
  assertMeasurable,
  parseEvalSet,
  parseNumericOption,
  runEval,
  runSingleQuery
};
