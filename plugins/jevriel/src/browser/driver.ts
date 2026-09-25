import { join } from "node:path"
import type { Browser, Page } from "playwright-core"
import { isHostAllowed } from "../api/http.js"
import type { Actionable, AriaNode } from "./snapshot.js"

export type PlannedAction = {
  kind: "click" | "fill" | "select"
  target: Actionable
  value?: string
}

export interface GoalDriver {
  observe(): Promise<{
    url: string
    title: string
    status: number | null
    snapshot: string
    nodes: AriaNode[]
    notes?: string[]
  }>
  act(action: PlannedAction): Promise<void>
  selectOptions(target: Actionable): Promise<string[] | null>
  blockedNavigation(): string | null
  screenshot(file: string): Promise<void>
  finish(evidenceDir: string | null): Promise<string[]>
}

export function navigationDecision(
  req: { isNavigationRequest(): boolean; frame(): unknown; url(): string },
  mainFrame: unknown,
  allowed: readonly string[]
): "abort" | "continue" {
  try {
    if (!req.isNavigationRequest()) return "continue"
    if (req.frame() !== mainFrame) return "continue"
    return isHostAllowed(new URL(req.url()).host, allowed)
      ? "continue"
      : "abort"
  } catch {
    return "abort"
  }
}

export function locatorArgs(target: Actionable): {
  role: string
  options: { name: string; exact: true; disabled: false }
  nth: number
} {
  return {
    role: target.role,
    options: { name: target.name, exact: true, disabled: false },
    nth: target.nth
  }
}

export async function createPlaywrightDriver(opts: {
  browser: Browser
  url: string
  allowedHosts: string[]
  stepTimeoutMs: number
  captureTrace: boolean
}): Promise<{ driver: GoalDriver; initialStatus: number | null }> {
  const context = await opts.browser.newContext({
    acceptDownloads: false,
    serviceWorkers: "block"
  })
  try {
    if (opts.captureTrace)
      await context.tracing.start({ screenshots: true, snapshots: true })
    const page = await context.newPage()
    page.setDefaultTimeout(opts.stepTimeoutMs)
    page.setDefaultNavigationTimeout(30000)
    let blocked: string | null = null
    let status: number | null = null
    let nodes: AriaNode[] = []
    const notes: string[] = []
    await page.route("**/*", async (route) => {
      const request = route.request()
      if (
        navigationDecision(request, page.mainFrame(), opts.allowedHosts) ===
        "abort"
      ) {
        blocked = request.url()
        await route.abort()
      } else await route.continue()
    })
    page.on("response", (response) => {
      try {
        if (
          response.request().isNavigationRequest() &&
          response.frame() === page.mainFrame()
        )
          status = response.status()
      } catch {
        /* Detached frames do not change the main page status. */
      }
    })
    page.on("dialog", (dialog) => {
      void dialog
        .dismiss()
        .then(() => {
          notes.push(`dialog dismissed: ${dialog.type()}`)
        })
        .catch(() => {})
    })
    context.on("page", (popup) => {
      if (popup !== page)
        void popup
          .close()
          .then(() => {
            notes.push("popup closed")
          })
          .catch(() => {})
    })
    // File chooser events need no handler: uploads are not supported.
    const response = await page.goto(opts.url, { waitUntil: "load" })
    status = response?.status() ?? null
    const locate = (target: Actionable) => {
      const { role, options, nth } = locatorArgs(target)
      return page
        .getByRole(role as Parameters<Page["getByRole"]>[0], options)
        .nth(nth)
    }
    const driver: GoalDriver = {
      async observe() {
        nodes = (await page.ariaSnapshotJSON()) as AriaNode[]
        const [title, snapshot] = await Promise.all([
          page.title(),
          page.ariaSnapshot()
        ])
        return {
          url: page.url(),
          title,
          status,
          snapshot,
          nodes,
          notes: notes.splice(0)
        }
      },
      async act(action) {
        const locator = locate(action.target)
        if (action.kind === "fill") await locator.fill(action.value ?? "")
        else if (action.kind === "select")
          await locator.selectOption({ label: action.value ?? "" })
        else await locator.click()
        try {
          await page.waitForLoadState("load", { timeout: opts.stepTimeoutMs })
        } catch (error) {
          if (!(error instanceof Error) || !/timeout/i.test(error.message))
            throw error
        }
      },
      async selectOptions(target) {
        if (target.role !== "combobox") return null
        if (
          (await locate(target).evaluate((element) => element.tagName)) !==
          "SELECT"
        )
          return null
        let count = 0
        const visit = (children: AriaNode[]): AriaNode | null => {
          for (const node of children) {
            if (node.ariaHidden) continue
            if (
              node.role === target.role &&
              node.name === target.name &&
              node.disabled !== true
            ) {
              if (count++ === target.nth) return node
            }
            const nested = visit(
              (node.children ?? []).filter(
                (child): child is AriaNode => typeof child !== "string"
              )
            )
            if (nested) return nested
          }
          return null
        }
        return (visit(nodes)?.children ?? [])
          .filter(
            (node): node is AriaNode =>
              typeof node !== "string" && node.role === "option" && !!node.name
          )
          .map((node) => node.name as string)
      },
      blockedNavigation() {
        if (blocked) return blocked
        const current = page.url()
        try {
          return isHostAllowed(new URL(current).host, opts.allowedHosts)
            ? null
            : current
        } catch {
          return current
        }
      },
      async screenshot(file) {
        await page.screenshot({ path: file, fullPage: true })
      },
      async finish(evidenceDir) {
        const files: string[] = []
        try {
          if (evidenceDir) {
            try {
              await page.screenshot({
                path: join(evidenceDir, "final.png"),
                fullPage: true
              })
              files.push("final.png")
            } finally {
              if (opts.captureTrace) {
                await context.tracing.stop({
                  path: join(evidenceDir, "trace.zip")
                })
                files.push("trace.zip")
              }
            }
          }
          return files
        } finally {
          await context.close()
        }
      }
    }
    return { driver, initialStatus: status }
  } catch (error) {
    await context.close().catch(() => {})
    throw error
  }
}
