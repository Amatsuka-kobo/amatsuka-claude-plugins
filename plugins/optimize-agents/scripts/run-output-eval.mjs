#!/usr/bin/env node

// src/run-output-eval.ts
import { spawn as spawn2 } from "node:child_process";
import { mkdir as mkdir2, readFile as readFile2, rename, rm as rm3, writeFile as writeFile3 } from "node:fs/promises";
import { dirname as dirname2, isAbsolute as isAbsolute2, resolve as resolve2 } from "node:path";

// src/lib/checker.ts
import { spawn } from "node:child_process";
import { rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
function executeChecker(spec) {
  return new Promise((resolve3, reject) => {
    const child = spawn(
      "sh",
      [
        "-c",
        `${spec.checker} "$1" "$2"`,
        "checker",
        spec.outDir,
        String(spec.evalId)
      ],
      { cwd: spec.cwd, stdio: ["ignore", "pipe", "pipe"] }
    );
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (chunk) => {
      stdout += chunk.toString();
    });
    child.stderr.on("data", (chunk) => {
      stderr += chunk.toString();
    });
    child.on("error", reject);
    child.on("close", (code) => resolve3({ code, stdout, stderr }));
  });
}
async function recordError(spec, error) {
  await rm(join(spec.runDir, "grading.json"), { force: true });
  await writeFile(join(spec.runDir, "checker-error.txt"), error);
}
async function runChecker(spec) {
  await rm(join(spec.runDir, "checker-error.txt"), { force: true });
  let result;
  try {
    result = await executeChecker(spec);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    await recordError(spec, message);
    return { ok: false, error: message };
  }
  if (result.code !== 0) {
    const message = result.stderr || `checker exited with code ${result.code}`;
    await recordError(spec, message);
    return { ok: false, error: message };
  }
  try {
    JSON.parse(result.stdout);
  } catch {
    const message = result.stderr ? `${result.stderr}
checker stdout was not valid JSON:
${result.stdout}` : `checker stdout was not valid JSON:
${result.stdout}`;
    await recordError(spec, message);
    return { ok: false, error: message };
  }
  await writeFile(join(spec.runDir, "grading.json"), result.stdout);
  return { ok: true };
}

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

// src/lib/sandbox.ts
import { cp, mkdir, mkdtemp, readFile, rm as rm2, writeFile as writeFile2 } from "node:fs/promises";
import { tmpdir } from "node:os";
import {
  basename,
  dirname,
  isAbsolute,
  join as join2,
  relative,
  resolve
} from "node:path";
var excludedDirectories = /* @__PURE__ */ new Set(["evals", ".git", "node_modules"]);
function sandboxPath(root, fixturePath) {
  if (isAbsolute(fixturePath))
    throw new Error(`fixture path must be relative: ${fixturePath}`);
  const target = resolve(root, fixturePath);
  const fromRoot = relative(root, target);
  if (fromRoot === ".." || fromRoot.startsWith(`..${process.platform === "win32" ? "\\" : "/"}`))
    throw new Error(`fixture path escapes sandbox: ${fixturePath}`);
  return target;
}
async function copySkill(spec, sandbox) {
  if (!spec.includeSkill) return;
  const target = join2(sandbox, ".claude", "skills", spec.skillName);
  await mkdir(dirname(target), { recursive: true });
  await cp(spec.skillRoot, target, {
    recursive: true,
    filter: (source) => {
      if (resolve(source) === resolve(spec.skillRoot)) return true;
      return !excludedDirectories.has(basename(source));
    }
  });
}
async function writeFixtures(spec, sandbox) {
  for (const fixture of spec.fixtures) {
    const target = sandboxPath(sandbox, fixture.path);
    await mkdir(dirname(target), { recursive: true });
    if (fixture.content !== void 0) {
      await writeFile2(target, fixture.content);
      continue;
    }
    if (fixture.from !== void 0) {
      const source = resolve(spec.fixtureBaseDir, fixture.from);
      await writeFile2(target, await readFile(source));
      continue;
    }
    throw new Error(`fixture must define content or from: ${fixture.path}`);
  }
}
async function buildSandbox(spec) {
  const sandbox = await mkdtemp(join2(tmpdir(), "output-eval-"));
  try {
    await copySkill(spec, sandbox);
    await writeFixtures(spec, sandbox);
    return sandbox;
  } catch (error) {
    await rm2(sandbox, { recursive: true, force: true });
    throw error;
  }
}

// src/run-output-eval.ts
var args = process.argv.slice(2);
var opt = (name, fallback) => {
  const index = args.indexOf(`--${name}`);
  return index >= 0 ? args[index + 1] : fallback;
};
function positiveInteger(value, name) {
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed < 1)
    throw new Error(`--${name} must be a positive integer`);
  return parsed;
}
function resolveInputPath(value) {
  return isAbsolute2(value) ? value : resolve2(value);
}
function runClaude(workspace, prompt, model2, timeoutMs) {
  return new Promise((resolveResult) => {
    const env = { ...process.env };
    delete env.CLAUDECODE;
    const started = process.hrtime.bigint();
    const child = spawn2("claude", ["-p", prompt, "--model", model2], {
      cwd: workspace,
      env,
      stdio: ["ignore", "ignore", "pipe"]
    });
    let stderr = "";
    let settled = false;
    let timedOut = false;
    child.stderr.on("data", (chunk) => {
      stderr += chunk.toString();
    });
    const finish = (code) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      resolveResult({
        durationSeconds: Number(process.hrtime.bigint() - started) / 1e9,
        code,
        stderr,
        timedOut
      });
    };
    const timer = setTimeout(() => {
      timedOut = true;
      child.kill("SIGKILL");
    }, timeoutMs);
    child.on("error", (error) => {
      stderr += `${stderr ? "\n" : ""}${error.message}`;
      finish(null);
    });
    child.on("close", finish);
  });
}
var evalFileArg = opt("eval-file");
var runDirArg = opt("run-dir");
if (!evalFileArg || !runDirArg) {
  console.error(
    "usage: run-output-eval.mjs --eval-file <output-evals.json> --run-dir <output>"
  );
  process.exit(2);
}
var runs = positiveInteger(opt("runs", "1"), "runs");
var model = opt("model", "claude-opus-5");
var timeoutSeconds = positiveInteger(opt("timeout", "600"), "timeout");
var evalIdArg = opt("eval-id");
var selectedEvalId = evalIdArg === void 0 ? void 0 : Number(evalIdArg);
if (evalIdArg !== void 0 && !Number.isInteger(selectedEvalId))
  throw new Error("--eval-id must be an integer");
var evalFile = resolveInputPath(evalFileArg);
var evalDirectory = dirname2(evalFile);
var runDirectory = resolveInputPath(runDirArg);
var config = JSON.parse(await readFile2(evalFile, "utf8"));
if (!config.checker) {
  console.error("checker \u304C\u672A\u6307\u5B9A\u306E\u305F\u3081 output eval \u3092\u884C\u3044\u307E\u305B\u3093");
  process.exit(0);
}
var skillRoot = resolve2(evalDirectory, config.skill_root);
var evals = selectedEvalId === void 0 ? config.evals : config.evals.filter((item) => item.id === selectedEvalId);
if (selectedEvalId !== void 0 && evals.length === 0)
  throw new Error(`eval id not found: ${selectedEvalId}`);
var configurations = [
  { name: "with_skill", includeSkill: true },
  { name: "without_skill", includeSkill: false }
];
await mkdir2(runDirectory, { recursive: true });
for (const evaluation of evals) {
  for (const configuration of configurations) {
    for (let run = 1; run <= runs; run++) {
      console.error(
        `eval ${evaluation.id} ${configuration.name} run ${run}/${runs}`
      );
      const sandbox = await buildSandbox({
        skillRoot,
        skillName: config.skill_name,
        includeSkill: configuration.includeSkill,
        fixtures: evaluation.fixtures ?? [],
        fixtureBaseDir: evalDirectory
      });
      const destination = resolve2(
        runDirectory,
        `eval-${evaluation.id}`,
        configuration.name,
        `run-${run}`
      );
      const outputDirectory = resolve2(destination, "output");
      await rm3(destination, { recursive: true, force: true });
      await mkdir2(destination, { recursive: true });
      let claudeResult;
      try {
        claudeResult = await runClaude(
          sandbox,
          evaluation.prompt,
          model,
          timeoutSeconds * 1e3
        );
        await rm3(outputDirectory, { recursive: true, force: true });
        await rename(sandbox, outputDirectory);
      } catch (error) {
        await rm3(sandbox, { recursive: true, force: true });
        throw error;
      }
      await writeFile3(
        resolve2(destination, "timing.json"),
        `${JSON.stringify(
          {
            total_duration_seconds: claudeResult.durationSeconds,
            total_tokens: null,
            environment: captureEnvironment(model)
          },
          null,
          2
        )}
`
      );
      if (claudeResult.code !== 0) {
        const status = claudeResult.timedOut ? `claude timed out after ${timeoutSeconds} seconds` : `claude exited with code ${claudeResult.code}`;
        await writeFile3(
          resolve2(destination, "claude-error.txt"),
          `${status}
${claudeResult.stderr}`
        );
      }
      await runChecker({
        checker: config.checker,
        cwd: evalDirectory,
        outDir: outputDirectory,
        evalId: evaluation.id,
        runDir: destination
      });
    }
  }
}
