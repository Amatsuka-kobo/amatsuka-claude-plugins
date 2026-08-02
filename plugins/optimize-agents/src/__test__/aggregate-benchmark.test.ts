import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { afterEach, expect, test } from "vitest"
import { aggregateBenchmark } from "../aggregate-benchmark.js"

const directories: string[] = []

interface RunSpec {
  passed?: number
  total?: number
  time?: number
  tokens?: number | null
  environment?: {
    base_url: string
    auth_source: string
    model: string
  }
  checkerError?: boolean
  omitTiming?: boolean
}

async function runDirectory(): Promise<string> {
  const directory = await mkdtemp(join(tmpdir(), "aggregate-benchmark-"))
  directories.push(directory)
  return directory
}

async function writeRun(
  root: string,
  configuration: string,
  run: number,
  spec: RunSpec,
  evalId = 0
): Promise<void> {
  const directory = join(root, `eval-${evalId}`, configuration, `run-${run}`)
  await mkdir(directory, { recursive: true })
  if (spec.checkerError) {
    await writeFile(join(directory, "checker-error.txt"), "failed")
  } else {
    await writeFile(
      join(directory, "grading.json"),
      JSON.stringify({
        summary: { passed: spec.passed ?? 1, total: spec.total ?? 1 }
      })
    )
  }
  if (!spec.omitTiming) {
    await writeFile(
      join(directory, "timing.json"),
      JSON.stringify({
        total_duration_seconds: spec.time ?? 1,
        total_tokens: spec.tokens ?? null,
        environment: spec.environment ?? {
          base_url: "(default)",
          auth_source: "(claude.ai login)",
          model: "test"
        }
      })
    )
  }
}

afterEach(async () => {
  await Promise.all(
    directories
      .splice(0)
      .map((directory) => rm(directory, { recursive: true, force: true }))
  )
})

test("2 構成 1 run の pass_rate mean を集計する", async () => {
  const root = await runDirectory()
  await writeRun(root, "with_skill", 1, { passed: 3, total: 4 })
  await writeRun(root, "without_skill", 1, { passed: 1, total: 4 })
  const { benchmark } = await aggregateBenchmark({ runDir: root })
  expect(benchmark.run_summary.with_skill?.pass_rate.mean).toBe(0.75)
  expect(benchmark.run_summary.without_skill?.pass_rate.mean).toBe(0.25)
})

test("3 run の母標準偏差を集計する", async () => {
  const root = await runDirectory()
  for (const [index, passed] of [0, 1, 2].entries()) {
    await writeRun(root, "with_skill", index + 1, { passed, total: 2 })
    await writeRun(root, "without_skill", index + 1, { passed: 1, total: 2 })
  }
  const { benchmark } = await aggregateBenchmark({ runDir: root })
  expect(benchmark.run_summary.with_skill?.pass_rate.mean).toBe(0.5)
  expect(benchmark.run_summary.with_skill?.pass_rate.stddev).toBeCloseTo(
    Math.sqrt(1 / 6)
  )
})

test("1 run の標準偏差は 0", async () => {
  const root = await runDirectory()
  await writeRun(root, "with_skill", 1, { passed: 1, total: 2 })
  const { benchmark } = await aggregateBenchmark({ runDir: root })
  expect(benchmark.run_summary.with_skill?.pass_rate.stddev).toBe(0)
})

test("timing.json 欠落時も pass_rate を集計する", async () => {
  const root = await runDirectory()
  await writeRun(root, "with_skill", 1, {
    passed: 1,
    total: 2,
    omitTiming: true
  })
  const { benchmark } = await aggregateBenchmark({ runDir: root })
  expect(benchmark.run_summary.with_skill?.pass_rate.mean).toBe(0.5)
  expect(benchmark.run_summary.with_skill?.time_seconds).toBeNull()
  expect(benchmark.run_summary.with_skill?.tokens).toBeNull()
})

test("environment 不一致を notes と警告へ記録する", async () => {
  const root = await runDirectory()
  await writeRun(root, "with_skill", 1, {
    environment: {
      base_url: "https://one.example",
      auth_source: "ANTHROPIC_AUTH_TOKEN",
      model: "test"
    }
  })
  await writeRun(root, "without_skill", 1, {
    environment: {
      base_url: "https://two.example",
      auth_source: "ANTHROPIC_API_KEY",
      model: "test"
    }
  })
  const warnings: string[] = []
  const { benchmark } = await aggregateBenchmark({
    runDir: root,
    warn: (warning) => warnings.push(warning)
  })
  expect(benchmark.notes.some((note) => note.includes("environment"))).toBe(
    true
  )
  expect(warnings).toHaveLength(1)
})

test("checker-error run を除外後の run 数で集計する", async () => {
  const root = await runDirectory()
  await writeRun(root, "with_skill", 1, { passed: 1, total: 1 })
  await writeRun(root, "with_skill", 2, { checkerError: true })
  await writeRun(root, "with_skill", 3, { passed: 0, total: 1 })
  const { benchmark } = await aggregateBenchmark({ runDir: root })
  expect(benchmark.run_summary.with_skill).toMatchObject({
    total_runs: 3,
    included_runs: 2,
    excluded_runs: 1
  })
  expect(benchmark.run_summary.with_skill?.pass_rate.mean).toBe(0.5)
  expect(benchmark.notes).toContain(
    "with_skill: 3 run 中 1 run がチェッカー失敗により除外"
  )
})

test("全 run 失敗の構成は統計を null にする", async () => {
  const root = await runDirectory()
  await writeRun(root, "with_skill", 1, { checkerError: true })
  await writeRun(root, "with_skill", 2, { checkerError: true })
  const { benchmark } = await aggregateBenchmark({ runDir: root })
  expect(benchmark.run_summary.with_skill).toBeNull()
  expect(benchmark.notes.some((note) => note.includes("全 run が失敗"))).toBe(
    true
  )
})
