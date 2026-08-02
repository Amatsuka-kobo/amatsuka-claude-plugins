import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { afterEach, expect, test } from "vitest"
import { runChecker } from "../lib/checker.js"

const directories: string[] = []

async function workspace(): Promise<{
  root: string
  cwd: string
  outDir: string
  runDir: string
}> {
  const root = await mkdtemp(join(tmpdir(), "checker-contract-"))
  directories.push(root)
  const cwd = join(root, "evals")
  const outDir = join(root, "output")
  const runDir = join(root, "run")
  await Promise.all([
    mkdir(cwd, { recursive: true }),
    mkdir(outDir, { recursive: true }),
    mkdir(runDir, { recursive: true })
  ])
  return { root, cwd, outDir, runDir }
}

async function content(path: string): Promise<string | null> {
  try {
    return await readFile(path, "utf8")
  } catch {
    return null
  }
}

afterEach(async () => {
  await Promise.all(
    directories
      .splice(0)
      .map((directory) => rm(directory, { recursive: true, force: true }))
  )
})

test("シェルスクリプトのチェッカーを実行できる", async () => {
  const paths = await workspace()
  await writeFile(
    join(paths.cwd, "fake-checker.sh"),
    'printf \'%s\' \'{"summary":{"total":1,"passed":1}}\'\n'
  )
  const result = await runChecker({
    checker: "sh ./fake-checker.sh",
    cwd: paths.cwd,
    outDir: paths.outDir,
    evalId: 0,
    runDir: paths.runDir
  })
  expect(result.ok).toBe(true)
  expect(
    JSON.parse((await content(join(paths.runDir, "grading.json"))) as string)
  ).toEqual({ summary: { total: 1, passed: 1 } })
})

test("Node のチェッカーを実行できる", async () => {
  const paths = await workspace()
  await writeFile(
    join(paths.cwd, "fake-checker.mjs"),
    "console.log(JSON.stringify({summary:{total:2,passed:1}}))\n"
  )
  const result = await runChecker({
    checker: "node ./fake-checker.mjs",
    cwd: paths.cwd,
    outDir: paths.outDir,
    evalId: 1,
    runDir: paths.runDir
  })
  expect(result.ok).toBe(true)
  expect(
    JSON.parse((await content(join(paths.runDir, "grading.json"))) as string)
  ).toEqual({ summary: { total: 2, passed: 1 } })
})

test("非 0 終了では checker-error.txt を残す", async () => {
  const paths = await workspace()
  await writeFile(
    join(paths.cwd, "fake-checker.sh"),
    "printf 'failed' >&2\nexit 7\n"
  )
  const result = await runChecker({
    checker: "sh ./fake-checker.sh",
    cwd: paths.cwd,
    outDir: paths.outDir,
    evalId: 0,
    runDir: paths.runDir
  })
  expect(result.ok).toBe(false)
  expect(await content(join(paths.runDir, "checker-error.txt"))).toContain(
    "failed"
  )
  expect(await content(join(paths.runDir, "grading.json"))).toBeNull()
})

test("非 JSON 出力では checker-error.txt を残す", async () => {
  const paths = await workspace()
  await writeFile(join(paths.cwd, "fake-checker.sh"), "printf 'not json'\n")
  const result = await runChecker({
    checker: "sh ./fake-checker.sh",
    cwd: paths.cwd,
    outDir: paths.outDir,
    evalId: 0,
    runDir: paths.runDir
  })
  expect(result.ok).toBe(false)
  expect(await content(join(paths.runDir, "checker-error.txt"))).toContain(
    "not valid JSON"
  )
  expect(await content(join(paths.runDir, "grading.json"))).toBeNull()
})

test("チェッカーは eval ファイルのディレクトリを cwd にする", async () => {
  const paths = await workspace()
  await writeFile(join(paths.cwd, "adjacent.txt"), "relative-data")
  await writeFile(
    join(paths.cwd, "fake-checker.mjs"),
    [
      'import { readFileSync } from "node:fs"',
      'const value = readFileSync("./adjacent.txt", "utf8")',
      "console.log(JSON.stringify({value, outDir: process.argv[2], evalId: process.argv[3]}))"
    ].join("\n")
  )
  await runChecker({
    checker: "node ./fake-checker.mjs",
    cwd: paths.cwd,
    outDir: paths.outDir,
    evalId: 42,
    runDir: paths.runDir
  })
  const grading = JSON.parse(
    (await content(join(paths.runDir, "grading.json"))) as string
  ) as { value: string; outDir: string; evalId: string }
  expect(grading.value).toBe("relative-data")
  expect(grading.outDir).toBe(paths.outDir)
  expect(grading.evalId).toBe("42")
})
