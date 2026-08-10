#!/usr/bin/env node
/**
 * Portions of this bundle are a TypeScript port of the skill-creator
 * Claude Code plugin (Apache License, Version 2.0), Copyright Anthropic, PBC.
 * Modified by amatsuka-koubou. See plugins/prompt-smith/NOTICE for the list
 * of changes and plugins/prompt-smith/LICENSE for the license text.
 */

// src/improve-description.ts
import { mkdir as mkdir2, readFile as readFile2, writeFile as writeFile3 } from "node:fs/promises";
import { basename as basename2, extname as extname2, join as join3 } from "node:path";
import { parseArgs as parseArgs2 } from "node:util";

// src/lib/claude-cli.ts
import { spawn } from "node:child_process";
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
async function callClaudeText(prompt, model, timeoutSeconds = 300) {
  const args = ["-p", "--output-format", "text"];
  if (model) args.push("--model", model);
  return await new Promise((resolve, reject) => {
    const child = spawn("claude", args, { env: buildEnv() });
    let stdout = "";
    let stderr = "";
    const timer = setTimeout(() => {
      child.kill("SIGKILL");
      reject(new Error(`claude -p timed out after ${timeoutSeconds}s`));
    }, timeoutSeconds * 1e3);
    child.stdout.on("data", (chunk) => {
      stdout += String(chunk);
    });
    child.stderr.on("data", (chunk) => {
      stderr += String(chunk);
    });
    child.on("error", (error) => {
      clearTimeout(timer);
      reject(error);
    });
    child.on("close", (code) => {
      clearTimeout(timer);
      if (code !== 0) {
        reject(new Error(`claude -p exited ${code}
stderr: ${stderr}`));
        return;
      }
      resolve(stdout);
    });
    child.stdin.write(prompt);
    child.stdin.end();
  });
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

// src/run-trigger-eval.ts
import { spawn as spawn2 } from "node:child_process";
import { readFile, writeFile as writeFile2 } from "node:fs/promises";
import { basename, extname, join as join2 } from "node:path";
import { parseArgs } from "node:util";

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
    const child = spawn2("claude", args, {
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

// src/improve-description.ts
var MissingDescriptionTagError = class extends Error {
  constructor() {
    super("Neither of the two responses included <new_description> tags.");
    this.name = "MissingDescriptionTagError";
  }
};
function buildImprovePrompt(input) {
  const {
    skillName,
    skillContent,
    currentDescription,
    evalResults,
    history,
    testResults
  } = input;
  const failedTriggers = evalResults.results.filter(
    (result) => result.should_trigger && !result.pass
  );
  const falseTriggers = evalResults.results.filter(
    (result) => !result.should_trigger && !result.pass
  );
  const trainScore = `${evalResults.summary.passed}/${evalResults.summary.total}`;
  const scoresSummary = testResults ? `Train: ${trainScore}, Test: ${testResults.summary.passed}/${testResults.summary.total}` : `Train: ${trainScore}`;
  let prompt = `You are optimizing a skill description for a Claude Code skill called "${skillName}". A "skill" is sort of like a prompt, but with progressive disclosure -- there's a title and description that Claude sees when deciding whether to use the skill, and then if it does use the skill, it reads the .md file which has lots more details and potentially links to other resources in the skill folder like helper files and scripts and additional documentation or examples.

The description appears in Claude's "available_skills" list. When a user sends a query, Claude decides whether to invoke the skill based solely on the title and on this description. Your goal is to write a description that triggers for relevant queries, and doesn't trigger for irrelevant ones.

Here's the current description:
<current_description>
"${currentDescription}"
</current_description>

Current scores (${scoresSummary}):
<scores_summary>
`;
  if (failedTriggers.length > 0) {
    prompt += "FAILED TO TRIGGER (should have triggered but didn't):\n";
    for (const result of failedTriggers) {
      prompt += `  - "${result.query}" (triggered ${result.triggers}/${result.runs} times)
`;
    }
    prompt += "\n";
  }
  if (falseTriggers.length > 0) {
    prompt += "FALSE TRIGGERS (triggered but shouldn't have):\n";
    for (const result of falseTriggers) {
      prompt += `  - "${result.query}" (triggered ${result.triggers}/${result.runs} times)
`;
    }
    prompt += "\n";
  }
  if (history.length > 0) {
    prompt += "PREVIOUS ATTEMPTS (do NOT repeat these \u2014 try something structurally different):\n\n";
    for (const attempt of history) {
      const trainScore2 = `${attempt.train_passed ?? attempt.passed ?? 0}/${attempt.train_total ?? attempt.total ?? 0}`;
      const testScore = attempt.test_passed !== null && attempt.test_passed !== void 0 ? `${attempt.test_passed}/${attempt.test_total ?? "?"}` : null;
      const scoreString = `train=${trainScore2}${testScore ? `, test=${testScore}` : ""}`;
      prompt += `<attempt ${scoreString}>
`;
      prompt += `Description: "${attempt.description}"
`;
      if (Object.hasOwn(attempt, "results")) {
        prompt += "Train results:\n";
        for (const result of attempt.results ?? []) {
          const status = result.pass ? "PASS" : "FAIL";
          prompt += `  [${status}] "${result.query.slice(0, 80)}" (triggered ${result.triggers}/${result.runs})
`;
        }
      }
      if (attempt.note) prompt += `Note: ${attempt.note}
`;
      prompt += "</attempt>\n\n";
    }
  }
  prompt += `</scores_summary>

Skill content (for context on what the skill does):
<skill_content>
${skillContent}
</skill_content>

Based on the failures, write a new and improved description that is more likely to trigger correctly. When I say "based on the failures", it's a bit of a tricky line to walk because we don't want to overfit to the specific cases you're seeing. So what I DON'T want you to do is produce an ever-expanding list of specific queries that this skill should or shouldn't trigger for. Instead, try to generalize from the failures to broader categories of user intent and situations where this skill would be useful or not useful. The reason for this is twofold:

1. Avoid overfitting
2. The list might get loooong and it's injected into ALL queries and there might be a lot of skills, so we don't want to blow too much space on any given description.

Concretely, your description should not be more than about 100-200 words, even if that comes at the cost of accuracy. There is a hard limit of 1024 characters \u2014 descriptions over that will be truncated, so stay comfortably under it.

Here are some tips that we've found to work well in writing these descriptions:
- The skill should be phrased in the imperative -- "Use this skill for" rather than "this skill does"
- The skill description should focus on the user's intent, what they are trying to achieve, vs. the implementation details of how the skill works.
- The description competes with other skills for Claude's attention \u2014 make it distinctive and immediately recognizable.
- If you're getting lots of failures after repeated attempts, change things up. Try different sentence structures or wordings.

I'd encourage you to be creative and mix up the style in different iterations since you'll have multiple opportunities to try different approaches and we'll just grab the highest-scoring one at the end.${" "}

Please respond with only the new description text in <new_description> tags, nothing else.`;
  return prompt;
}
function stripQuotes(value) {
  let start = 0;
  let end = value.length;
  while (start < end && value[start] === '"') start++;
  while (end > start && value[end - 1] === '"') end--;
  return value.slice(start, end);
}
function extractDescription(text) {
  const match = /<new_description>([\s\S]*?)<\/new_description>/.exec(text);
  return match ? stripQuotes(match[1].trim()) : null;
}
function buildShortenPrompt(prompt, description) {
  return `${prompt}

---

A previous attempt produced this description, which at ${description.length} characters is over the 1024-character hard limit:

"${description}"

Rewrite it to be under 1024 characters while keeping the most important trigger words and intent coverage. Respond with only the new description in <new_description> tags.`;
}
function buildTagRetryPrompt(prompt) {
  return `${prompt}

---

The previous response did not include <new_description> tags. Return only the new description enclosed in <new_description> tags.`;
}
async function requestDescriptionWithRequiredTag(prompt, model, timeoutSeconds, callClaude) {
  const response = await callClaude(prompt, model, timeoutSeconds);
  const description = extractDescription(response);
  if (description !== null) return { response, description };
  const retryPrompt = buildTagRetryPrompt(prompt);
  const retryResponse = await callClaude(retryPrompt, model, timeoutSeconds);
  return {
    response,
    description: extractDescription(retryResponse),
    retryPrompt,
    retryResponse
  };
}
function addRetryTranscript(transcript, prefix, attempt) {
  transcript[`${prefix}retry_attempted`] = attempt.retryPrompt !== void 0;
  if (attempt.retryPrompt !== void 0) {
    transcript[`${prefix}retry_prompt`] = attempt.retryPrompt;
    transcript[`${prefix}retry_response`] = attempt.retryResponse;
  }
}
async function writeTranscript(logDir, iteration, transcript) {
  if (!logDir) return;
  await mkdir2(logDir, { recursive: true });
  await writeFile3(
    join3(logDir, `improve_iter_${iteration ?? "unknown"}.json`),
    JSON.stringify(transcript, null, 2),
    "utf8"
  );
}
async function improveDescription(options) {
  const {
    callClaude = callClaudeText,
    model,
    timeoutSeconds,
    logDir,
    iteration,
    ...input
  } = options;
  const prompt = buildImprovePrompt(input);
  const initial = await requestDescriptionWithRequiredTag(
    prompt,
    model,
    timeoutSeconds,
    callClaude
  );
  let description = initial.description;
  const transcript = {
    iteration,
    prompt,
    response: initial.response,
    parsed_description: description,
    char_count: description?.length ?? null,
    over_limit: description !== null && description.length > 1024
  };
  addRetryTranscript(transcript, "", initial);
  if (description === null) {
    await writeTranscript(logDir, iteration, transcript);
    throw new MissingDescriptionTagError();
  }
  if (description.length > 1024) {
    const shortenPrompt = buildShortenPrompt(prompt, description);
    const shortenedAttempt = await requestDescriptionWithRequiredTag(
      shortenPrompt,
      model,
      timeoutSeconds,
      callClaude
    );
    const shortened = shortenedAttempt.description;
    transcript.rewrite_prompt = shortenPrompt;
    transcript.rewrite_response = shortenedAttempt.response;
    transcript.rewrite_description = shortened;
    transcript.rewrite_char_count = shortened?.length ?? null;
    addRetryTranscript(transcript, "rewrite_", shortenedAttempt);
    if (shortened === null) {
      await writeTranscript(logDir, iteration, transcript);
      throw new MissingDescriptionTagError();
    }
    description = shortened;
  }
  transcript.final_description = description;
  await writeTranscript(logDir, iteration, transcript);
  return description;
}
async function main2() {
  const { values } = parseArgs2({
    options: {
      "eval-results": { type: "string" },
      "skill-path": { type: "string" },
      history: { type: "string" },
      model: { type: "string" },
      verbose: { type: "boolean", default: false },
      "log-dir": { type: "string" },
      iteration: { type: "string" },
      timeout: { type: "string" }
    },
    strict: true,
    allowPositionals: false
  });
  if (!values["eval-results"]) throw new Error("--eval-results is required");
  if (!values["skill-path"]) throw new Error("--skill-path is required");
  if (!values.model) throw new Error("--model is required");
  const skillPath = values["skill-path"];
  let skillContent;
  try {
    skillContent = await readFile2(join3(skillPath, "SKILL.md"), "utf8");
  } catch {
    throw new Error(`No SKILL.md found at ${skillPath}`);
  }
  const evalResults = JSON.parse(
    await readFile2(values["eval-results"], "utf8")
  );
  const history = values.history ? JSON.parse(await readFile2(values.history, "utf8")) : [];
  const parsed = parseSkillMd(skillContent);
  if (values.verbose) {
    process.stderr.write(`Current: ${evalResults.description}
`);
    process.stderr.write(
      `Score: ${evalResults.summary.passed}/${evalResults.summary.total}
`
    );
  }
  const description = await improveDescription({
    skillName: parsed.name,
    skillContent: parsed.content,
    currentDescription: evalResults.description,
    evalResults,
    history,
    testResults: null,
    model: values.model,
    timeoutSeconds: parseNumericOption("timeout", values.timeout, 300),
    logDir: values["log-dir"],
    iteration: values.iteration ? Number(values.iteration) : void 0
  });
  if (values.verbose) process.stderr.write(`Improved: ${description}
`);
  const output = {
    description,
    history: [
      ...history,
      {
        description: evalResults.description,
        passed: evalResults.summary.passed,
        failed: evalResults.summary.failed,
        total: evalResults.summary.total,
        results: evalResults.results
      }
    ]
  };
  process.stdout.write(`${JSON.stringify(output, null, 2)}
`);
}
function isDirectRun2(expected) {
  const entry = process.argv[1];
  if (!entry) return false;
  return basename2(entry, extname2(entry)) === expected;
}
if (isDirectRun2("improve-description")) {
  main2().catch((error) => {
    process.stderr.write(`${error.message}
`);
    process.exitCode = 1;
  });
}
export {
  MissingDescriptionTagError,
  buildImprovePrompt,
  extractDescription,
  improveDescription
};
