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
 * object. See plugins/prompt-smith/NOTICE.
 */

import { spawn } from "node:child_process"
import { readFile, writeFile } from "node:fs/promises"
import { basename, extname, join } from "node:path"
import { parseArgs } from "node:util"
import { buildEnv, describeEnvironment } from "./lib/claude-cli.js"
import { parseSkillMd } from "./lib/parse-skill-md.js"
import { pool } from "./lib/pool.js"
import {
  buildSandboxSkillMd,
  createSandbox,
  makeCleanName,
  replaceDescription
} from "./lib/sandbox.js"
import { judge, TriggerDetector } from "./lib/stream-parse.js"
import type {
  EvalItem,
  EvalResult,
  EvalResultItem,
  RunEvalOptions
} from "./lib/types.js"

/** 1 クエリを 1 回だけ測る。発火したら true。 */
async function runSingleQuery(
  query: string,
  skillName: string,
  skillContent: string,
  description: string,
  timeout: number,
  model: string | undefined
): Promise<boolean> {
  const cleanName = makeCleanName(skillName)
  // 改善ループが渡す description を frontmatter へ反映してから測る。
  // これを飛ばすと、反復しても初回の description を測り続ける。
  const measured = buildSandboxSkillMd(
    replaceDescription(skillContent, description),
    cleanName
  )
  const sandbox = await createSandbox(measured, cleanName)

  try {
    const args = [
      "-p",
      query,
      "--output-format",
      "stream-json",
      "--verbose",
      "--include-partial-messages"
    ]
    if (model) args.push("--model", model)

    const child = spawn("claude", args, {
      cwd: sandbox.dir,
      env: buildEnv(),
      stdio: ["ignore", "pipe", "ignore"]
    })

    return await new Promise<boolean>((resolve) => {
      const detector = new TriggerDetector(`${skillName}-skill-`)
      let buffer = ""
      let settled = false

      // kill したあと、プロセスが終わるのを待ってから resolve する。
      // 待たずに抜けると、呼び出し側の finally が cwd を削る間に
      // プロセスがまだ生きている状態になりうる(移植元は kill の後 wait する)。
      const finish = (value: boolean) => {
        if (settled) return
        settled = true
        clearTimeout(timer)
        if (child.exitCode === null && child.signalCode === null) {
          child.once("close", () => resolve(value))
          child.kill("SIGKILL")
          return
        }
        resolve(value)
      }

      const timer = setTimeout(() => finish(false), timeout * 1000)

      child.stdout.on("data", (chunk) => {
        if (settled) return
        buffer += String(chunk)
        let newline = buffer.indexOf("\n")
        while (newline !== -1) {
          const line = buffer.slice(0, newline)
          buffer = buffer.slice(newline + 1)
          const verdict = detector.push(line)
          if (verdict !== null) {
            finish(verdict)
            return
          }
          newline = buffer.indexOf("\n")
        }
      })

      child.on("error", (error) => {
        process.stderr.write(`Warning: query failed: ${error.message}\n`)
        finish(false)
      })

      child.on("close", () => finish(false))
    })
  } finally {
    await sandbox.cleanup()
  }
}

export async function runEval(options: RunEvalOptions): Promise<EvalResult> {
  const jobs = options.evalSet.flatMap((item) =>
    Array.from({ length: options.runsPerQuery }, () => item)
  )

  // 1 件の失敗で eval 全体を落とさない。移植元も future の例外を False として
  // 積み、残りを続ける(run_eval.py 221-225 行)。
  const outcomes = await pool(jobs, options.numWorkers, async (item) => {
    try {
      return await runSingleQuery(
        item.query,
        options.skillName,
        options.skillContent,
        options.description,
        options.timeout,
        options.model
      )
    } catch (error) {
      process.stderr.write(
        `Warning: query failed: ${(error as Error).message}\n`
      )
      return false
    }
  })

  const triggersByQuery = new Map<string, number[]>()
  jobs.forEach((item, index) => {
    const list = triggersByQuery.get(item.query) ?? []
    list.push(outcomes[index] ? 1 : 0)
    triggersByQuery.set(item.query, list)
  })

  const results: EvalResultItem[] = options.evalSet.map((item) => {
    const outcomesForQuery = triggersByQuery.get(item.query) ?? []
    const triggers = outcomesForQuery.reduce((sum, value) => sum + value, 0)
    const runs = outcomesForQuery.length
    const triggerRate = runs === 0 ? 0 : triggers / runs
    const passed = judge(
      triggerRate,
      item.should_trigger,
      options.triggerThreshold
    )
    if (options.verbose) {
      process.stderr.write(
        `  [${passed ? "PASS" : "FAIL"}] rate=${triggers}/${runs} expected=${item.should_trigger}: ${item.query.slice(0, 60)}\n`
      )
    }
    return {
      query: item.query,
      should_trigger: item.should_trigger,
      trigger_rate: triggerRate,
      triggers,
      runs,
      pass: passed
    }
  })

  const passed = results.filter((r) => r.pass).length
  return {
    skill_name: options.skillName,
    description: options.description,
    environment: describeEnvironment(options.model),
    results,
    summary: { total: results.length, passed, failed: results.length - passed }
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
