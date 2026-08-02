#!/usr/bin/env node

import { spawn } from "node:child_process"
import { mkdir, readFile, rename, rm, writeFile } from "node:fs/promises"
import { dirname, isAbsolute, resolve } from "node:path"
import { runChecker } from "./lib/checker.js"
import { captureEnvironment } from "./lib/environment.js"
import { buildSandbox, type FixtureSpec } from "./lib/sandbox.js"

interface OutputEval {
  id: number
  name?: string
  prompt: string
  fixtures?: FixtureSpec[]
}

interface OutputEvalFile {
  skill_name: string
  skill_root: string
  checker?: string
  evals: OutputEval[]
}

interface ClaudeResult {
  durationSeconds: number
  code: number | null
  stderr: string
  timedOut: boolean
}

const args = process.argv.slice(2)
const opt = (name: string, fallback?: string): string | undefined => {
  const index = args.indexOf(`--${name}`)
  return index >= 0 ? args[index + 1] : fallback
}

function positiveInteger(value: string | undefined, name: string): number {
  const parsed = Number(value)
  if (!Number.isInteger(parsed) || parsed < 1)
    throw new Error(`--${name} must be a positive integer`)
  return parsed
}

function resolveInputPath(value: string): string {
  return isAbsolute(value) ? value : resolve(value)
}

function runClaude(
  workspace: string,
  prompt: string,
  model: string,
  timeoutMs: number
): Promise<ClaudeResult> {
  return new Promise((resolveResult) => {
    const env = { ...process.env }
    delete env.CLAUDECODE
    const started = process.hrtime.bigint()
    const child = spawn("claude", ["-p", prompt, "--model", model], {
      cwd: workspace,
      env,
      stdio: ["ignore", "ignore", "pipe"]
    })
    let stderr = ""
    let settled = false
    let timedOut = false
    child.stderr.on("data", (chunk) => {
      stderr += chunk.toString()
    })
    const finish = (code: number | null) => {
      if (settled) return
      settled = true
      clearTimeout(timer)
      resolveResult({
        durationSeconds: Number(process.hrtime.bigint() - started) / 1e9,
        code,
        stderr,
        timedOut
      })
    }
    const timer = setTimeout(() => {
      timedOut = true
      child.kill("SIGKILL")
    }, timeoutMs)
    child.on("error", (error) => {
      stderr += `${stderr ? "\n" : ""}${error.message}`
      finish(null)
    })
    child.on("close", finish)
  })
}

const evalFileArg = opt("eval-file")
const runDirArg = opt("run-dir")
if (!evalFileArg || !runDirArg) {
  console.error(
    "usage: run-output-eval.mjs --eval-file <output-evals.json> --run-dir <output>"
  )
  process.exit(2)
}

const runs = positiveInteger(opt("runs", "1"), "runs")
const model = opt("model", "claude-opus-5") as string
const timeoutSeconds = positiveInteger(opt("timeout", "600"), "timeout")
const evalIdArg = opt("eval-id")
const selectedEvalId = evalIdArg === undefined ? undefined : Number(evalIdArg)
if (evalIdArg !== undefined && !Number.isInteger(selectedEvalId))
  throw new Error("--eval-id must be an integer")

const evalFile = resolveInputPath(evalFileArg)
const evalDirectory = dirname(evalFile)
const runDirectory = resolveInputPath(runDirArg)
const config = JSON.parse(await readFile(evalFile, "utf8")) as OutputEvalFile

if (!config.checker) {
  console.error("checker が未指定のため output eval を行いません")
  process.exit(0)
}

const skillRoot = resolve(evalDirectory, config.skill_root)
const evals =
  selectedEvalId === undefined
    ? config.evals
    : config.evals.filter((item) => item.id === selectedEvalId)
if (selectedEvalId !== undefined && evals.length === 0)
  throw new Error(`eval id not found: ${selectedEvalId}`)

const configurations = [
  { name: "with_skill", includeSkill: true },
  { name: "without_skill", includeSkill: false }
]

await mkdir(runDirectory, { recursive: true })
for (const evaluation of evals) {
  for (const configuration of configurations) {
    for (let run = 1; run <= runs; run++) {
      console.error(
        `eval ${evaluation.id} ${configuration.name} run ${run}/${runs}`
      )
      const sandbox = await buildSandbox({
        skillRoot,
        skillName: config.skill_name,
        includeSkill: configuration.includeSkill,
        fixtures: evaluation.fixtures ?? [],
        fixtureBaseDir: evalDirectory
      })
      const destination = resolve(
        runDirectory,
        `eval-${evaluation.id}`,
        configuration.name,
        `run-${run}`
      )
      const outputDirectory = resolve(destination, "output")
      await rm(destination, { recursive: true, force: true })
      await mkdir(destination, { recursive: true })

      let claudeResult: ClaudeResult
      try {
        claudeResult = await runClaude(
          sandbox,
          evaluation.prompt,
          model,
          timeoutSeconds * 1000
        )
        await rm(outputDirectory, { recursive: true, force: true })
        await rename(sandbox, outputDirectory)
      } catch (error) {
        await rm(sandbox, { recursive: true, force: true })
        throw error
      }

      await writeFile(
        resolve(destination, "timing.json"),
        `${JSON.stringify(
          {
            total_duration_seconds: claudeResult.durationSeconds,
            total_tokens: null,
            environment: captureEnvironment(model)
          },
          null,
          2
        )}\n`
      )
      if (claudeResult.code !== 0) {
        const status = claudeResult.timedOut
          ? `claude timed out after ${timeoutSeconds} seconds`
          : `claude exited with code ${claudeResult.code}`
        await writeFile(
          resolve(destination, "claude-error.txt"),
          `${status}\n${claudeResult.stderr}`
        )
      }

      await runChecker({
        checker: config.checker,
        cwd: evalDirectory,
        outDir: outputDirectory,
        evalId: evaluation.id,
        runDir: destination
      })
    }
  }
}
