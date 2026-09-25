import { readFileSync } from "node:fs"
import { mkdtemp, readFile, rm } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import type { Browser } from "playwright-core"
import { describe, expect, it, vi } from "vitest"
import {
  createPlaywrightDriver,
  locatorArgs,
  navigationDecision
} from "../driver.js"
import { type AriaNode, extractActionables } from "../snapshot.js"

function harness(trace = false) {
  const events: Record<string, (arg: unknown) => void> = {}
  const locator = {
    click: vi.fn(async () => {}),
    fill: vi.fn(async () => {}),
    selectOption: vi.fn(async () => {}),
    evaluate: vi.fn(async () => "BUTTON")
  }
  const nth = vi.fn(() => locator)
  const page = {
    goto: vi.fn(async () => ({ status: () => 200 })),
    title: vi.fn(async () => "Example"),
    url: vi.fn(() => "https://example.test/"),
    ariaSnapshot: vi.fn(async () => "- button Save"),
    ariaSnapshotJSON: vi.fn(async () => [{ role: "button", name: "Save" }]),
    screenshot: vi.fn(async ({ path }: { path: string }) => {
      await import("node:fs/promises").then((fs) => fs.writeFile(path, "png"))
    }),
    waitForLoadState: vi.fn(async () => {}),
    setDefaultTimeout: vi.fn(),
    setDefaultNavigationTimeout: vi.fn(),
    route: vi.fn(),
    on: vi.fn((name: string, callback: (arg: unknown) => void) => {
      events[name] = callback
    }),
    mainFrame: vi.fn(() => "main"),
    getByRole: vi.fn(() => ({ nth }))
  }
  const context = {
    newPage: vi.fn(async () => page),
    on: vi.fn((name: string, callback: (arg: unknown) => void) => {
      events[name] = callback
    }),
    close: vi.fn(async () => {}),
    tracing: {
      start: vi.fn(async () => {}),
      stop: vi.fn(async ({ path }: { path: string }) => {
        await import("node:fs/promises").then((fs) =>
          fs.writeFile(path, "trace")
        )
      })
    }
  }
  const browser = {
    newContext: vi.fn(async () => context)
  } as unknown as Browser
  const create = () =>
    createPlaywrightDriver({
      browser,
      url: "https://example.test/",
      allowedHosts: ["example.test"],
      stepTimeoutMs: 1000,
      captureTrace: trace
    })
  return { page, context, browser, events, locator, nth, create }
}

describe("browser driver", () => {
  it("aborts only disallowed main-frame navigation, including frame errors", () => {
    const main = {}
    const req = (url: string, navigation = true, frame = () => main) => ({
      url: () => url,
      isNavigationRequest: () => navigation,
      frame
    })
    expect(
      navigationDecision(req("https://elsewhere.test/"), main, ["example.test"])
    ).toBe("abort")
    expect(
      navigationDecision(
        req("https://elsewhere.test/", false, () => {
          throw new Error("detached")
        }),
        main,
        ["example.test"]
      )
    ).toBe("continue")
    expect(
      navigationDecision(
        req("https://elsewhere.test/", true, () => ({})),
        main,
        ["example.test"]
      )
    ).toBe("continue")
    expect(
      navigationDecision(req("https://example.test/"), main, ["example.test"])
    ).toBe("continue")
    expect(
      navigationDecision(
        req("https://example.test/", true, () => {
          throw new Error("detached")
        }),
        main,
        ["example.test"]
      )
    ).toBe("abort")
  })

  it("uses exact role/name and disabled-filtered nth from the duplicate fixture (F3)", async () => {
    const nodes = JSON.parse(
      readFileSync(
        new URL("../../fixtures/aria/duplicates.json", import.meta.url),
        "utf8"
      )
    ) as AriaNode[]
    const elements = extractActionables(nodes).actionables
    const target = elements.find((item) => item.nth === 1)
    expect(target).toBeDefined()
    if (!target) return
    expect(locatorArgs(target)).toEqual({
      role: target.role,
      options: { name: target.name, exact: true, disabled: false },
      nth: 1
    })
    const h = harness()
    const { driver } = await h.create()
    await driver.act({ kind: "click", target })
    expect(h.page.getByRole).toHaveBeenCalledWith(target.role, {
      name: target.name,
      exact: true,
      disabled: false
    })
    expect(h.nth).toHaveBeenCalledWith(1)
  })

  it("configures context, route, timeouts and popup/dialog safety without a trace", async () => {
    const h = harness()
    const { driver, initialStatus } = await h.create()
    expect(initialStatus).toBe(200)
    expect(h.browser.newContext).toHaveBeenCalledWith({
      acceptDownloads: false,
      serviceWorkers: "block"
    })
    expect(h.context.tracing.start).not.toHaveBeenCalled()
    expect(h.page.setDefaultTimeout).toHaveBeenCalledWith(1000)
    expect(h.page.setDefaultNavigationTimeout).toHaveBeenCalledWith(30000)
    expect(h.page.route).toHaveBeenCalledWith("**/*", expect.any(Function))
    const dismiss = vi.fn(async () => {})
    h.events.dialog({ dismiss })
    const close = vi.fn(async () => {})
    h.events.page({ close })
    await vi.waitFor(() => expect(dismiss).toHaveBeenCalledOnce())
    await vi.waitFor(() => expect(close).toHaveBeenCalledOnce())
    const handler = h.page.route.mock.calls[0][1] as (
      route: unknown
    ) => Promise<void>
    const abort = vi.fn(async () => {}),
      forward = vi.fn(async () => {})
    await handler({
      request: () => ({
        isNavigationRequest: () => false,
        frame: () => "main",
        url: () => "https://elsewhere.test/"
      }),
      abort,
      continue: forward
    })
    expect(forward).toHaveBeenCalledOnce()
    expect(abort).not.toHaveBeenCalled()
    expect(await driver.finish(null)).toEqual([])
    expect(h.context.close).toHaveBeenCalledOnce()
    expect(h.page.screenshot).not.toHaveBeenCalled()
  })

  it("records the final screenshot and trace when evidence is enabled", async () => {
    const dir = await mkdtemp(join(tmpdir(), "jevriel-driver-test-"))
    try {
      const h = harness(true)
      const { driver } = await h.create()
      expect(h.context.tracing.start).toHaveBeenCalledWith({
        screenshots: true,
        snapshots: true
      })
      expect(await driver.finish(dir)).toEqual(["final.png", "trace.zip"])
      expect(await readFile(join(dir, "final.png"), "utf8")).toBe("png")
      expect(await readFile(join(dir, "trace.zip"), "utf8")).toBe("trace")
      expect(h.context.close).toHaveBeenCalledOnce()
    } finally {
      await rm(dir, { recursive: true, force: true })
    }
  })
})

describe("browser navigation and selection", () => {
  it("marks blocked main-frame requests and post-navigation redirects, but not subresources", async () => {
    const h = harness()
    const { driver } = await h.create()
    const route = h.page.route.mock.calls[0][1] as (
      route: unknown
    ) => Promise<void>
    const abort = vi.fn(async () => {}),
      forward = vi.fn(async () => {})
    const req = (url: string, navigation = true) => ({
      request: () => ({
        url: () => url,
        isNavigationRequest: () => navigation,
        frame: () => "main"
      }),
      abort,
      continue: forward
    })
    await route(req("https://outside.test/image", false))
    expect(driver.blockedNavigation()).toBeNull()
    await route(req("https://outside.test/page"))
    expect(abort).toHaveBeenCalledOnce()
    expect(driver.blockedNavigation()).toBe("https://outside.test/page")
    const later = harness()
    const live = await later.create()
    later.page.url.mockImplementation(() => "https://outside.test/redirected")
    expect(live.driver.blockedNavigation()).toBe(
      "https://outside.test/redirected"
    )
    await driver.finish(null)
    await live.driver.finish(null)
  })

  it("reads options only from the chosen native select", async () => {
    const h = harness()
    h.page.ariaSnapshotJSON.mockImplementation(async () => [
      {
        role: "combobox",
        name: "Color",
        children: [
          { role: "option", name: "Red" },
          { role: "option", name: "Blue" }
        ]
      }
    ])
    const { driver } = await h.create()
    await driver.observe()
    h.locator.evaluate.mockResolvedValueOnce("SELECT")
    expect(
      await driver.selectOptions({
        id: "a1",
        role: "combobox",
        name: "Color",
        nth: 0
      })
    ).toEqual(["Red", "Blue"])
    h.locator.evaluate.mockResolvedValueOnce("INPUT")
    expect(
      await driver.selectOptions({
        id: "a1",
        role: "combobox",
        name: "Color",
        nth: 0
      })
    ).toBeNull()
    await driver.finish(null)
  })
})

describe("browser interruption notes", () => {
  it("returns dismissed dialog types and closed popup once, without dialog text", async () => {
    const h = harness()
    const { driver } = await h.create()
    expect((await driver.observe()).notes).toEqual([])
    const dismiss = vi.fn(async () => {})
    const close = vi.fn(async () => {})
    h.events.dialog({
      type: () => "confirm",
      message: () => "untrusted page content",
      dismiss
    })
    h.events.page({ close })
    await vi.waitFor(() => expect(dismiss).toHaveBeenCalledOnce())
    await vi.waitFor(() => expect(close).toHaveBeenCalledOnce())
    const first = await driver.observe()
    expect(first.notes).toEqual(["dialog dismissed: confirm", "popup closed"])
    expect(JSON.stringify(first.notes)).not.toContain("untrusted page content")
    expect((await driver.observe()).notes).toEqual([])
    await driver.finish(null)
  })
})
