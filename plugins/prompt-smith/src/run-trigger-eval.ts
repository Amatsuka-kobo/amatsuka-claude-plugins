/**
 * Copyright 2026 amatsuka-koubou
 * Copyright Anthropic, PBC
 *
 * Licensed under the Apache License, Version 2.0.
 *
 * TypeScript port of scripts/run_eval.py from the skill-creator Claude Code
 * plugin. Changes: the measured skill is registered as a project skill in a
 * per-run temporary directory rather than a slash command in the real
 * project; matching uses a name prefix; only the Skill tool counts;
 * find_project_root() is not ported; the result records an environment
 * object; CLI and result-event failures are recorded separately from non-triggers.
 * See plugins/prompt-smith/NOTICE.
 */

import { spawn } from "node:child_process"
import { readFile, writeFile } from "node:fs/promises"
import { basename, extname, join } from "node:path"
import { parseArgs } from "node:util"
import {
  buildEvalArgs,
  buildSpawnOptions,
  describeEnvironment,
  killThenSettle,
  type SpawnFn
} from "./lib/claude-cli.js"
import { parseSkillMd } from "./lib/parse-skill-md.js"
import { pool } from "./lib/pool.js"
import {
  buildSandboxSkillMd,
  createSandbox,
  makeCleanName,
  replaceDescription,
  type Sandbox
} from "./lib/sandbox.js"
import { judge, readResultError, TriggerDetector } from "./lib/stream-parse.js"
import type {
  EvalItem,
  EvalResult,
  EvalResultItem,
  RunEvalOptions
} from "./lib/types.js"

export interface RunSingleQueryOptions {
  query: string
  skillName: string
  skillContent: string
  description: string
  timeout: number
  model: string | undefined
  spawn?: SpawnFn
  createSandbox?: (skillMd: string, cleanName: string) => Promise<Sandbox>
}

export type QueryOutcome =
  | { status: "triggered" }
  | { status: "not_triggered" }
  | { status: "error"; message: string }

/** 1 クエリを 1 回だけ測り、発火・不発火・測定失敗を区別する。 */
export async function runSingleQuery(
  options: RunSingleQueryOptions
): Promise<QueryOutcome> {
  const cleanName = makeCleanName(options.skillName)
  // 改善ループが渡す description を frontmatter へ反映してから測る。
  // これを飛ばすと、反復しても初回の description を測り続ける。
  const measured = buildSandboxSkillMd(
    replaceDescription(options.skillContent, options.description),
    cleanName
  )
  const createQuerySandbox = options.createSandbox ?? createSandbox
  const spawnClaude = options.spawn ?? spawn
  const sandbox = await createQuerySandbox(measured, cleanName)

  try {
    const child = spawnClaude(
      "claude",
      buildEvalArgs(options.query, options.model),
      {
        ...buildSpawnOptions(sandbox.dir),
        stdio: ["ignore", "pipe", "ignore"]
      }
    )

    return await new Promise<QueryOutcome>((resolve) => {
      const detector = new TriggerDetector(`${options.skillName}-skill-`)
      let buffer = ""
      let settled = false

      // kill したあと、プロセスが終わるのを待ってから resolve する。
      // 待たずに抜けると、呼び出し側の finally が cwd を削る間に
      // プロセスがまだ生きている状態になりうる(移植元は kill の後 wait する)。
      const finish = (outcome: QueryOutcome) => {
        if (settled) return
        settled = true
        clearTimeout(timer)
        killThenSettle(child, () => resolve(outcome))
      }

      const timer = setTimeout(
        () => finish({ status: "not_triggered" }),
        options.timeout * 1000
      )

      child.stdout.on("data", (chunk) => {
        if (settled) return
        buffer += String(chunk)
        let newline = buffer.indexOf("\n")
        while (newline !== -1) {
          const line = buffer.slice(0, newline)
          buffer = buffer.slice(newline + 1)
          const message = readResultError(line)
          if (message !== null) {
            finish({ status: "error", message })
            return
          }
          const verdict = detector.push(line)
          if (verdict !== null) {
            finish({ status: verdict ? "triggered" : "not_triggered" })
            return
          }
          newline = buffer.indexOf("\n")
        }
      })

      child.on("error", (error) => {
        finish({ status: "error", message: error.message })
      })

      child.on("close", (code) => {
        if (code !== 0 && code !== null) {
          finish({ status: "error", message: `claude -p exited ${code}` })
          return
        }
        finish({ status: "not_triggered" })
      })
    })
  } finally {
    await sandbox.cleanup()
  }
}

export function aggregateOutcomes(
  evalSet: EvalItem[],
  jobs: EvalItem[],
  outcomes: QueryOutcome[],
  triggerThreshold: number
): { results: EvalResultItem[]; errors: number } {
  const outcomesByQuery = new Map<string, QueryOutcome[]>()
  jobs.forEach((item, index) => {
    const list = outcomesByQuery.get(item.query) ?? []
    list.push(outcomes[index])
    outcomesByQuery.set(item.query, list)
  })

  let errors = 0
  const results = evalSet.map((item) => {
    const outcomesForQuery = outcomesByQuery.get(item.query) ?? []
    const queryErrors = outcomesForQuery.filter(
      (outcome) => outcome.status === "error"
    ).length
    const triggers = outcomesForQuery.filter(
      (outcome) => outcome.status === "triggered"
    ).length
    const runs = outcomesForQuery.length - queryErrors
    const triggerRate = runs === 0 ? 0 : triggers / runs
    errors += queryErrors

    return {
      query: item.query,
      should_trigger: item.should_trigger,
      trigger_rate: triggerRate,
      triggers,
      runs,
      errors: queryErrors,
      pass: judge(triggerRate, item.should_trigger, triggerThreshold)
    }
  })

  return { results, errors }
}

export class MeasurementFailedError extends Error {
  override readonly name = "MeasurementFailedError"
}

export function assertMeasurable(results: EvalResultItem[]): void {
  const failed = results.find((result) => result.runs === 0)
  if (!failed) return

  throw new MeasurementFailedError(
    `Measurement failed for query: ${failed.query}. All runs ended in errors. ` +
      "If authentication depends on apiKeyHelper, awsAuthRefresh, or settings env, " +
      "switch to authentication through environment variables (環境変数)."
  )
}

export async function runEval(
  options: RunEvalOptions,
  deps?: { runSingleQuery?: typeof runSingleQuery }
): Promise<EvalResult> {
  const jobs = options.evalSet.flatMap((item) =>
    Array.from({ length: options.runsPerQuery }, () => item)
  )
  const runQuery = deps?.runSingleQuery ?? runSingleQuery

  // 1 件の失敗で eval 全体を落とさない。移植元も future の例外を False として
  // 積み、残りを続ける(run_eval.py 221-225 行)。
  const outcomes = await pool(jobs, options.numWorkers, async (item) => {
    try {
      return await runQuery({
        query: item.query,
        skillName: options.skillName,
        skillContent: options.skillContent,
        description: options.description,
        timeout: options.timeout,
        model: options.model
      })
    } catch (error) {
      return {
        status: "error" as const,
        message: error instanceof Error ? error.message : String(error)
      }
    }
  })

  const aggregated = aggregateOutcomes(
    options.evalSet,
    jobs,
    outcomes,
    options.triggerThreshold
  )
  if (aggregated.errors > 0) {
    process.stderr.write(
      `Warning: ${aggregated.errors} query run(s) failed and were excluded from trigger rates.\n`
    )

    const errorMessages = [
      ...new Set(
        outcomes.flatMap((outcome) =>
          outcome.status === "error" ? [outcome.message] : []
        )
      )
    ]
    const displayedMessages = errorMessages.slice(0, 5)
    for (const message of displayedMessages) {
      process.stderr.write(`  Cause: ${message}\n`)
    }
    if (errorMessages.length > displayedMessages.length) {
      process.stderr.write(
        `  ... ${errorMessages.length - displayedMessages.length} additional error cause(s) omitted.\n`
      )
    }
  }
  if (options.verbose) {
    for (const result of aggregated.results) {
      process.stderr.write(
        `  [${result.pass ? "PASS" : "FAIL"}] rate=${result.triggers}/${result.runs} expected=${result.should_trigger}: ${result.query.slice(0, 60)}\n`
      )
    }
  }
  assertMeasurable(aggregated.results)

  const passed = aggregated.results.filter((result) => result.pass).length
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
  }
}

export function parseNumericOption(
  name: string,
  value: string | undefined,
  defaultValue: number,
  integer = false
): number {
  if (value === undefined) return defaultValue
  const parsed = Number(value)
  if (!Number.isFinite(parsed) || (integer && !Number.isInteger(parsed))) {
    throw new Error(`--${name} must be ${integer ? "an integer" : "a number"}`)
  }
  return parsed
}

export function parseEvalSet(content: string): EvalItem[] {
  const value: unknown = JSON.parse(content)
  if (!Array.isArray(value))
    throw new Error("--eval-set must contain a JSON array")

  const evalSet = value.map((item, index) => {
    if (
      typeof item !== "object" ||
      item === null ||
      typeof (item as Record<string, unknown>).query !== "string" ||
      typeof (item as Record<string, unknown>).should_trigger !== "boolean"
    ) {
      throw new Error(`invalid eval item at index ${index}`)
    }
    return item as EvalItem
  })

  const seen = new Set<string>()
  for (const item of evalSet) {
    if (seen.has(item.query))
      throw new Error(`duplicate query in eval set: ${item.query}`)
    seen.add(item.query)
  }
  return evalSet
}

async function main(): Promise<void> {
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
  })

  if (!values["skill-path"]) throw new Error("--skill-path is required")
  if (!values["eval-set"]) throw new Error("--eval-set is required")

  const originalContent = await readFile(
    join(values["skill-path"], "SKILL.md"),
    "utf8"
  )
  const parsed = parseSkillMd(originalContent)
  const description = values.description ?? parsed.description
  // --description 指定時は、この description が runSingleQuery でも再適用される。
  const skillContent = values.description
    ? replaceDescription(parsed.content, description)
    : parsed.content
  const evalSet = parseEvalSet(await readFile(values["eval-set"], "utf8"))

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
  })

  const json = `${JSON.stringify(result, null, 2)}\n`
  if (values.out) {
    await writeFile(values.out, json, "utf8")
  } else {
    process.stdout.write(json)
  }
}

function isDirectRun(expected: string): boolean {
  const entry = process.argv[1]
  if (!entry) return false
  // Bundled modules share import.meta.url, so dispatch by the configured output filename.
  return basename(entry, extname(entry)) === expected
}

if (isDirectRun("run-trigger-eval")) {
  main().catch((error) => {
    process.stderr.write(`${(error as Error).message}\n`)
    process.exitCode = 1
  })
}
