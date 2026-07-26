import type { ChildProcess } from "node:child_process"
import { spawn } from "node:child_process"
import fs from "node:fs"
import { createRequire } from "node:module"
import os from "node:os"
import path from "node:path"
import { fileURLToPath } from "node:url"
import { expect, test } from "vitest"

const SERVE = fileURLToPath(new URL("../serve.ts", import.meta.url))
const TSX_CLI = createRequire(import.meta.url).resolve("tsx/cli")

function waitForUrl(child: ChildProcess): Promise<string> {
  const stdout = child.stdout
  if (stdout === null) throw new Error("stdout is not available")

  return new Promise((resolve, reject) => {
    let output = ""
    const timer = setTimeout(() => {
      reject(new Error(`server startup timed out: ${output}`))
    }, 10_000)

    stdout.on("data", (chunk: Buffer) => {
      output += chunk.toString("utf8")
      const match = output.match(
        /guidepost viewer: (http:\/\/127\.0\.0\.1:\d+\/)$/m
      )
      if (match === null) return
      clearTimeout(timer)
      resolve(match[1])
    })
    child.once("error", (error) => {
      clearTimeout(timer)
      reject(error)
    })
    child.once("exit", (code) => {
      clearTimeout(timer)
      reject(new Error(`server exited before startup (${code}): ${output}`))
    })
  })
}

async function stop(child: ChildProcess): Promise<void> {
  if (child.exitCode !== null) return
  child.kill("SIGTERM")
  await new Promise<void>((resolve) => {
    child.once("exit", () => resolve())
  })
}

test("起動時に URL 行を標準出力へ出す", async () => {
  const projectDir = fs.mkdtempSync(path.join(os.tmpdir(), "guidepost-serve-"))
  const child = spawn(
    process.execPath,
    [TSX_CLI, SERVE, "--port", "0", "--dir", projectDir],
    { stdio: ["ignore", "pipe", "pipe"] }
  )

  try {
    const url = await waitForUrl(child)
    expect(url).toMatch(/^http:\/\/127\.0\.0\.1:\d+\/$/)
  } finally {
    await stop(child)
    fs.rmSync(projectDir, { recursive: true, force: true })
  }
})
