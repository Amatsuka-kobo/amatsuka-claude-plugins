#!/usr/bin/env node

// src/run-trigger-eval.ts
import { spawn } from "node:child_process";
import {
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

// src/lib/environment.ts
function captureEnvironment(model2) {
  let authSource = "(claude.ai login)";
  if (process.env.ANTHROPIC_API_KEY !== void 0)
    authSource = "ANTHROPIC_API_KEY";
  else if (process.env.ANTHROPIC_AUTH_TOKEN !== void 0)
    authSource = "ANTHROPIC_AUTH_TOKEN";
  return {
    base_url: process.env.ANTHROPIC_BASE_URL ?? "(default)",
    auth_source: authSource,
    model: model2
  };
}

// src/lib/pool.ts
async function pool(items, limit, fn) {
  const out = new Array(items.length);
  let next = 0;
  const workerLoop = async () => {
    while (true) {
      const i = next++;
      if (i >= items.length) return;
      out[i] = await fn(items[i], i);
    }
  };
  await Promise.all(
    Array.from({ length: Math.min(limit, items.length) }, workerLoop)
  );
  return out;
}

// src/lib/stream-parser.ts
function parseLine(line) {
  try {
    return JSON.parse(line);
  } catch {
    return null;
  }
}
function detectFirstToolUse(line) {
  const e = parseLine(line);
  if (e?.type !== "stream_event" || e.event?.type !== "content_block_start")
    return null;
  const cb = e.event.content_block ?? {};
  if (cb.type !== "tool_use") return null;
  return cb.name === "Skill" ? "skill" : "other";
}
function isResultEvent(line) {
  return parseLine(line)?.type === "result";
}

// src/lib/trigger-verdict.ts
function isPassingTriggerRate(shouldTrigger, triggerRate) {
  return shouldTrigger ? triggerRate >= 0.5 : triggerRate === 0;
}

// src/run-trigger-eval.ts
var args = process.argv.slice(2);
var opt = (name, fallback) => {
  const i = args.indexOf(`--${name}`);
  return i >= 0 ? args[i + 1] : fallback;
};
var skillPath = opt("skill");
var evalSetPath = opt("eval-set");
var runs = Number(opt("runs", "2"));
var workers = Number(opt("workers", "4"));
var model = opt("model", "claude-opus-5");
var timeoutMs = Number(opt("timeout", "240")) * 1e3;
if (!skillPath || !evalSetPath) {
  console.error(
    "usage: run-trigger-eval.mjs --skill <SKILL.md> --eval-set <queries.json>"
  );
  process.exit(2);
}
var skillBody = readFileSync(skillPath, "utf8");
var skillName = (skillBody.match(/^name:\s*(.+)$/m)?.[1] ?? "skill-under-test").trim();
var queries = JSON.parse(readFileSync(evalSetPath, "utf8"));
function makeWorkspace() {
  const dir = mkdtempSync(join(tmpdir(), "trigger-eval-"));
  mkdirSync(join(dir, ".claude", "skills", skillName), { recursive: true });
  writeFileSync(
    join(dir, ".claude", "skills", skillName, "SKILL.md"),
    skillBody
  );
  return dir;
}
function runOnce(workspace2, query) {
  return new Promise((resolve) => {
    const env = { ...process.env };
    delete env.CLAUDECODE;
    const child = spawn(
      "claude",
      [
        "-p",
        query,
        "--output-format",
        "stream-json",
        "--verbose",
        "--include-partial-messages",
        "--model",
        model
      ],
      { cwd: workspace2, env, stdio: ["ignore", "pipe", "ignore"] }
    );
    let buf = "";
    let settled = false;
    const finish = (triggered) => {
      if (settled) return;
      settled = true;
      child.kill("SIGKILL");
      clearTimeout(timer);
      resolve(triggered);
    };
    const timer = setTimeout(() => finish(false), timeoutMs);
    child.stdout.on("data", (chunk) => {
      buf += chunk.toString();
      let nl = buf.indexOf("\n");
      while (nl >= 0) {
        const line = buf.slice(0, nl).trim();
        buf = buf.slice(nl + 1);
        if (line) {
          const toolUse = detectFirstToolUse(line);
          if (toolUse !== null) finish(toolUse === "skill");
          if (isResultEvent(line)) finish(false);
        }
        nl = buf.indexOf("\n");
      }
    });
    child.on("error", () => finish(false));
    child.on("close", () => finish(false));
  });
}
var workspace = makeWorkspace();
try {
  const tasks = queries.flatMap((q) => Array(runs).fill(q));
  const flat = await pool(tasks, workers, (q) => runOnce(workspace, q.query));
  const results = queries.map((q, qi) => {
    const slice = flat.slice(qi * runs, (qi + 1) * runs);
    const triggers = slice.filter(Boolean).length;
    const rate = triggers / runs;
    const pass = isPassingTriggerRate(q.should_trigger, rate);
    return {
      query: q.query,
      should_trigger: q.should_trigger,
      triggers,
      runs,
      trigger_rate: rate,
      pass
    };
  });
  const passed = results.filter((r) => r.pass).length;
  console.log(
    JSON.stringify(
      {
        skill: skillName,
        environment: captureEnvironment(model),
        results,
        summary: {
          total: results.length,
          passed,
          failed: results.length - passed,
          false_negatives: results.filter((r) => !r.pass && r.should_trigger).length,
          false_positives: results.filter((r) => !r.pass && !r.should_trigger).length
        }
      },
      null,
      2
    )
  );
} finally {
  rmSync(workspace, { recursive: true, force: true });
}
