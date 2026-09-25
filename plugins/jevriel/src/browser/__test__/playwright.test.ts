import { existsSync } from "node:fs"
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises"
import { createRequire } from "node:module"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { afterEach, describe, expect, it, vi } from "vitest"
import {
  BrowserLaunchError,
  defaultCacheDir,
  launchChromium,
  MIN_PLAYWRIGHT_VERSION,
  PLAYWRIGHT_RANGE,
  PlaywrightMissingError,
  type PlaywrightModule,
  resolvePlaywright,
  runBrowserSetup,
  type SpawnFn
} from "../playwright.js"

const tempDirs: string[] = []

async function tempDir(): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), "jevriel-playwright-test-"))
  tempDirs.push(dir)
  return dir
}

async function writePlaywright(
  root: string,
  version: string,
  executablePath = join(root, "chromium"),
  launchBody = "return { close: async () => {} }"
): Promise<void> {
  const packageDir = join(root, "node_modules", "playwright")
  await mkdir(packageDir, { recursive: true })
  await writeFile(
    join(packageDir, "package.json"),
    JSON.stringify({ name: "playwright", version, main: "index.cjs" })
  )
  await writeFile(
    join(packageDir, "index.cjs"),
    `module.exports = { chromium: { executablePath: () => ${JSON.stringify(executablePath)}, launch: async () => { ${launchBody} } } }`
  )
}

function loadFromCache(cacheDir: string): PlaywrightModule | null {
  try {
    return createRequire(join(cacheDir, "package.json"))(
      "playwright"
    ) as PlaywrightModule
  } catch {
    return null
  }
}

function setupDeps(
  cacheDir: string,
  spawn: SpawnFn = vi.fn(async () => ({ code: 0, outputTail: "" })),
  platform: NodeJS.Platform = "linux"
) {
  return { cacheDir, spawn, platform, load: loadFromCache }
}

afterEach(async () => {
  await Promise.all(
    tempDirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true }))
  )
})

describe("Playwright resolution", () => {
  it("uses the documented range and cache path", () => {
    expect(PLAYWRIGHT_RANGE).toBe("~1.63.0")
    expect(MIN_PLAYWRIGHT_VERSION).toBe("1.63.0")
    expect(defaultCacheDir("/home/user")).toBe("/home/user/.cache/jevriel")
  })

  it.each([
    "1.63.0",
    "1.70.0"
  ])("accepts project Playwright %s without an upper bound", async (version) => {
    const projectDir = await tempDir()
    await writePlaywright(projectDir, version)

    const result = resolvePlaywright({
      projectDir,
      cacheDir: join(projectDir, "cache")
    })

    expect(result.ok).toBe(true)
    if (result.ok) {
      expect(result.candidates[0]).toMatchObject({ source: "project", version })
    }
  })

  it("falls back to cache when project Playwright is older than 1.63.0", async () => {
    const projectDir = await tempDir()
    const cacheDir = join(projectDir, "cache")
    await writePlaywright(projectDir, "1.62.9")
    await writePlaywright(cacheDir, "1.63.4")

    const result = resolvePlaywright({ projectDir, cacheDir })

    expect(result).toMatchObject({
      ok: true,
      candidates: [{ source: "cache", version: "1.63.4" }]
    })
  })

  it("reads the current package version after an in-process install updates it", async () => {
    const projectDir = await tempDir()
    const cacheDir = await tempDir()
    await writePlaywright(projectDir, "1.62.9")
    const requireFromProject = createRequire(join(projectDir, "package.json"))
    expect(
      (requireFromProject("playwright/package.json") as { version: string })
        .version
    ).toBe("1.62.9")

    await writePlaywright(projectDir, "1.63.7")

    expect(resolvePlaywright({ projectDir, cacheDir })).toMatchObject({
      ok: true,
      candidates: [{ source: "project", version: "1.63.7" }]
    })
  })

  it("reports an old project version when cache Playwright is missing", async () => {
    const projectDir = await tempDir()
    const cacheDir = await tempDir()
    await writePlaywright(projectDir, "1.62.9")

    expect(resolvePlaywright({ projectDir, cacheDir })).toEqual({
      ok: false,
      reason: "project_too_old",
      projectVersion: "1.62.9"
    })
  })

  it("reports missing when neither project nor cache has Playwright", async () => {
    const projectDir = await tempDir()

    expect(
      resolvePlaywright({ projectDir, cacheDir: join(projectDir, "cache") })
    ).toEqual({ ok: false, reason: "missing" })
  })

  it("retries once with cache when project launch reports a missing executable", async () => {
    const projectDir = await tempDir()
    const cacheDir = join(projectDir, "cache")
    await writePlaywright(
      projectDir,
      "1.63.1",
      join(projectDir, "missing-browser"),
      'throw new Error("Executable doesn\'t exist at /missing/chromium")'
    )
    await writePlaywright(cacheDir, "1.63.2")
    await writeFile(join(cacheDir, "chromium"), "")

    const result = await launchChromium({ projectDir, cacheDir })

    expect(result.source).toBe("cache")
    await result.browser.close()
  })

  it("does not retry cache after a non-executable launch failure", async () => {
    const projectDir = await tempDir()
    const cacheDir = join(projectDir, "cache")
    await writePlaywright(
      projectDir,
      "1.63.1",
      join(projectDir, "chromium"),
      'throw new Error("sandbox initialization failed")'
    )
    await writePlaywright(cacheDir, "1.63.2")

    await expect(
      launchChromium({ projectDir, cacheDir })
    ).rejects.toBeInstanceOf(BrowserLaunchError)
  })

  it("raises PlaywrightMissingError when no candidate can be resolved", async () => {
    const projectDir = await tempDir()

    await expect(
      launchChromium({ projectDir, cacheDir: join(projectDir, "cache") })
    ).rejects.toMatchObject({
      constructor: PlaywrightMissingError,
      reason: "missing"
    })
  })
})

describe("runBrowserSetup", () => {
  it("ignores a browser close failure after launch succeeds", async () => {
    const cacheDir = await tempDir()
    const executablePath = join(cacheDir, "chromium")
    await writePlaywright(
      cacheDir,
      "1.63.2",
      executablePath,
      'return { close: async () => { throw new Error("close failed") } }'
    )
    await writeFile(executablePath, "")

    await expect(
      runBrowserSetup({
        ...setupDeps(cacheDir),
        onProgress: vi.fn()
      })
    ).resolves.toMatchObject({ status: "already_installed" })
  })

  it("skips install when 1.63 Playwright and its browser executable exist", async () => {
    const cacheDir = await tempDir()
    const executablePath = join(cacheDir, "chromium")
    await writePlaywright(cacheDir, "1.63.2", executablePath)
    await writeFile(executablePath, "")
    const spawn = vi.fn<SpawnFn>()
    const onProgress = vi.fn()

    const result = await runBrowserSetup({
      ...setupDeps(cacheDir, spawn),
      onProgress
    })

    expect(result).toMatchObject({
      status: "already_installed",
      playwrightVersion: "1.63.2",
      source: "cache",
      cacheDir,
      steps: [
        { step: "npm_install", ran: false },
        { step: "browser_install", ran: false }
      ]
    })
    expect(spawn).not.toHaveBeenCalled()
    expect(onProgress.mock.calls).toEqual(
      [1, 2, 3, 4].flatMap((step) => [
        [step, "start"],
        [step, "end"]
      ])
    )
  })

  it("installs the pinned package in cache and uses five-minute timeout", async () => {
    const cacheDir = await tempDir()
    const executablePath = join(cacheDir, "chromium")
    const spawn = vi.fn<SpawnFn>(async (_cmd, _args, _options) => {
      await writePlaywright(cacheDir, "1.63.0", executablePath)
      await writeFile(executablePath, "")
      return { code: 0, outputTail: "n".repeat(3000) }
    })

    const result = await runBrowserSetup({
      ...setupDeps(cacheDir, spawn),
      onProgress: vi.fn()
    })

    expect(spawn).toHaveBeenCalledWith(
      "npm",
      ["install", "playwright@~1.63.0", "--no-audit", "--no-fund"],
      { cwd: cacheDir, timeoutMs: 5 * 60 * 1000 }
    )
    expect(result.status).toBe("installed")
    expect(result.steps[0].outputTail?.length).toBeLessThanOrEqual(2048)
    expect(result.steps[0].outputTail?.endsWith("n".repeat(20))).toBe(true)
  })

  it("installs Chromium when the executable is missing with a ten-minute timeout", async () => {
    const cacheDir = await tempDir()
    const executablePath = join(cacheDir, "chromium")
    await writePlaywright(cacheDir, "1.63.3", executablePath)
    const spawn = vi.fn<SpawnFn>(async (_cmd, _args, options) => {
      expect(options.timeoutMs).toBe(10 * 60 * 1000)
      await writeFile(executablePath, "")
      return { code: 0, outputTail: "browser installed" }
    })

    const result = await runBrowserSetup({
      ...setupDeps(cacheDir, spawn),
      onProgress: vi.fn()
    })

    expect(spawn).toHaveBeenCalledWith(
      "npx",
      ["playwright", "install", "chromium"],
      { cwd: cacheDir, timeoutMs: 10 * 60 * 1000 }
    )
    expect(result.status).toBe("installed")
    expect(result.steps[1]).toMatchObject({
      step: "browser_install",
      ran: true
    })
  })

  it("uses npm.cmd and npx.cmd on Windows", async () => {
    const cacheDir = await tempDir()
    const executablePath = join(cacheDir, "chromium")
    const spawn = vi.fn<SpawnFn>(async (cmd, _args, options) => {
      if (cmd === "npm.cmd") {
        await writePlaywright(cacheDir, "1.63.1", executablePath)
      } else {
        await writeFile(executablePath, "")
      }
      expect(options.cwd).toBe(cacheDir)
      return { code: 0, outputTail: "" }
    })

    const result = await runBrowserSetup({
      ...setupDeps(cacheDir, spawn, "win32"),
      onProgress: vi.fn()
    })

    expect(spawn.mock.calls.map(([cmd]) => cmd)).toEqual(["npm.cmd", "npx.cmd"])
    expect(result.status).toBe("installed")
  })

  it("fails setup when npm cannot be spawned", async () => {
    const cacheDir = await tempDir()
    const spawn = vi.fn<SpawnFn>(async () => {
      throw new Error("spawn npm ENOENT")
    })

    await expect(
      runBrowserSetup({ ...setupDeps(cacheDir, spawn), onProgress: vi.fn() })
    ).rejects.toThrow(/spawn npm ENOENT/)
  })

  it("includes Linux install-deps guidance when Chromium launch fails", async () => {
    const cacheDir = await tempDir()
    const executablePath = join(cacheDir, "chromium")
    await writePlaywright(
      cacheDir,
      "1.63.2",
      executablePath,
      'throw new Error("missing shared library")'
    )
    await writeFile(executablePath, "")

    await expect(
      runBrowserSetup({
        ...setupDeps(cacheDir),
        onProgress: vi.fn()
      })
    ).rejects.toThrow(/sudo npx playwright install-deps chromium/)
  })

  it("shares one in-flight promise between concurrent calls", async () => {
    const cacheDir = await tempDir()
    const executablePath = join(cacheDir, "chromium")
    await writePlaywright(cacheDir, "1.63.2", executablePath)
    let finishSpawn: (() => void) | undefined
    const spawn = vi.fn<SpawnFn>(
      () =>
        new Promise((resolve) => {
          finishSpawn = () => {
            void writeFile(executablePath, "").then(() =>
              resolve({ code: 0, outputTail: "" })
            )
          }
        })
    )

    const first = runBrowserSetup({
      ...setupDeps(cacheDir, spawn),
      onProgress: vi.fn()
    })
    await vi.waitFor(() => expect(spawn).toHaveBeenCalledOnce())
    const second = runBrowserSetup({
      ...setupDeps(cacheDir, spawn),
      onProgress: vi.fn()
    })

    expect(second).toBe(first)
    finishSpawn?.()
    await Promise.all([first, second])
    expect(spawn).toHaveBeenCalledOnce()
  })

  it("ensures cache package metadata exists and records only bounded tails", async () => {
    const cacheDir = await tempDir()
    const executablePath = join(cacheDir, "chromium")
    const spawn = vi.fn<SpawnFn>(async () => {
      await writePlaywright(cacheDir, "1.63.2", executablePath)
      await writeFile(executablePath, "")
      return { code: 0, outputTail: `a${"é".repeat(1500)}` }
    })

    const result = await runBrowserSetup({
      ...setupDeps(cacheDir, spawn),
      onProgress: vi.fn()
    })

    expect(
      JSON.parse(await readFile(join(cacheDir, "package.json"), "utf8"))
    ).toEqual({
      private: true
    })
    expect(
      Buffer.byteLength(result.steps[0].outputTail ?? "")
    ).toBeLessThanOrEqual(2048)
    expect(existsSync(executablePath)).toBe(true)
  })
})
