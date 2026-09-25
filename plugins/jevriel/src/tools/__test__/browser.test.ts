import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises"
import { createRequire } from "node:module"
import { tmpdir } from "node:os"
import { join } from "node:path"
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js"
import { afterEach, describe, expect, it, vi } from "vitest"
import { type BrowserToolDeps, registerBrowserTools } from "../browser.js"
import type { ToolResponse } from "../shared.js"

type ProgressNotification = {
  method: "notifications/progress"
  params: {
    progressToken: string | number
    progress: number
    total: number
  }
}

type ProgressExtra = {
  _meta?: { progressToken?: string | number }
  sendNotification: (notification: ProgressNotification) => Promise<void>
}

type BrowserHandler = (
  args: Record<string, never>,
  extra: ProgressExtra
) => Promise<ToolResponse>

const tempDirs: string[] = []

async function tempDir(): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), "jevriel-browser-tool-test-"))
  tempDirs.push(dir)
  return dir
}

async function installFakePlaywright(cacheDir: string): Promise<void> {
  const packageDir = join(cacheDir, "node_modules", "playwright")
  const executablePath = join(cacheDir, "chromium")
  await mkdir(packageDir, { recursive: true })
  await writeFile(
    join(packageDir, "package.json"),
    JSON.stringify({ name: "playwright", version: "1.63.2", main: "index.cjs" })
  )
  await writeFile(
    join(packageDir, "index.cjs"),
    `module.exports = { chromium: { executablePath: () => ${JSON.stringify(executablePath)}, launch: async () => ({ close: async () => {} }) } }`
  )
  await writeFile(executablePath, "")
}

function depsFor(
  cacheDir: string,
  spawn: BrowserToolDeps["spawn"]
): BrowserToolDeps {
  return {
    jev: vi.fn() as unknown as BrowserToolDeps["jev"],
    env: {},
    projectDir: cacheDir,
    now: () => new Date("2026-09-25T00:00:00.000Z"),
    httpFetch: fetch,
    cacheDir,
    spawn,
    platform: "linux"
  }
}

function register(deps: BrowserToolDeps): BrowserHandler {
  const handlers: BrowserHandler[] = []
  const server = {
    registerTool: (
      _name: string,
      _config: unknown,
      handler: BrowserHandler
    ) => {
      handlers.push(handler)
    }
  } as unknown as McpServer
  registerBrowserTools(server, deps)
  return handlers[0]
}

afterEach(async () => {
  await Promise.all(
    tempDirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true }))
  )
})

describe("browser_setup", () => {
  it("works without TYPESAFE_API_KEY and reports progress when requested", async () => {
    const cacheDir = await tempDir()
    await installFakePlaywright(cacheDir)
    const sendNotification = vi.fn(
      async (_notification: ProgressNotification) => {}
    )
    const handler = register(
      depsFor(
        cacheDir,
        vi.fn(async () => ({ code: 0, outputTail: "" }))
      )
    )

    const response = await handler(
      {},
      { _meta: { progressToken: "progress-1" }, sendNotification }
    )
    const result = JSON.parse(response.content[0].text) as {
      status: string
      steps: Array<{ step: string; ran: boolean }>
    }

    expect(response.isError).toBeUndefined()
    expect(result.status).toBe("already_installed")
    expect(result.steps.every((step) => !step.ran)).toBe(true)
    expect(sendNotification).toHaveBeenCalledTimes(8)
    expect(sendNotification).toHaveBeenCalledWith({
      method: "notifications/progress",
      params: { progressToken: "progress-1", progress: 0, total: 4 }
    })
    expect(sendNotification).toHaveBeenLastCalledWith({
      method: "notifications/progress",
      params: { progressToken: "progress-1", progress: 4, total: 4 }
    })
  })

  it("reloads the package after npm upgrades Playwright in the same process", async () => {
    const cacheDir = await tempDir()
    const packageDir = join(cacheDir, "node_modules", "playwright")
    const executablePath = join(cacheDir, "chromium")
    await mkdir(packageDir, { recursive: true })
    await writeFile(
      join(packageDir, "package.json"),
      JSON.stringify({
        name: "playwright",
        version: "1.62.9",
        main: "index.cjs"
      })
    )
    await writeFile(
      join(packageDir, "index.cjs"),
      `module.exports = { chromium: { executablePath: () => ${JSON.stringify(executablePath)}, launch: async () => { throw new Error("stale Playwright module") } } }`
    )
    createRequire(join(cacheDir, "package.json"))("playwright")

    const spawn = vi.fn(async () => {
      await writeFile(
        join(packageDir, "package.json"),
        JSON.stringify({
          name: "playwright",
          version: "1.63.4",
          main: "index.cjs"
        })
      )
      await writeFile(
        join(packageDir, "index.cjs"),
        `module.exports = { chromium: { executablePath: () => ${JSON.stringify(executablePath)}, launch: async () => ({ close: async () => {} }) } }`
      )
      await writeFile(executablePath, "")
      return { code: 0, outputTail: "" }
    })
    const handler = register(depsFor(cacheDir, spawn))
    const response = await handler({}, { sendNotification: vi.fn() })
    const result = JSON.parse(response.content[0].text) as {
      playwrightVersion: string
      status: string
    }

    expect(response.isError).toBeUndefined()
    expect(result).toMatchObject({
      status: "installed",
      playwrightVersion: "1.63.4"
    })
  })

  it("returns setup_failed when npm cannot be started", async () => {
    const cacheDir = await tempDir()
    const handler = register(
      depsFor(
        cacheDir,
        vi.fn(async () => {
          throw new Error("spawn npm ENOENT")
        })
      )
    )

    const response = await handler({}, { sendNotification: vi.fn() })
    const result = JSON.parse(response.content[0].text) as {
      error: { kind: string; message: string }
    }

    expect(response.isError).toBe(true)
    expect(result.error.kind).toBe("setup_failed")
    expect(result.error.message).toContain("spawn npm ENOENT")
  })
})
