#!/usr/bin/env node
/**
 * Portions of this bundle are a TypeScript port of the skill-creator
 * Claude Code plugin (Apache License, Version 2.0), Copyright Anthropic, PBC.
 * Modified by amatsuka-koubou. See plugins/prompt-smith/NOTICE for the list
 * of changes and plugins/prompt-smith/LICENSE for the license text.
 */

// src/run-loop.ts
import { mkdir as mkdir3, readFile as readFile3, writeFile as writeFile4 } from "node:fs/promises";
import { basename as basename3, extname as extname3, join as join4 } from "node:path";
import { parseArgs as parseArgs3 } from "node:util";

// src/improve-description.ts
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { basename, extname, join } from "node:path";
import { parseArgs } from "node:util";

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

// src/improve-description.ts
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
  return stripQuotes((match?.[1] ?? text).trim());
}
function buildShortenPrompt(prompt, description) {
  return `${prompt}

---

A previous attempt produced this description, which at ${description.length} characters is over the 1024-character hard limit:

"${description}"

Rewrite it to be under 1024 characters while keeping the most important trigger words and intent coverage. Respond with only the new description in <new_description> tags.`;
}
async function improveDescription(options) {
  const {
    callClaude = callClaudeText,
    model,
    logDir,
    iteration,
    ...input
  } = options;
  const prompt = buildImprovePrompt(input);
  const text = await callClaude(prompt, model);
  let description = extractDescription(text);
  const transcript = {
    iteration,
    prompt,
    response: text,
    parsed_description: description,
    char_count: description.length,
    over_limit: description.length > 1024
  };
  if (description.length > 1024) {
    const shortenPrompt = buildShortenPrompt(prompt, description);
    const shortenText = await callClaude(shortenPrompt, model);
    const shortened = extractDescription(shortenText);
    transcript.rewrite_prompt = shortenPrompt;
    transcript.rewrite_response = shortenText;
    transcript.rewrite_description = shortened;
    transcript.rewrite_char_count = shortened.length;
    description = shortened;
  }
  transcript.final_description = description;
  if (logDir) {
    await mkdir(logDir, { recursive: true });
    await writeFile(
      join(logDir, `improve_iter_${iteration ?? "unknown"}.json`),
      JSON.stringify(transcript, null, 2),
      "utf8"
    );
  }
  return description;
}
async function main() {
  const { values } = parseArgs({
    options: {
      "eval-results": { type: "string" },
      "skill-path": { type: "string" },
      history: { type: "string" },
      model: { type: "string" },
      verbose: { type: "boolean", default: false },
      "log-dir": { type: "string" },
      iteration: { type: "string" }
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
    skillContent = await readFile(join(skillPath, "SKILL.md"), "utf8");
  } catch {
    throw new Error(`No SKILL.md found at ${skillPath}`);
  }
  const evalResults = JSON.parse(
    await readFile(values["eval-results"], "utf8")
  );
  const history = values.history ? JSON.parse(await readFile(values.history, "utf8")) : [];
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
function isDirectRun(expected) {
  const entry = process.argv[1];
  if (!entry) return false;
  return basename(entry, extname(entry)) === expected;
}
if (isDirectRun("improve-description")) {
  main().catch((error) => {
    process.stderr.write(`${error.message}
`);
    process.exitCode = 1;
  });
}

// src/lib/split-eval-set.ts
function mulberry32(seed) {
  let state = seed >>> 0;
  return () => {
    state = state + 1831565813 >>> 0;
    let t = state;
    t = Math.imul(t ^ t >>> 15, t | 1);
    t ^= t + Math.imul(t ^ t >>> 7, t | 61);
    return ((t ^ t >>> 14) >>> 0) / 4294967296;
  };
}
function shuffled(items, rand) {
  const copy = [...items];
  for (let i = copy.length - 1; i > 0; i--) {
    const j = Math.floor(rand() * (i + 1));
    [copy[i], copy[j]] = [copy[j], copy[i]];
  }
  return copy;
}
function splitEvalSet(evalSet, holdout, seed = 42) {
  const rand = mulberry32(seed);
  const positives = shuffled(
    evalSet.filter((e) => e.should_trigger),
    rand
  );
  const negatives = shuffled(
    evalSet.filter((e) => !e.should_trigger),
    rand
  );
  const nPositiveTest = Math.max(1, Math.floor(positives.length * holdout));
  const nNegativeTest = Math.max(1, Math.floor(negatives.length * holdout));
  return {
    test: [
      ...positives.slice(0, nPositiveTest),
      ...negatives.slice(0, nNegativeTest)
    ],
    train: [
      ...positives.slice(nPositiveTest),
      ...negatives.slice(nNegativeTest)
    ]
  };
}

// src/run-trigger-eval.ts
import { spawn as spawn2 } from "node:child_process";
import { readFile as readFile2, writeFile as writeFile3 } from "node:fs/promises";
import { basename as basename2, extname as extname2, join as join3 } from "node:path";
import { parseArgs as parseArgs2 } from "node:util";

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
import { mkdir as mkdir2, mkdtemp, rm, writeFile as writeFile2 } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join as join2 } from "node:path";
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
  const dir = await mkdtemp(join2(tmpdir(), "prompt-smith-eval-"));
  const skillDir = join2(dir, ".claude", "skills", cleanName);
  await mkdir2(skillDir, { recursive: true });
  await writeFile2(join2(skillDir, "SKILL.md"), skillMd, "utf8");
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
async function main2() {
  const { values } = parseArgs2({
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
  const originalContent = await readFile2(
    join3(values["skill-path"], "SKILL.md"),
    "utf8"
  );
  const parsed = parseSkillMd(originalContent);
  const description = values.description ?? parsed.description;
  const skillContent = values.description ? replaceDescription(parsed.content, description) : parsed.content;
  const evalSet = parseEvalSet(await readFile2(values["eval-set"], "utf8"));
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
    await writeFile3(values.out, json, "utf8");
  } else {
    process.stdout.write(json);
  }
}
function isDirectRun2(expected) {
  const entry = process.argv[1];
  if (!entry) return false;
  return basename2(entry, extname2(entry)) === expected;
}
if (isDirectRun2("run-trigger-eval")) {
  main2().catch((error) => {
    process.stderr.write(`${error.message}
`);
    process.exitCode = 1;
  });
}

// src/run-loop.ts
function score(record, hasTestSet) {
  return hasTestSet ? record.test_passed ?? 0 : record.train_passed;
}
function selectBest(history, hasTestSet) {
  return history.reduce(
    (best, candidate) => score(candidate, hasTestSet) > score(best, hasTestSet) ? candidate : best
  );
}
function blindHistory(history) {
  return history.map(
    (record) => Object.fromEntries(
      Object.entries(record).filter(([key]) => !key.startsWith("test_"))
    )
  );
}
function makeLoopResult(history, hasTestSet, exitReason, originalDescription, currentDescription, holdout, trainSize, testSize) {
  const best = selectBest(history, hasTestSet);
  const bestScore = hasTestSet ? `${best.test_passed}/${best.test_total}` : `${best.train_passed}/${best.train_total}`;
  return {
    exit_reason: exitReason,
    original_description: originalDescription,
    best_description: best.description,
    best_score: bestScore,
    best_train_score: `${best.train_passed}/${best.train_total}`,
    best_test_score: hasTestSet ? `${best.test_passed}/${best.test_total}` : null,
    final_description: currentDescription,
    iterations_run: history.length,
    holdout,
    train_size: trainSize,
    test_size: testSize,
    history
  };
}
function printEvalStats(label, results, elapsedSeconds) {
  const positives = results.filter((result) => result.should_trigger);
  const negatives = results.filter((result) => !result.should_trigger);
  const truePositives = positives.reduce(
    (sum, result) => sum + result.triggers,
    0
  );
  const positiveRuns = positives.reduce((sum, result) => sum + result.runs, 0);
  const falseNegatives = positiveRuns - truePositives;
  const falsePositives = negatives.reduce(
    (sum, result) => sum + result.triggers,
    0
  );
  const negativeRuns = negatives.reduce((sum, result) => sum + result.runs, 0);
  const trueNegatives = negativeRuns - falsePositives;
  const total = truePositives + trueNegatives + falsePositives + falseNegatives;
  const precision = truePositives + falsePositives > 0 ? truePositives / (truePositives + falsePositives) : 1;
  const recall = truePositives + falseNegatives > 0 ? truePositives / (truePositives + falseNegatives) : 1;
  const accuracy = total > 0 ? (truePositives + trueNegatives) / total : 0;
  process.stderr.write(
    `${label}: ${truePositives + trueNegatives}/${total} correct, precision=${Math.round(precision * 100)}% recall=${Math.round(recall * 100)}% accuracy=${Math.round(accuracy * 100)}% (${elapsedSeconds.toFixed(1)}s)
`
  );
  for (const result of results) {
    process.stderr.write(
      `  [${result.pass ? "PASS" : "FAIL"}] rate=${result.triggers}/${result.runs} expected=${result.should_trigger}: ${result.query.slice(0, 60)}
`
    );
  }
}
async function runLoop(options) {
  const {
    evalSet,
    skillName,
    skillContent,
    originalDescription,
    descriptionOverride,
    numWorkers = 10,
    timeout = 30,
    maxIterations = 5,
    runsPerQuery = 3,
    triggerThreshold = 0.5,
    holdout = 0.4,
    model,
    verbose = false,
    logDir,
    runEval: runEval2 = runEval,
    improveDescription: improveDescription2 = improveDescription,
    onIteration
  } = options;
  let currentDescription = descriptionOverride ?? originalDescription;
  const { train: trainSet, test: testSet } = holdout > 0 ? splitEvalSet(evalSet, holdout) : { train: evalSet, test: [] };
  if (verbose && holdout > 0) {
    process.stderr.write(
      `Split: ${trainSet.length} train, ${testSet.length} test (holdout=${holdout})
`
    );
  }
  const history = [];
  let exitReason = "unknown";
  for (let iteration = 1; iteration <= maxIterations; iteration++) {
    if (verbose) {
      process.stderr.write(`
${"=".repeat(60)}
`);
      process.stderr.write(`Iteration ${iteration}/${maxIterations}
`);
      process.stderr.write(`Description: ${currentDescription}
`);
      process.stderr.write(`${"=".repeat(60)}
`);
    }
    const allQueries = [...trainSet, ...testSet];
    const evalStarted = performance.now();
    const allResults = await runEval2({
      evalSet: allQueries,
      skillName,
      skillContent,
      description: currentDescription,
      numWorkers,
      timeout,
      runsPerQuery,
      triggerThreshold,
      model,
      verbose: false
    });
    const evalElapsed = (performance.now() - evalStarted) / 1e3;
    const trainQueries = new Set(trainSet.map((item) => item.query));
    const trainResultList = allResults.results.filter(
      (result2) => trainQueries.has(result2.query)
    );
    const testResultList = allResults.results.filter(
      (result2) => !trainQueries.has(result2.query)
    );
    const trainPassed = trainResultList.filter((result2) => result2.pass).length;
    const testPassed = testResultList.filter((result2) => result2.pass).length;
    const record = {
      iteration,
      description: currentDescription,
      train_passed: trainPassed,
      train_failed: trainResultList.length - trainPassed,
      train_total: trainResultList.length,
      train_results: trainResultList,
      test_passed: testSet.length > 0 ? testPassed : null,
      test_failed: testSet.length > 0 ? testResultList.length - testPassed : null,
      test_total: testSet.length > 0 ? testResultList.length : null,
      test_results: testSet.length > 0 ? testResultList : null,
      passed: trainPassed,
      failed: trainResultList.length - trainPassed,
      total: trainResultList.length,
      results: trainResultList
    };
    history.push(record);
    onIteration?.(
      makeLoopResult(
        history,
        testSet.length > 0,
        exitReason,
        originalDescription,
        currentDescription,
        holdout,
        trainSet.length,
        testSet.length
      )
    );
    if (verbose) {
      printEvalStats("Train", trainResultList, evalElapsed);
      if (testSet.length > 0) printEvalStats("Test ", testResultList, 0);
    }
    if (record.train_failed === 0) {
      exitReason = `all_passed (iteration ${iteration})`;
      if (verbose) {
        process.stderr.write(
          `
All train queries passed on iteration ${iteration}!
`
        );
      }
      break;
    }
    if (iteration === maxIterations) {
      exitReason = `max_iterations (${maxIterations})`;
      if (verbose) {
        process.stderr.write(`
Max iterations reached (${maxIterations}).
`);
      }
      break;
    }
    if (verbose) process.stderr.write("\nImproving description...\n");
    const improveStarted = performance.now();
    const newDescription = await improveDescription2({
      skillName,
      skillContent,
      currentDescription,
      evalResults: {
        results: trainResultList,
        summary: {
          passed: trainPassed,
          failed: trainResultList.length - trainPassed,
          total: trainResultList.length
        }
      },
      history: blindHistory(history).map((attempt) => ({
        ...attempt,
        description: attempt.description
      })),
      testResults: null,
      model,
      logDir,
      iteration
    });
    const improveElapsed = (performance.now() - improveStarted) / 1e3;
    if (verbose) {
      process.stderr.write(
        `Proposed (${improveElapsed.toFixed(1)}s): ${newDescription}
`
      );
    }
    currentDescription = newDescription;
  }
  const result = makeLoopResult(
    history,
    testSet.length > 0,
    exitReason,
    originalDescription,
    currentDescription,
    holdout,
    trainSet.length,
    testSet.length
  );
  if (verbose) {
    const best = selectBest(history, testSet.length > 0);
    process.stderr.write(`
Exit reason: ${exitReason}
`);
    process.stderr.write(
      `Best score: ${result.best_score} (iteration ${best.iteration})
`
    );
  }
  return result;
}
function timestamp() {
  const now = /* @__PURE__ */ new Date();
  const pad = (value) => String(value).padStart(2, "0");
  return `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}_${pad(now.getHours())}${pad(now.getMinutes())}${pad(now.getSeconds())}`;
}
async function main3() {
  const { values } = parseArgs3({
    options: {
      "eval-set": { type: "string" },
      "skill-path": { type: "string" },
      description: { type: "string" },
      "num-workers": { type: "string" },
      timeout: { type: "string" },
      "max-iterations": { type: "string" },
      "runs-per-query": { type: "string" },
      "trigger-threshold": { type: "string" },
      holdout: { type: "string" },
      model: { type: "string" },
      verbose: { type: "boolean", default: false },
      report: { type: "string", default: "auto" },
      "results-dir": { type: "string" }
    },
    strict: true,
    allowPositionals: false
  });
  if (!values["eval-set"]) throw new Error("--eval-set is required");
  if (!values["skill-path"]) throw new Error("--skill-path is required");
  if (!values.model) throw new Error("--model is required");
  let skillContent;
  try {
    skillContent = await readFile3(
      join4(values["skill-path"], "SKILL.md"),
      "utf8"
    );
  } catch {
    throw new Error(`No SKILL.md found at ${values["skill-path"]}`);
  }
  const parsed = parseSkillMd(skillContent);
  const evalSet = parseEvalSet(await readFile3(values["eval-set"], "utf8"));
  const resultsDir = values["results-dir"] ? join4(values["results-dir"], timestamp()) : void 0;
  if (resultsDir) await mkdir3(resultsDir, { recursive: true });
  void values.report;
  const result = await runLoop({
    evalSet,
    skillName: parsed.name,
    skillContent: parsed.content,
    originalDescription: parsed.description,
    descriptionOverride: values.description,
    numWorkers: parseNumericOption(
      "num-workers",
      values["num-workers"],
      10,
      true
    ),
    timeout: parseNumericOption("timeout", values.timeout, 30),
    maxIterations: parseNumericOption(
      "max-iterations",
      values["max-iterations"],
      5,
      true
    ),
    runsPerQuery: parseNumericOption(
      "runs-per-query",
      values["runs-per-query"],
      3,
      true
    ),
    triggerThreshold: parseNumericOption(
      "trigger-threshold",
      values["trigger-threshold"],
      0.5
    ),
    holdout: parseNumericOption("holdout", values.holdout, 0.4),
    model: values.model,
    verbose: values.verbose,
    logDir: resultsDir ? join4(resultsDir, "logs") : void 0
  });
  const json = `${JSON.stringify(result, null, 2)}
`;
  process.stdout.write(json);
  if (resultsDir) {
    await writeFile4(join4(resultsDir, "results.json"), json, "utf8");
    process.stderr.write(`Results saved to: ${resultsDir}
`);
  }
}
function isDirectRun3(expected) {
  const entry = process.argv[1];
  if (!entry) return false;
  return basename3(entry, extname3(entry)) === expected;
}
if (isDirectRun3("run-loop")) {
  main3().catch((error) => {
    process.stderr.write(`${error.message}
`);
    process.exitCode = 1;
  });
}
export {
  blindHistory,
  runLoop,
  selectBest
};
