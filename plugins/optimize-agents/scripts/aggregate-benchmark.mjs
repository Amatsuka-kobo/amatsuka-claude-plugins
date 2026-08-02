#!/usr/bin/env node

// src/aggregate-benchmark.ts
import { readdir, readFile, writeFile } from "node:fs/promises";
import { extname, isAbsolute, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

// src/lib/stats.ts
function computeStats(values) {
  if (values.length === 0) return { mean: 0, stddev: 0, min: 0, max: 0 };
  const mean = values.reduce((sum, value) => sum + value, 0) / values.length;
  const variance = values.reduce((sum, value) => sum + (value - mean) ** 2, 0) / values.length;
  return {
    mean,
    stddev: Math.sqrt(variance),
    min: Math.min(...values),
    max: Math.max(...values)
  };
}

// src/aggregate-benchmark.ts
async function directories(path) {
  const entries = await readdir(path, { withFileTypes: true });
  return entries.filter((entry) => entry.isDirectory()).map((entry) => entry.name);
}
function numericSuffix(name) {
  const value = Number(name.replace(/^[^-]*-/, ""));
  return Number.isFinite(value) ? value : Number.MAX_SAFE_INTEGER;
}
function ordered(names) {
  return [...names].sort((left, right) => {
    const byNumber = numericSuffix(left) - numericSuffix(right);
    return byNumber || left.localeCompare(right);
  });
}
function orderedConfigurations(names) {
  const preferred = ["with_skill", "without_skill"];
  return [
    ...preferred.filter((name) => names.includes(name)),
    ...names.filter((name) => !preferred.includes(name)).sort()
  ];
}
async function readJson(path) {
  try {
    return JSON.parse(await readFile(path, "utf8"));
  } catch {
    return null;
  }
}
async function fileExists(path) {
  try {
    await readFile(path);
    return true;
  } catch {
    return false;
  }
}
function validNumber(value) {
  return typeof value === "number" && Number.isFinite(value);
}
function outputPaths(runDir, out) {
  if (!out)
    return {
      json: join(runDir, "benchmark.json"),
      markdown: join(runDir, "benchmark.md")
    };
  const target = isAbsolute(out) ? out : resolve(out);
  if (extname(target) === ".json")
    return { json: target, markdown: target.replace(/\.json$/, ".md") };
  return {
    json: join(target, "benchmark.json"),
    markdown: join(target, "benchmark.md")
  };
}
function environmentKey(environment) {
  return JSON.stringify([environment.base_url, environment.auth_source]);
}
function formatMetric(summary, metric) {
  const stats = summary?.[metric];
  if (stats === null || stats === void 0) return "\u2014";
  const digits = metric === "pass_rate" ? 2 : 1;
  return `${stats.mean.toFixed(digits)} \xB1 ${stats.stddev.toFixed(digits)}`;
}
function formatDelta(first, second, metric) {
  const firstStats = first?.[metric];
  const secondStats = second?.[metric];
  if (!firstStats || !secondStats) return "\u2014";
  const digits = metric === "pass_rate" ? 2 : 1;
  const delta = firstStats.mean - secondStats.mean;
  return `${delta >= 0 ? "+" : ""}${delta.toFixed(digits)}`;
}
function markdown(benchmark) {
  const configurations = benchmark.metadata.configurations;
  const includeDelta = configurations.length >= 2;
  const header = ["\u6307\u6A19", ...configurations, ...includeDelta ? ["delta"] : []];
  const lines = [
    "# Benchmark",
    "",
    `| ${header.join(" | ")} |`,
    `| ${header.map(() => "---").join(" | ")} |`
  ];
  for (const metric of ["pass_rate", "time_seconds", "tokens"]) {
    const cells = configurations.map(
      (configuration) => formatMetric(benchmark.run_summary[configuration] ?? null, metric)
    );
    if (includeDelta) {
      cells.push(
        formatDelta(
          benchmark.run_summary[configurations[0]] ?? null,
          benchmark.run_summary[configurations[1]] ?? null,
          metric
        )
      );
    }
    lines.push(`| ${metric} | ${cells.join(" | ")} |`);
  }
  return `${lines.join("\n")}
`;
}
async function aggregateBenchmark(options) {
  const runDir = isAbsolute(options.runDir) ? options.runDir : resolve(options.runDir);
  const notes = [];
  const runs = [];
  const configurations = [];
  const evalDirectories = ordered(
    (await directories(runDir)).filter((name) => /^eval-\d+$/.test(name))
  );
  for (const evalDirectory of evalDirectories) {
    const evalId = numericSuffix(evalDirectory);
    const configurationDirectories = orderedConfigurations(
      await directories(join(runDir, evalDirectory))
    );
    for (const configuration of configurationDirectories) {
      if (!configurations.includes(configuration))
        configurations.push(configuration);
      const runDirectories = ordered(
        (await directories(join(runDir, evalDirectory, configuration))).filter(
          (name) => /^run-\d+$/.test(name)
        )
      );
      for (const runDirectory of runDirectories) {
        const path = join(runDir, evalDirectory, configuration, runDirectory);
        const hasCheckerError = await fileExists(
          join(path, "checker-error.txt")
        );
        const grading = hasCheckerError ? null : await readJson(join(path, "grading.json"));
        const timing = await readJson(join(path, "timing.json"));
        const validGrading = grading !== null && validNumber(grading.summary?.passed) && validNumber(grading.summary?.total) && grading.summary.total > 0;
        runs.push({
          eval_id: evalId,
          configuration,
          run: numericSuffix(runDirectory),
          path,
          excluded: !validGrading,
          pass_rate: validGrading ? grading.summary.passed / grading.summary.total : null,
          time_seconds: validNumber(timing?.total_duration_seconds) ? timing.total_duration_seconds : null,
          tokens: validNumber(timing?.total_tokens) ? timing.total_tokens : null,
          environment: timing?.environment ?? null
        });
      }
    }
  }
  const runSummary = {};
  for (const configuration of configurations) {
    const configurationRuns = runs.filter(
      (run) => run.configuration === configuration
    );
    const included = configurationRuns.filter((run) => !run.excluded);
    const excludedRuns = configurationRuns.length - included.length;
    if (excludedRuns > 0)
      notes.push(
        `${configuration}: ${configurationRuns.length} run \u4E2D ${excludedRuns} run \u304C\u30C1\u30A7\u30C3\u30AB\u30FC\u5931\u6557\u306B\u3088\u308A\u9664\u5916`
      );
    if (included.length === 0) {
      runSummary[configuration] = null;
      notes.push(`${configuration}: \u5168 run \u304C\u5931\u6557\u3057\u305F\u305F\u3081\u7D71\u8A08\u306F null`);
      continue;
    }
    const times = included.map((run) => run.time_seconds).filter(validNumber);
    const tokens = included.map((run) => run.tokens).filter(validNumber);
    runSummary[configuration] = {
      total_runs: configurationRuns.length,
      included_runs: included.length,
      excluded_runs: excludedRuns,
      pass_rate: computeStats(
        included.map((run) => run.pass_rate).filter(validNumber)
      ),
      time_seconds: times.length > 0 ? computeStats(times) : null,
      tokens: tokens.length > 0 ? computeStats(tokens) : null
    };
  }
  const environmentsByConfiguration = configurations.map(
    (configuration) => new Set(
      runs.filter(
        (run) => run.configuration === configuration && run.environment !== null
      ).map((run) => environmentKey(run.environment))
    )
  );
  const comparableEnvironments = environmentsByConfiguration.filter(
    (environments) => environments.size > 0
  );
  const environmentsMatch = comparableEnvironments.every(
    (environments) => environments.size === 1 && [...environments][0] === [...comparableEnvironments[0]][0]
  );
  if (comparableEnvironments.length > 1 && !environmentsMatch) {
    const warning = "\u8B66\u544A: \u69CB\u6210\u9593\u3067 environment.base_url \u307E\u305F\u306F auth_source \u304C\u4E00\u81F4\u3057\u307E\u305B\u3093";
    notes.push(warning);
    options.warn?.(warning);
  }
  const benchmark = {
    metadata: {
      run_dir: runDir,
      generated_at: (/* @__PURE__ */ new Date()).toISOString(),
      configurations
    },
    runs,
    run_summary: runSummary,
    notes
  };
  const paths = outputPaths(runDir, options.out);
  await writeFile(paths.json, `${JSON.stringify(benchmark, null, 2)}
`);
  await writeFile(paths.markdown, markdown(benchmark));
  return { benchmark, paths };
}
function isMain() {
  const entry = process.argv[1];
  return entry !== void 0 && fileURLToPath(import.meta.url) === resolve(entry);
}
if (isMain()) {
  const args = process.argv.slice(2);
  const opt = (name) => {
    const index = args.indexOf(`--${name}`);
    return index >= 0 ? args[index + 1] : void 0;
  };
  const runDir = opt("run-dir");
  if (!runDir) {
    console.error(
      "usage: aggregate-benchmark.mjs --run-dir <runDir> [--out <path>]"
    );
    process.exit(2);
  }
  const result = await aggregateBenchmark({
    runDir,
    out: opt("out"),
    warn: (message) => console.error(message)
  });
  console.log(`generated: ${result.paths.json}`);
  console.log(`generated: ${result.paths.markdown}`);
  for (const configuration of result.benchmark.metadata.configurations) {
    const summary = result.benchmark.run_summary[configuration];
    const rate = summary?.pass_rate.mean;
    console.log(
      `${configuration}: pass_rate=${rate === void 0 ? "null" : rate.toFixed(2)}`
    );
  }
}
export {
  aggregateBenchmark
};
