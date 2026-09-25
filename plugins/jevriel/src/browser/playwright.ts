import { existsSync, readFileSync } from "node:fs"
import { mkdir, writeFile } from "node:fs/promises"
import { createRequire } from "node:module"
import { join } from "node:path"

export const PLAYWRIGHT_RANGE = "~1.63.0"
export const MIN_PLAYWRIGHT_VERSION = "1.63.0"

export type PlaywrightModule = typeof import("playwright-core")
export type PlaywrightCandidate = {
  source: "project" | "cache"
  version: string
  load: () => PlaywrightModule
}

export type SpawnFn = (
  cmd: string,
  args: string[],
  opts: { cwd: string; timeoutMs: number }
) => Promise<{ code: number | null; outputTail: string }>

export type BrowserSetupResult = {
  status: "installed" | "already_installed"
  playwrightVersion: string
  source: "cache"
  cacheDir: string
  steps: Array<{
    step: "npm_install" | "browser_install"
    ran: boolean
    durationMs?: number
    outputTail?: string
  }>
  hint?: string
}

export class PlaywrightMissingError extends Error {
  readonly reason: "missing" | "project_too_old"

  constructor(reason: "missing" | "project_too_old", projectVersion?: string) {
    super(
      reason === "project_too_old"
        ? `Project Playwright ${projectVersion ?? ""} is too old. Install Playwright ${PLAYWRIGHT_RANGE} with browser_setup or update the project dependency.`
        : `Playwright was not found. Run browser_setup to install it in the cache.`
    )
    this.name = "PlaywrightMissingError"
    this.reason = reason
  }
}

export class BrowserLaunchError extends Error {
  constructor(message: string) {
    super(message)
    this.name = "BrowserLaunchError"
  }
}

function packageAt(
  root: string
): { version: string; load: () => PlaywrightModule } | undefined {
  try {
    const requireFromRoot = createRequire(join(root, "package.json"))
    requireFromRoot.resolve("playwright")
    const metadataPath = requireFromRoot.resolve("playwright/package.json")
    const metadata = JSON.parse(readFileSync(metadataPath, "utf8")) as {
      version?: unknown
    }
    if (typeof metadata.version !== "string") return undefined
    return {
      version: metadata.version,
      load: () => requireFromRoot("playwright") as PlaywrightModule
    }
  } catch {
    return undefined
  }
}

function isAtLeastMinimum(version: string): boolean {
  const match =
    /^(\d+)\.(\d+)\.(\d+)(?:-([0-9A-Za-z.-]+))?(?:\+[0-9A-Za-z.-]+)?$/.exec(
      version
    )
  if (!match) return false
  const [major, minor, patch] = match.slice(1, 4).map(Number)
  if (major !== 1) return major > 1
  if (minor !== 63) return minor > 63
  if (patch !== 0) return patch > 0
  return match[4] === undefined
}

function isPinnedVersion(version: string): boolean {
  return /^1\.63\.\d+$/.test(version)
}

export function defaultCacheDir(home: string): string {
  return join(home, ".cache", "jevriel")
}

export function resolvePlaywright(opts: {
  projectDir: string
  cacheDir: string
}):
  | { ok: true; candidates: PlaywrightCandidate[] }
  | {
      ok: false
      reason: "missing" | "project_too_old"
      projectVersion?: string
    } {
  const candidates: PlaywrightCandidate[] = []
  const project = packageAt(opts.projectDir)
  const projectTooOld =
    project !== undefined && !isAtLeastMinimum(project.version)
  if (project && !projectTooOld) {
    candidates.push({ source: "project", ...project })
  }
  const cache = packageAt(opts.cacheDir)
  if (cache) candidates.push({ source: "cache", ...cache })
  if (candidates.length > 0) return { ok: true, candidates }
  if (projectTooOld && project) {
    return {
      ok: false,
      reason: "project_too_old",
      projectVersion: project.version
    }
  }
  return { ok: false, reason: "missing" }
}

function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

function isExecutableMissing(error: unknown): boolean {
  return /executable (?:doesn't|does not) exist|executable (?:is )?missing|browser executable.*(?:not found|missing|does not exist)/i.test(
    messageOf(error)
  )
}

export async function launchChromium(opts: {
  projectDir: string
  cacheDir: string
}): Promise<{
  browser: import("playwright-core").Browser
  source: "project" | "cache"
}> {
  const result = resolvePlaywright(opts)
  if (!result.ok) {
    throw new PlaywrightMissingError(result.reason, result.projectVersion)
  }

  for (const candidate of result.candidates) {
    try {
      const browser = await candidate.load().chromium.launch()
      return { browser, source: candidate.source }
    } catch (error) {
      if (candidate.source === "project" && isExecutableMissing(error)) continue
      const hint = " Run browser_setup to install Chromium in the cache."
      throw new BrowserLaunchError(`${messageOf(error)}${hint}`)
    }
  }
  throw new BrowserLaunchError(
    "The project browser executable is missing. Run browser_setup to install Chromium in the cache."
  )
}

let activeSetup: Promise<BrowserSetupResult> | undefined

function trimOutputTail(outputTail: string): string {
  let tail = Buffer.from(outputTail).subarray(-2048).toString("utf8")
  while (Buffer.byteLength(tail) > 2048) tail = tail.slice(1)
  return tail
}

function setupError(error: unknown, outputTail?: string): Error {
  const detail = messageOf(error).split(/\r?\n/, 1)[0]
  const output = outputTail ? `\n${trimOutputTail(outputTail)}` : ""
  return new Error(`Browser setup failed: ${detail}${output}`)
}

async function runBrowserSetupOnce(deps: {
  cacheDir: string
  spawn: SpawnFn
  platform: NodeJS.Platform
  load: (cacheDir: string) => PlaywrightModule | null
  onProgress?: (step: number, phase: "start" | "end") => void
}): Promise<BrowserSetupResult> {
  const notify = (step: number, phase: "start" | "end") => {
    try {
      deps.onProgress?.(step, phase)
    } catch {
      // Progress reporting should not prevent package setup.
    }
  }
  const withProgress = async <T>(
    step: number,
    run: () => Promise<T>
  ): Promise<T> => {
    notify(step, "start")
    try {
      return await run()
    } finally {
      notify(step, "end")
    }
  }
  const runInstall = async (
    step: "npm_install" | "browser_install",
    cmd: string,
    args: string[],
    timeoutMs: number
  ): Promise<BrowserSetupResult["steps"][number]> => {
    const startedAt = Date.now()
    let result: { code: number | null; outputTail: string }
    try {
      result = await deps.spawn(cmd, args, { cwd: deps.cacheDir, timeoutMs })
    } catch (error) {
      throw setupError(error)
    }
    const outputTail = trimOutputTail(result.outputTail)
    if (result.code !== 0) {
      throw setupError(
        new Error(
          result.code === null
            ? `${cmd} was terminated before it completed.`
            : `${cmd} exited with code ${result.code}.`
        ),
        outputTail
      )
    }
    return {
      step,
      ran: true,
      durationMs: Date.now() - startedAt,
      ...(outputTail ? { outputTail } : {})
    }
  }

  const cacheVersion = () => packageAt(deps.cacheDir)?.version
  const steps: BrowserSetupResult["steps"] = []
  await withProgress(1, async () => {
    await mkdir(deps.cacheDir, { recursive: true })
    const packageJson = join(deps.cacheDir, "package.json")
    if (!existsSync(packageJson)) {
      await writeFile(packageJson, JSON.stringify({ private: true }))
    }
  })

  let version: string | undefined
  await withProgress(2, async () => {
    version = cacheVersion()
    if (!version || !isPinnedVersion(version)) {
      const command = deps.platform === "win32" ? "npm.cmd" : "npm"
      steps.push(
        await runInstall(
          "npm_install",
          command,
          [
            "install",
            `playwright@${PLAYWRIGHT_RANGE}`,
            "--no-audit",
            "--no-fund"
          ],
          5 * 60 * 1000
        )
      )
      version = cacheVersion()
    } else {
      steps.push({ step: "npm_install", ran: false })
    }
    if (!version || !isPinnedVersion(version)) {
      throw setupError(
        new Error(
          "Playwright ~1.63.0 was not found in the cache after installation."
        )
      )
    }
  })

  let playwright: PlaywrightModule | null = null
  let executablePath = ""
  await withProgress(3, async () => {
    try {
      playwright = deps.load(deps.cacheDir)
      if (!playwright)
        throw new Error("Playwright could not be loaded from the cache.")
      executablePath = playwright.chromium.executablePath()
    } catch (error) {
      throw setupError(error)
    }
    if (!existsSync(executablePath)) {
      const command = deps.platform === "win32" ? "npx.cmd" : "npx"
      steps.push(
        await runInstall(
          "browser_install",
          command,
          ["playwright", "install", "chromium"],
          10 * 60 * 1000
        )
      )
    } else {
      steps.push({ step: "browser_install", ran: false })
    }
  })

  await withProgress(4, async () => {
    let browser:
      | Awaited<ReturnType<PlaywrightModule["chromium"]["launch"]>>
      | undefined
    try {
      browser = await playwright?.chromium.launch()
      if (!browser)
        throw new Error("Playwright could not be loaded from the cache.")
    } catch (error) {
      const firstLine = messageOf(error).split(/\r?\n/, 1)[0]
      const hint =
        deps.platform === "linux"
          ? " On Linux, run `sudo npx playwright install-deps chromium` manually if system libraries are missing."
          : ""
      throw setupError(
        new Error(`Chromium launch failed: ${firstLine}.${hint}`)
      )
    } finally {
      try {
        await browser?.close()
      } catch {
        // A successful launch verifies setup even if cleanup fails.
      }
    }
  })

  return {
    status: steps.some((step) => step.ran) ? "installed" : "already_installed",
    playwrightVersion: version as string,
    source: "cache",
    cacheDir: deps.cacheDir,
    steps
  }
}

export function runBrowserSetup(deps: {
  cacheDir: string
  spawn: SpawnFn
  platform: NodeJS.Platform
  load: (cacheDir: string) => PlaywrightModule | null
  onProgress?: (step: number, phase: "start" | "end") => void
}): Promise<BrowserSetupResult> {
  if (activeSetup) return activeSetup
  const current = runBrowserSetupOnce(deps).finally(() => {
    if (activeSetup === current) activeSetup = undefined
  })
  activeSetup = current
  return current
}
