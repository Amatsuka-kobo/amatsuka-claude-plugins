#!/usr/bin/env node

import { readdir, readFile, writeFile } from "node:fs/promises"
import { extname, isAbsolute, join, resolve } from "node:path"
import { fileURLToPath } from "node:url"
import type { EvalEnvironment } from "./lib/environment.js"
import { computeStats, type Stats } from "./lib/stats.js"

interface Grading {
  summary: {
    total: number
    passed: number
  }
}

interface Timing {
  total_duration_seconds?: number
  total_tokens?: number | null
  environment?: EvalEnvironment
}

export interface BenchmarkRun {
  eval_id: number
  configuration: string
  run: number
  path: string
  excluded: boolean
  pass_rate: number | null
  time_seconds: number | null
  tokens: number | null
  environment: EvalEnvironment | null
}

export interface ConfigurationSummary {
  total_runs: number
  included_runs: number
  excluded_runs: number
  pass_rate: Stats
  time_seconds: Stats | null
  tokens: Stats | null
}

export interface Benchmark {
  metadata: {
    run_dir: string
    generated_at: string
    configurations: string[]
  }
  runs: BenchmarkRun[]
  run_summary: Record<string, ConfigurationSummary | null>
  notes: string[]
}

interface AggregateOptions {
  runDir: string
  out?: string
  warn?: (message: string) => void
}

interface OutputPaths {
  json: string
  markdown: string
}

async function directories(path: string): Promise<string[]> {
  const entries = await readdir(path, { withFileTypes: true })
  return entries
    .filter((entry) => entry.isDirectory())
    .map((entry) => entry.name)
}

function numericSuffix(name: string): number {
  const value = Number(name.replace(/^[^-]*-/, ""))
  return Number.isFinite(value) ? value : Number.MAX_SAFE_INTEGER
}

function ordered(names: string[]): string[] {
  return [...names].sort((left, right) => {
    const byNumber = numericSuffix(left) - numericSuffix(right)
    return byNumber || left.localeCompare(right)
  })
}

function orderedConfigurations(names: string[]): string[] {
  const preferred = ["with_skill", "without_skill"]
  return [
    ...preferred.filter((name) => names.includes(name)),
    ...names.filter((name) => !preferred.includes(name)).sort()
  ]
}

async function readJson<T>(path: string): Promise<T | null> {
  try {
    return JSON.parse(await readFile(path, "utf8")) as T
  } catch {
    return null
  }
}

async function fileExists(path: string): Promise<boolean> {
  try {
    await readFile(path)
    return true
  } catch {
    return false
  }
}

function validNumber(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value)
}

function outputPaths(runDir: string, out?: string): OutputPaths {
  if (!out)
    return {
      json: join(runDir, "benchmark.json"),
      markdown: join(runDir, "benchmark.md")
    }

  const target = isAbsolute(out) ? out : resolve(out)
  if (extname(target) === ".json")
    return { json: target, markdown: target.replace(/\.json$/, ".md") }
  return {
    json: join(target, "benchmark.json"),
    markdown: join(target, "benchmark.md")
  }
}

function environmentKey(environment: EvalEnvironment): string {
  return JSON.stringify([environment.base_url, environment.auth_source])
}

function formatMetric(
  summary: ConfigurationSummary | null,
  metric: "pass_rate" | "time_seconds" | "tokens"
): string {
  const stats = summary?.[metric]
  if (stats === null || stats === undefined) return "—"
  const digits = metric === "pass_rate" ? 2 : 1
  return `${stats.mean.toFixed(digits)} ± ${stats.stddev.toFixed(digits)}`
}

function formatDelta(
  first: ConfigurationSummary | null,
  second: ConfigurationSummary | null,
  metric: "pass_rate" | "time_seconds" | "tokens"
): string {
  const firstStats = first?.[metric]
  const secondStats = second?.[metric]
  if (!firstStats || !secondStats) return "—"
  const digits = metric === "pass_rate" ? 2 : 1
  const delta = firstStats.mean - secondStats.mean
  return `${delta >= 0 ? "+" : ""}${delta.toFixed(digits)}`
}

function markdown(benchmark: Benchmark): string {
  const configurations = benchmark.metadata.configurations
  const includeDelta = configurations.length >= 2
  const header = ["指標", ...configurations, ...(includeDelta ? ["delta"] : [])]
  const lines = [
    "# Benchmark",
    "",
    `| ${header.join(" | ")} |`,
    `| ${header.map(() => "---").join(" | ")} |`
  ]
  for (const metric of ["pass_rate", "time_seconds", "tokens"] as const) {
    const cells = configurations.map((configuration) =>
      formatMetric(benchmark.run_summary[configuration] ?? null, metric)
    )
    if (includeDelta) {
      cells.push(
        formatDelta(
          benchmark.run_summary[configurations[0]] ?? null,
          benchmark.run_summary[configurations[1]] ?? null,
          metric
        )
      )
    }
    lines.push(`| ${metric} | ${cells.join(" | ")} |`)
  }
  return `${lines.join("\n")}\n`
}

export async function aggregateBenchmark(
  options: AggregateOptions
): Promise<{ benchmark: Benchmark; paths: OutputPaths }> {
  const runDir = isAbsolute(options.runDir)
    ? options.runDir
    : resolve(options.runDir)
  const notes: string[] = []
  const runs: BenchmarkRun[] = []
  const configurations: string[] = []
  const evalDirectories = ordered(
    (await directories(runDir)).filter((name) => /^eval-\d+$/.test(name))
  )

  for (const evalDirectory of evalDirectories) {
    const evalId = numericSuffix(evalDirectory)
    const configurationDirectories = orderedConfigurations(
      await directories(join(runDir, evalDirectory))
    )
    for (const configuration of configurationDirectories) {
      if (!configurations.includes(configuration))
        configurations.push(configuration)
      const runDirectories = ordered(
        (await directories(join(runDir, evalDirectory, configuration))).filter(
          (name) => /^run-\d+$/.test(name)
        )
      )
      for (const runDirectory of runDirectories) {
        const path = join(runDir, evalDirectory, configuration, runDirectory)
        const hasCheckerError = await fileExists(
          join(path, "checker-error.txt")
        )
        const grading = hasCheckerError
          ? null
          : await readJson<Grading>(join(path, "grading.json"))
        const timing = await readJson<Timing>(join(path, "timing.json"))
        const validGrading =
          grading !== null &&
          validNumber(grading.summary?.passed) &&
          validNumber(grading.summary?.total) &&
          grading.summary.total > 0
        runs.push({
          eval_id: evalId,
          configuration,
          run: numericSuffix(runDirectory),
          path,
          excluded: !validGrading,
          pass_rate: validGrading
            ? grading.summary.passed / grading.summary.total
            : null,
          time_seconds: validNumber(timing?.total_duration_seconds)
            ? timing.total_duration_seconds
            : null,
          tokens: validNumber(timing?.total_tokens)
            ? timing.total_tokens
            : null,
          environment: timing?.environment ?? null
        })
      }
    }
  }

  const runSummary: Record<string, ConfigurationSummary | null> = {}
  for (const configuration of configurations) {
    const configurationRuns = runs.filter(
      (run) => run.configuration === configuration
    )
    const included = configurationRuns.filter((run) => !run.excluded)
    const excludedRuns = configurationRuns.length - included.length
    if (excludedRuns > 0)
      notes.push(
        `${configuration}: ${configurationRuns.length} run 中 ${excludedRuns} run がチェッカー失敗により除外`
      )
    if (included.length === 0) {
      runSummary[configuration] = null
      notes.push(`${configuration}: 全 run が失敗したため統計は null`)
      continue
    }

    const times = included.map((run) => run.time_seconds).filter(validNumber)
    const tokens = included.map((run) => run.tokens).filter(validNumber)
    runSummary[configuration] = {
      total_runs: configurationRuns.length,
      included_runs: included.length,
      excluded_runs: excludedRuns,
      pass_rate: computeStats(
        included.map((run) => run.pass_rate).filter(validNumber)
      ),
      time_seconds: times.length > 0 ? computeStats(times) : null,
      tokens: tokens.length > 0 ? computeStats(tokens) : null
    }
  }

  const environmentsByConfiguration = configurations.map(
    (configuration) =>
      new Set(
        runs
          .filter(
            (run) =>
              run.configuration === configuration && run.environment !== null
          )
          .map((run) => environmentKey(run.environment as EvalEnvironment))
      )
  )
  const comparableEnvironments = environmentsByConfiguration.filter(
    (environments) => environments.size > 0
  )
  const environmentsMatch = comparableEnvironments.every(
    (environments) =>
      environments.size === 1 &&
      [...environments][0] === [...comparableEnvironments[0]][0]
  )
  if (comparableEnvironments.length > 1 && !environmentsMatch) {
    const warning =
      "警告: 構成間で environment.base_url または auth_source が一致しません"
    notes.push(warning)
    options.warn?.(warning)
  }

  const benchmark: Benchmark = {
    metadata: {
      run_dir: runDir,
      generated_at: new Date().toISOString(),
      configurations
    },
    runs,
    run_summary: runSummary,
    notes
  }
  const paths = outputPaths(runDir, options.out)
  await writeFile(paths.json, `${JSON.stringify(benchmark, null, 2)}\n`)
  await writeFile(paths.markdown, markdown(benchmark))
  return { benchmark, paths }
}

function isMain(): boolean {
  const entry = process.argv[1]
  return (
    entry !== undefined && fileURLToPath(import.meta.url) === resolve(entry)
  )
}

if (isMain()) {
  const args = process.argv.slice(2)
  const opt = (name: string): string | undefined => {
    const index = args.indexOf(`--${name}`)
    return index >= 0 ? args[index + 1] : undefined
  }
  const runDir = opt("run-dir")
  if (!runDir) {
    console.error(
      "usage: aggregate-benchmark.mjs --run-dir <runDir> [--out <path>]"
    )
    process.exit(2)
  }

  const result = await aggregateBenchmark({
    runDir,
    out: opt("out"),
    warn: (message) => console.error(message)
  })
  console.log(`generated: ${result.paths.json}`)
  console.log(`generated: ${result.paths.markdown}`)
  for (const configuration of result.benchmark.metadata.configurations) {
    const summary = result.benchmark.run_summary[configuration]
    const rate = summary?.pass_rate.mean
    console.log(
      `${configuration}: pass_rate=${rate === undefined ? "null" : rate.toFixed(2)}`
    )
  }
}
