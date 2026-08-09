#!/usr/bin/env node
/**
 * Copyright 2026 amatsuka-koubou
 * Copyright Anthropic, PBC
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 *     http://www.apache.org/licenses/LICENSE-2.0
 *
 * This file is a TypeScript port of scripts/run_loop.py from the skill-creator
 * Claude Code plugin. Change: train/test shuffling uses the seeded PRNG in
 * split-eval-set.ts instead of Python's random module; no other loop behavior
 * is changed.
 */

import { mkdir, readFile, writeFile } from "node:fs/promises"
import { basename, extname, join } from "node:path"
import { parseArgs } from "node:util"
import {
  improveDescription as defaultImproveDescription,
  type ImproveOptions
} from "./improve-description.js"
import { parseSkillMd } from "./lib/parse-skill-md.js"
import { splitEvalSet } from "./lib/split-eval-set.js"
import type {
  EvalItem,
  EvalResult,
  EvalResultItem,
  IterationRecord,
  LoopResult,
  RunEvalOptions
} from "./lib/types.js"
import {
  runEval as defaultRunEval,
  parseEvalSet,
  parseNumericOption
} from "./run-trigger-eval.js"

type RunEval = (options: RunEvalOptions) => Promise<EvalResult>
type ImproveDescription = (options: ImproveOptions) => Promise<string>

export interface RunLoopOptions {
  evalSet: EvalItem[]
  skillName: string
  skillContent: string
  originalDescription: string
  descriptionOverride?: string
  numWorkers?: number
  timeout?: number
  maxIterations?: number
  runsPerQuery?: number
  triggerThreshold?: number
  holdout?: number
  model: string
  verbose?: boolean
  logDir?: string
  runEval?: RunEval
  improveDescription?: ImproveDescription
  onIteration?: (partial: LoopResult) => void
}

function score(record: IterationRecord, hasTestSet: boolean): number {
  return hasTestSet ? (record.test_passed ?? 0) : record.train_passed
}

export function selectBest(
  history: IterationRecord[],
  hasTestSet: boolean
): IterationRecord {
  return history.reduce((best, candidate) =>
    score(candidate, hasTestSet) > score(best, hasTestSet) ? candidate : best
  )
}

export function blindHistory(
  history: IterationRecord[]
): Record<string, unknown>[] {
  return history.map((record) =>
    Object.fromEntries(
      Object.entries(record).filter(([key]) => !key.startsWith("test_"))
    )
  )
}

function makeLoopResult(
  history: IterationRecord[],
  hasTestSet: boolean,
  exitReason: string,
  originalDescription: string,
  currentDescription: string,
  holdout: number,
  trainSize: number,
  testSize: number
): LoopResult {
  const best = selectBest(history, hasTestSet)
  const bestScore = hasTestSet
    ? `${best.test_passed}/${best.test_total}`
    : `${best.train_passed}/${best.train_total}`

  return {
    exit_reason: exitReason,
    original_description: originalDescription,
    best_description: best.description,
    best_score: bestScore,
    best_train_score: `${best.train_passed}/${best.train_total}`,
    best_test_score: hasTestSet
      ? `${best.test_passed}/${best.test_total}`
      : null,
    final_description: currentDescription,
    iterations_run: history.length,
    holdout,
    train_size: trainSize,
    test_size: testSize,
    history
  }
}

function printEvalStats(
  label: string,
  results: EvalResultItem[],
  elapsedSeconds: number
): void {
  const positives = results.filter((result) => result.should_trigger)
  const negatives = results.filter((result) => !result.should_trigger)
  const truePositives = positives.reduce(
    (sum, result) => sum + result.triggers,
    0
  )
  const positiveRuns = positives.reduce((sum, result) => sum + result.runs, 0)
  const falseNegatives = positiveRuns - truePositives
  const falsePositives = negatives.reduce(
    (sum, result) => sum + result.triggers,
    0
  )
  const negativeRuns = negatives.reduce((sum, result) => sum + result.runs, 0)
  const trueNegatives = negativeRuns - falsePositives
  const total = truePositives + trueNegatives + falsePositives + falseNegatives
  const precision =
    truePositives + falsePositives > 0
      ? truePositives / (truePositives + falsePositives)
      : 1
  const recall =
    truePositives + falseNegatives > 0
      ? truePositives / (truePositives + falseNegatives)
      : 1
  const accuracy = total > 0 ? (truePositives + trueNegatives) / total : 0

  process.stderr.write(
    `${label}: ${truePositives + trueNegatives}/${total} correct, precision=${Math.round(precision * 100)}% recall=${Math.round(recall * 100)}% accuracy=${Math.round(accuracy * 100)}% (${elapsedSeconds.toFixed(1)}s)\n`
  )
  for (const result of results) {
    process.stderr.write(
      `  [${result.pass ? "PASS" : "FAIL"}] rate=${result.triggers}/${result.runs} expected=${result.should_trigger}: ${result.query.slice(0, 60)}\n`
    )
  }
}

export async function runLoop(options: RunLoopOptions): Promise<LoopResult> {
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
    runEval = defaultRunEval,
    improveDescription = defaultImproveDescription,
    onIteration
  } = options
  let currentDescription = descriptionOverride ?? originalDescription

  const { train: trainSet, test: testSet } =
    holdout > 0 ? splitEvalSet(evalSet, holdout) : { train: evalSet, test: [] }
  if (verbose && holdout > 0) {
    process.stderr.write(
      `Split: ${trainSet.length} train, ${testSet.length} test (holdout=${holdout})\n`
    )
  }

  const history: IterationRecord[] = []
  let exitReason = "unknown"

  for (let iteration = 1; iteration <= maxIterations; iteration++) {
    if (verbose) {
      process.stderr.write(`\n${"=".repeat(60)}\n`)
      process.stderr.write(`Iteration ${iteration}/${maxIterations}\n`)
      process.stderr.write(`Description: ${currentDescription}\n`)
      process.stderr.write(`${"=".repeat(60)}\n`)
    }

    const allQueries = [...trainSet, ...testSet]
    const evalStarted = performance.now()
    const allResults = await runEval({
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
    })
    const evalElapsed = (performance.now() - evalStarted) / 1000

    const trainQueries = new Set(trainSet.map((item) => item.query))
    const trainResultList = allResults.results.filter((result) =>
      trainQueries.has(result.query)
    )
    const testResultList = allResults.results.filter(
      (result) => !trainQueries.has(result.query)
    )
    const trainPassed = trainResultList.filter((result) => result.pass).length
    const testPassed = testResultList.filter((result) => result.pass).length

    const record: IterationRecord = {
      iteration,
      description: currentDescription,
      train_passed: trainPassed,
      train_failed: trainResultList.length - trainPassed,
      train_total: trainResultList.length,
      train_results: trainResultList,
      test_passed: testSet.length > 0 ? testPassed : null,
      test_failed:
        testSet.length > 0 ? testResultList.length - testPassed : null,
      test_total: testSet.length > 0 ? testResultList.length : null,
      test_results: testSet.length > 0 ? testResultList : null,
      passed: trainPassed,
      failed: trainResultList.length - trainPassed,
      total: trainResultList.length,
      results: trainResultList
    }
    history.push(record)

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
    )

    if (verbose) {
      printEvalStats("Train", trainResultList, evalElapsed)
      if (testSet.length > 0) printEvalStats("Test ", testResultList, 0)
    }

    if (record.train_failed === 0) {
      exitReason = `all_passed (iteration ${iteration})`
      if (verbose) {
        process.stderr.write(
          `\nAll train queries passed on iteration ${iteration}!\n`
        )
      }
      break
    }

    if (iteration === maxIterations) {
      exitReason = `max_iterations (${maxIterations})`
      if (verbose) {
        process.stderr.write(`\nMax iterations reached (${maxIterations}).\n`)
      }
      break
    }

    if (verbose) process.stderr.write("\nImproving description...\n")
    const improveStarted = performance.now()
    const newDescription = await improveDescription({
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
        description: attempt.description as string
      })),
      testResults: null,
      model,
      logDir,
      iteration
    })
    const improveElapsed = (performance.now() - improveStarted) / 1000

    if (verbose) {
      process.stderr.write(
        `Proposed (${improveElapsed.toFixed(1)}s): ${newDescription}\n`
      )
    }
    currentDescription = newDescription
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
  )

  if (verbose) {
    const best = selectBest(history, testSet.length > 0)
    process.stderr.write(`\nExit reason: ${exitReason}\n`)
    process.stderr.write(
      `Best score: ${result.best_score} (iteration ${best.iteration})\n`
    )
  }

  return result
}

function timestamp(): string {
  const now = new Date()
  const pad = (value: number) => String(value).padStart(2, "0")
  return `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}_${pad(now.getHours())}${pad(now.getMinutes())}${pad(now.getSeconds())}`
}

async function main(): Promise<void> {
  const { values } = parseArgs({
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
  })

  if (!values["eval-set"]) throw new Error("--eval-set is required")
  if (!values["skill-path"]) throw new Error("--skill-path is required")
  if (!values.model) throw new Error("--model is required")

  let skillContent: string
  try {
    skillContent = await readFile(
      join(values["skill-path"], "SKILL.md"),
      "utf8"
    )
  } catch {
    throw new Error(`No SKILL.md found at ${values["skill-path"]}`)
  }
  const parsed = parseSkillMd(skillContent)
  const evalSet = parseEvalSet(await readFile(values["eval-set"], "utf8"))

  const resultsDir = values["results-dir"]
    ? join(values["results-dir"], timestamp())
    : undefined
  if (resultsDir) await mkdir(resultsDir, { recursive: true })

  // --report is accepted for CLI compatibility. Task 9 wires report output.
  void values.report

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
    logDir: resultsDir ? join(resultsDir, "logs") : undefined
  })

  const json = `${JSON.stringify(result, null, 2)}\n`
  process.stdout.write(json)
  if (resultsDir) {
    await writeFile(join(resultsDir, "results.json"), json, "utf8")
    process.stderr.write(`Results saved to: ${resultsDir}\n`)
  }
}

function isDirectRun(expected: string): boolean {
  const entry = process.argv[1]
  if (!entry) return false
  // Bundled modules share import.meta.url, so dispatch by the configured output filename.
  return basename(entry, extname(entry)) === expected
}

if (isDirectRun("run-loop")) {
  main().catch((error) => {
    process.stderr.write(`${(error as Error).message}\n`)
    process.exitCode = 1
  })
}
