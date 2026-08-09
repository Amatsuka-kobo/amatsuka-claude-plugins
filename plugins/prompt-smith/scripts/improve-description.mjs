#!/usr/bin/env node
/**
 * Portions of this bundle are a TypeScript port of the skill-creator
 * Claude Code plugin (Apache License, Version 2.0), Copyright Anthropic, PBC.
 * Modified by amatsuka-koubou. See plugins/prompt-smith/NOTICE for the list
 * of changes and plugins/prompt-smith/LICENSE for the license text.
 */

// src/improve-description.ts
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { parseArgs } from "node:util";

// src/lib/claude-cli.ts
import { spawn } from "node:child_process";
function buildEnv(env = process.env) {
  const copy = {};
  for (const [key, value] of Object.entries(env)) {
    if (key === "CLAUDECODE") continue;
    copy[key] = value;
  }
  return copy;
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
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((error) => {
    process.stderr.write(`${error.message}
`);
    process.exitCode = 1;
  });
}
export {
  buildImprovePrompt,
  extractDescription,
  improveDescription
};
