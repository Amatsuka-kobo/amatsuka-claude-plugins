import { existsSync } from "node:fs"
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises"
import { createRequire } from "node:module"
import { tmpdir } from "node:os"
import { join } from "node:path"
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js"
import type { Browser } from "playwright-core"
import { afterEach, describe, expect, it, vi } from "vitest"
import { z } from "zod"
import {
  BrowserLaunchError,
  PlaywrightMissingError
} from "../../browser/playwright.js"
import {
  createJevCall,
  type JevCall,
  type JevRequest
} from "../../jev/client.js"
import {
  type BrowserToolDeps,
  browserCheckInput,
  handleBrowserCheck,
  registerBrowserTools
} from "../browser.js"
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
  spawn: BrowserToolDeps["spawn"],
  launch: BrowserToolDeps["launch"] = vi.fn<BrowserToolDeps["launch"]>()
): BrowserToolDeps {
  return {
    jev: vi.fn() as unknown as BrowserToolDeps["jev"],
    env: {},
    projectDir: cacheDir,
    now: () => new Date("2026-09-25T00:00:00.000Z"),
    httpFetch: fetch,
    cacheDir,
    spawn,
    platform: "linux",
    launch
  }
}

function body<T>(response: ToolResponse): T {
  return JSON.parse(response.content[0].text) as T
}

function browserArgs(overrides: Record<string, unknown> = {}) {
  return z.object(browserCheckInput).parse({
    url: "https://example.test/page?token=secret&page=2",
    assertions: ["The page contains the expected heading."],
    ...overrides
  })
}

function jevFor(
  probabilities: number[] = [0.9],
  onRequest?: (request: JevRequest) => void
): JevCall {
  return createJevCall({
    apiKey: "test",
    fetch: async (_input, init) => {
      const request = JSON.parse(String(init?.body)) as JevRequest
      onRequest?.(request)
      const answers = Object.fromEntries(
        Object.keys(request.questions).map((id, index) => [
          id,
          {
            type: "noul",
            noul:
              probabilities[index] ??
              probabilities[probabilities.length - 1] ??
              0.9
          }
        ])
      )
      return new Response(
        JSON.stringify({
          model: "jev-test",
          answers,
          usage: { input_tokens: 17, output_tokens: 0 }
        }),
        { headers: { "content-type": "application/json" } }
      )
    }
  })
}

function browserCheckHarness(
  cacheDir: string,
  options: {
    status?: number
    pageUrl?: string
    gotoError?: Error
    probabilities?: number[]
    onRequest?: (request: JevRequest) => void
  } = {}
) {
  const goto = vi.fn(async (_url: string, _options: unknown) => {
    if (options.gotoError) throw options.gotoError
    return { status: () => options.status ?? 200 }
  })
  const page = {
    goto,
    title: vi.fn(async () => "Example page"),
    url: vi.fn(
      () => options.pageUrl ?? "https://example.test/page?token=secret&page=2"
    ),
    ariaSnapshot: vi.fn(async () => '- heading "Welcome"'),
    screenshot: vi.fn(async (_options: unknown) => Buffer.from("fake-png"))
  }
  const context = {
    newPage: vi.fn(async () => page),
    close: vi.fn(async () => {}),
    tracing: { start: vi.fn(), stop: vi.fn() }
  }
  const browser = {
    newContext: vi.fn(async (_options: unknown) => context),
    close: vi.fn(async () => {})
  }
  const launch = vi.fn(
    async (_options: { projectDir: string; cacheDir: string }) => ({
      browser: browser as unknown as Browser,
      source: "cache" as const
    })
  ) as unknown as BrowserToolDeps["launch"]
  const deps = depsFor(
    cacheDir,
    vi.fn(async () => ({ code: 0, outputTail: "" })),
    launch
  )
  deps.env = { TYPESAFE_API_KEY: "test" }
  deps.jev = jevFor(options.probabilities, options.onRequest)
  return { deps, launch, browser, context, page }
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

describe("browser_check", () => {
  it("returns not_configured without launching a browser or creating evidence", async () => {
    const cacheDir = await tempDir()
    const harness = browserCheckHarness(cacheDir)
    harness.deps.env = {}

    const response = await handleBrowserCheck(browserArgs(), harness.deps)

    expect(response.isError).toBe(true)
    expect(body<{ error: { kind: string } }>(response).error.kind).toBe(
      "not_configured"
    )
    expect(harness.launch).not.toHaveBeenCalled()
    expect(existsSync(join(cacheDir, ".jevriel"))).toBe(false)
  })

  it("returns playwright_missing without evidence when Playwright is unavailable", async () => {
    const cacheDir = await tempDir()
    const harness = browserCheckHarness(cacheDir)
    harness.deps.launch = vi.fn(async () => {
      throw new PlaywrightMissingError("missing")
    }) as unknown as BrowserToolDeps["launch"]

    const response = await handleBrowserCheck(browserArgs(), harness.deps)

    expect(response.isError).toBe(true)
    expect(body<{ error: { kind: string } }>(response).error.kind).toBe(
      "playwright_missing"
    )
    expect(existsSync(join(cacheDir, ".jevriel"))).toBe(false)
  })

  it("returns browser_failed without evidence when the initial navigation fails", async () => {
    const cacheDir = await tempDir()
    const harness = browserCheckHarness(cacheDir, {
      gotoError: new Error("navigation failed")
    })

    const response = await handleBrowserCheck(browserArgs(), harness.deps)

    expect(response.isError).toBe(true)
    expect(body<{ error: { kind: string } }>(response).error.kind).toBe(
      "browser_failed"
    )
    expect(harness.browser.close).toHaveBeenCalledOnce()
    expect(existsSync(join(cacheDir, ".jevriel"))).toBe(false)
  })

  it.each([
    404, 503
  ])("continues judging an HTTP %i response and includes its status in state", async (status) => {
    const cacheDir = await tempDir()
    let request: JevRequest | undefined
    const harness = browserCheckHarness(cacheDir, {
      status,
      onRequest: (value) => (request = value)
    })

    const response = await handleBrowserCheck(
      browserArgs({ evidence: "none" }),
      harness.deps
    )

    expect(response.isError).toBeUndefined()
    if (!request) throw new Error("Expected a Jev request to be captured.")
    expect(
      (request.state as { page: { status: number | null } }).page.status
    ).toBe(status)
  })

  it("keys assertions in state and keeps their text out of question instructions", async () => {
    const cacheDir = await tempDir()
    const assertions = [
      "A unique assertion about the account owner.",
      "A second unique assertion about the balance."
    ]
    let request: JevRequest | undefined
    const harness = browserCheckHarness(cacheDir, {
      onRequest: (value) => (request = value)
    })

    await handleBrowserCheck(
      browserArgs({ assertions, evidence: "none" }),
      harness.deps
    )

    const state = request?.state as { assertions: Record<string, string> }
    expect(state.assertions).toEqual({ a1: assertions[0], a2: assertions[1] })
    expect(
      Object.values(request?.questions ?? {}).every(
        (question) =>
          !assertions.some((assertion) =>
            (question.instructions ?? "").includes(assertion)
          )
      )
    ).toBe(true)
  })

  it("sanitizes query values in the state URL", async () => {
    const cacheDir = await tempDir()
    let request: JevRequest | undefined
    const harness = browserCheckHarness(cacheDir, {
      pageUrl: "https://example.test/account?token=secret&page=2",
      onRequest: (value) => (request = value)
    })

    await handleBrowserCheck(browserArgs({ evidence: "none" }), harness.deps)

    if (!request) throw new Error("Expected a Jev request to be captured.")
    expect((request.state as { url: string }).url).toBe(
      "https://example.test/account?token=&page="
    )
  })

  it("passes only when every assertion is satisfied", async () => {
    const cacheDir = await tempDir()
    const args = browserArgs({
      assertions: ["First assertion.", "Second assertion."],
      evidence: "none"
    })
    const pass = browserCheckHarness(cacheDir, { probabilities: [0.9, 0.9] })
    const fail = browserCheckHarness(cacheDir, { probabilities: [0.9, 0.1] })

    const passResponse = await handleBrowserCheck(args, pass.deps)
    const failResponse = await handleBrowserCheck(args, fail.deps)

    expect(
      body<{ tool: string; kind: string; status: string }>(passResponse)
    ).toMatchObject({
      tool: "browser_check",
      kind: "browser",
      status: "pass"
    })
    expect(body<{ status: string }>(failResponse).status).toBe("fail")
    expect(pass.browser.close).toHaveBeenCalledOnce()
    expect(fail.browser.close).toHaveBeenCalledOnce()
  })

  it("saves final screenshot and matching result evidence without starting a trace", async () => {
    const cacheDir = await tempDir()
    const harness = browserCheckHarness(cacheDir)

    const response = await handleBrowserCheck(browserArgs(), harness.deps)
    const record = body<{
      evidence: { dir: string; files: string[] }
    }>(response)

    expect(harness.page.screenshot).toHaveBeenCalledWith({ fullPage: true })
    expect(harness.context.tracing.start).not.toHaveBeenCalled()
    expect(record.evidence.files).toEqual([
      "final.png",
      "log.json",
      "result.json"
    ])
    expect(await readFile(join(record.evidence.dir, "final.png"), "utf8")).toBe(
      "fake-png"
    )
    expect(
      JSON.parse(
        await readFile(join(record.evidence.dir, "result.json"), "utf8")
      )
    ).toEqual(body(response))
  })

  it("does not take a screenshot or create evidence when evidence is none", async () => {
    const cacheDir = await tempDir()
    const harness = browserCheckHarness(cacheDir)

    const response = await handleBrowserCheck(
      browserArgs({ evidence: "none" }),
      harness.deps
    )

    expect(harness.page.screenshot).not.toHaveBeenCalled()
    expect(body<{ evidence: unknown }>(response).evidence).toBeNull()
    expect(existsSync(join(cacheDir, ".jevriel"))).toBe(false)
  })

  it.each([
    "file:///etc/passwd",
    "ftp://example.test/resource"
  ])("rejects non-HTTP URL %s before launching the browser", async (url) => {
    const cacheDir = await tempDir()
    const harness = browserCheckHarness(cacheDir)

    const response = await handleBrowserCheck(
      browserArgs({ url }),
      harness.deps
    )

    expect(response.isError).toBe(true)
    expect(body<{ error: { kind: string } }>(response).error.kind).toBe(
      "invalid_input"
    )
    expect(harness.launch).not.toHaveBeenCalled()
  })

  it("rejects over-budget assertions without calling Jev or creating evidence", async () => {
    const cacheDir = await tempDir()
    const harness = browserCheckHarness(cacheDir)
    const jev = vi.fn<BrowserToolDeps["jev"]>()
    harness.deps.jev = jev

    const response = await handleBrowserCheck(
      browserArgs({ assertions: ["x".repeat(100_000)] }),
      harness.deps
    )

    expect(response.isError).toBe(true)
    expect(body<{ error: { kind: string } }>(response).error.kind).toBe(
      "budget_exceeded"
    )
    expect(jev).not.toHaveBeenCalled()
    expect(existsSync(join(cacheDir, ".jevriel"))).toBe(false)
  })

  it("registers browser_check alongside browser_setup", () => {
    const names: string[] = []
    const server = {
      registerTool: (name: string) => names.push(name)
    } as unknown as McpServer
    const launch = vi.fn<BrowserToolDeps["launch"]>()
    registerBrowserTools(server, depsFor("/unused", vi.fn(), launch))

    expect(names).toEqual(["browser_setup", "browser_check"])
  })

  it("maps a browser launch error to browser_failed without creating evidence", async () => {
    const cacheDir = await tempDir()
    const harness = browserCheckHarness(cacheDir)
    harness.deps.launch = vi.fn(async () => {
      throw new BrowserLaunchError("launch failed")
    }) as unknown as BrowserToolDeps["launch"]

    const response = await handleBrowserCheck(browserArgs(), harness.deps)

    expect(response.isError).toBe(true)
    expect(body<{ error: { kind: string } }>(response).error.kind).toBe(
      "browser_failed"
    )
    expect(existsSync(join(cacheDir, ".jevriel"))).toBe(false)
  })
})
