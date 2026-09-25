import { vi } from "vitest"
import type { GoalDriver, PlannedAction } from "../../driver.js"
import type { AriaNode } from "../../snapshot.js"

export function fakeDriver(
  options: {
    nodes?: AriaNode[]
    url?: string
    snapshot?: string
    blocked?: string | null
    observeError?: Error
    actError?: Error
    notes?: string[][]
  } = {}
) {
  const url = options.url ?? "https://example.test/?token=private"
  const driver: GoalDriver = {
    observe: vi.fn(async () => {
      if (options.observeError) throw options.observeError
      return {
        url,
        title: "Example",
        status: 200,
        snapshot: options.snapshot ?? "- button Submit",
        nodes: options.nodes ?? [{ role: "button", name: "Submit" }],
        notes: options.notes?.shift() ?? []
      }
    }),
    act: vi.fn(async (_action: PlannedAction) => {
      if (options.actError) throw options.actError
    }),
    selectOptions: vi.fn(async () => null),
    blockedNavigation: vi.fn(() => options.blocked ?? null),
    screenshot: vi.fn(async (_file: string) => {}),
    finish: vi.fn(async (dir: string | null) =>
      dir ? ["final.png", "trace.zip"] : []
    )
  }
  return driver
}
