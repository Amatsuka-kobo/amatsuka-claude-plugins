import { spawn as nodeSpawn } from "node:child_process"
import { createRequire } from "node:module"
import { homedir } from "node:os"
import { join, sep } from "node:path"
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js"
import {
  defaultCacheDir,
  runBrowserSetup,
  type SpawnFn
} from "../browser/playwright.js"
import {
  errorResponse,
  type ToolDeps,
  type ToolResponse,
  toResponse
} from "./shared.js"

export type BrowserToolDeps = ToolDeps & {
  cacheDir: string
  spawn: SpawnFn
  platform: NodeJS.Platform
}

export function createBrowserToolDeps(base: ToolDeps): BrowserToolDeps {
  return {
    ...base,
    cacheDir: defaultCacheDir(homedir()),
    spawn: createSpawn(process.platform),
    platform: process.platform
  }
}

function boundedOutputTail(output: Buffer): string {
  let tail = output.toString("utf8")
  while (Buffer.byteLength(tail) > 2048) tail = tail.slice(1)
  return tail
}

function createSpawn(platform: NodeJS.Platform): SpawnFn {
  return (cmd, args, { cwd, timeoutMs }) =>
    new Promise((resolve, reject) => {
      let output = Buffer.alloc(0)
      let settled = false
      let timer: NodeJS.Timeout | undefined
      const child = nodeSpawn(cmd, args, {
        cwd,
        shell: platform === "win32",
        stdio: ["ignore", "pipe", "pipe"]
      })
      const append = (chunk: Buffer | string) => {
        const next = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk)
        output = Buffer.concat([output, next]).subarray(-2048)
      }
      const finish = (error?: Error, code: number | null = null) => {
        if (settled) return
        settled = true
        if (timer) clearTimeout(timer)
        if (error) reject(error)
        else resolve({ code, outputTail: boundedOutputTail(output) })
      }
      child.stdout?.on("data", append)
      child.stderr?.on("data", append)
      child.once("error", (error) => finish(error))
      child.once("close", (code) => finish(undefined, code))
      timer = setTimeout(() => {
        child.kill()
        finish(new Error(`${cmd} timed out after ${timeoutMs}ms`))
      }, timeoutMs)
    })
}

export const browserSetupInput = {}

export async function handleBrowserSetup(
  extra: { sendProgress?: (progress: number, total: number) => Promise<void> },
  deps: BrowserToolDeps
): Promise<ToolResponse> {
  const sendProgress = extra.sendProgress
  try {
    const result = await runBrowserSetup({
      cacheDir: deps.cacheDir,
      spawn: deps.spawn,
      platform: deps.platform,
      load: (cacheDir) => {
        try {
          const requireFromCache = createRequire(join(cacheDir, "package.json"))
          const modulesRoot = `${join(cacheDir, "node_modules")}${sep}`
          for (const modulePath of Object.keys(requireFromCache.cache)) {
            if (modulePath.startsWith(modulesRoot)) {
              delete requireFromCache.cache[modulePath]
            }
          }
          return requireFromCache(
            "playwright"
          ) as import("../browser/playwright.js").PlaywrightModule
        } catch {
          return null
        }
      },
      onProgress: sendProgress
        ? (step, phase) => {
            const progress = phase === "start" ? step - 1 : step
            void sendProgress(progress, 4).catch(() => {})
          }
        : undefined
    })
    return toResponse(result)
  } catch (error) {
    return errorResponse(
      "setup_failed",
      error instanceof Error ? error.message : String(error)
    )
  }
}

export function registerBrowserTools(
  server: McpServer,
  deps: BrowserToolDeps
): void {
  server.registerTool(
    "browser_setup",
    {
      description:
        "Install the pinned Playwright package and Chromium browser in the local cache.",
      inputSchema: browserSetupInput
    },
    (_args, extra) => {
      const progressToken = extra._meta?.progressToken
      return handleBrowserSetup(
        progressToken === undefined
          ? {}
          : {
              sendProgress: (progress, total) =>
                extra.sendNotification({
                  method: "notifications/progress",
                  params: { progressToken, progress, total }
                })
            },
        deps
      )
    }
  )
}
