import type { ChildProcess } from "node:child_process"
import { spawn } from "node:child_process"
import fs from "node:fs"
import { createRequire } from "node:module"
import os from "node:os"
import path from "node:path"
import { fileURLToPath } from "node:url"
import { afterEach, expect, test } from "vitest"

const SERVE = fileURLToPath(new URL("../serve.ts", import.meta.url))
const TSX_CLI = createRequire(import.meta.url).resolve("tsx/cli")

let child: ChildProcess | null = null
let projectDir = ""

interface ServeInfo {
  port: number
  token: string
  pid: number
  startedAt: string
  url: string
}

function waitFor<T>(read: () => T | null, timeoutMs: number): Promise<T> {
  return new Promise((resolve, reject) => {
    const start = Date.now()
    const timer = setInterval(() => {
      const value = read()
      if (value !== null) {
        clearInterval(timer)
        resolve(value)
      } else if (Date.now() - start > timeoutMs) {
        clearInterval(timer)
        reject(new Error("timeout"))
      }
    }, 100)
  })
}

function readServeJson(): ServeInfo | null {
  try {
    return JSON.parse(
      fs.readFileSync(path.join(projectDir, ".pitcrew", "serve.json"), "utf8")
    ) as ServeInfo
  } catch {
    return null
  }
}

async function startServe(args: string[] = []): Promise<ServeInfo> {
  projectDir = fs.mkdtempSync(path.join(os.tmpdir(), "pitcrew-serve-"))
  child = spawn(
    process.execPath,
    [TSX_CLI, SERVE, "--port", "0", "--dir", projectDir, ...args],
    { stdio: ["ignore", "pipe", "pipe"] }
  )
  return waitFor(readServeJson, 15000)
}

afterEach(async () => {
  if (child && child.exitCode === null) {
    child.kill("SIGTERM")
    await new Promise((r) => child?.once("exit", r))
  }
  child = null
  fs.rmSync(projectDir, { recursive: true, force: true })
})

test("起動で serve.json が書かれ、URL でトップページが開ける", async () => {
  const info = await startServe()
  expect(info.port).toBeGreaterThan(0)
  expect(info.token.length).toBeGreaterThanOrEqual(32)
  expect(info.url).toBe(`http://127.0.0.1:${info.port}/?token=${info.token}`)
  const res = await fetch(info.url)
  expect(res.status).toBe(200)
  expect(await res.text()).toContain("pitcrew")
})

test("SIGTERM で serve.json が削除されて終了する", async () => {
  await startServe()
  child?.kill("SIGTERM")
  await new Promise((r) => child?.once("exit", r))
  expect(readServeJson()).toBeNull()
})

test("theme 設定が HTML に埋め込まれる", async () => {
  projectDir = fs.mkdtempSync(path.join(os.tmpdir(), "pitcrew-serve-"))
  const claudeDir = path.join(projectDir, ".claude")
  fs.mkdirSync(claudeDir, { recursive: true })
  fs.writeFileSync(
    path.join(claudeDir, "pitcrew.local.md"),
    "---\ntheme: dark\n---\n"
  )
  child = spawn(
    process.execPath,
    [TSX_CLI, SERVE, "--port", "0", "--dir", projectDir],
    { stdio: ["ignore", "pipe", "pipe"] }
  )
  const info = await waitFor(readServeJson, 15000)
  const html = await (await fetch(info.url)).text()
  expect(html).toContain('data-config-theme="dark"')
})
