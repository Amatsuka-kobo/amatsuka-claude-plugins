import { describe, expect, test } from "vitest"
import {
  buildMatchTarget,
  matchAntibodies,
  renderAntibodyContext,
  selectAntibodies
} from "../match-antibody.js"
import type { Antibody } from "../types.js"

const PROJECT_DIR = "/workspace/project"
const NOW = new Date("2026-07-24T12:00:00.000Z")

function antibody(id: string, overrides: Partial<Antibody> = {}): Antibody {
  return {
    id,
    created: "2026-07-20",
    source: "test",
    trigger: { event: "PreToolUse", tool: "Bash", pattern: "needle" },
    status: "active",
    stats: { fired: 0, last_fired: null },
    expires: "2026-08-01",
    body: `Advice for ${id}`,
    ...overrides
  }
}

describe("tool input target", () => {
  test("uses command for Bash and ignores other input fields", () => {
    const target = buildMatchTarget(
      "Bash",
      { command: "git status", content: "needle", file_path: "/outside/file" },
      PROJECT_DIR
    )

    expect(target).toEqual({ tool: "Bash", text: "git status", path: null })
  })

  test("joins Edit old_string and new_string with a newline", () => {
    const target = buildMatchTarget(
      "Edit",
      { old_string: "before", new_string: "after", file_path: "src/main.ts" },
      PROJECT_DIR
    )

    expect(target).toEqual({
      tool: "Edit",
      text: "before\nafter",
      path: "src/main.ts"
    })
  })

  test("uses content for Write", () => {
    const target = buildMatchTarget(
      "Write",
      { content: "written body", file_path: "/workspace/project/README.md" },
      PROJECT_DIR
    )

    expect(target).toEqual({
      tool: "Write",
      text: "written body",
      path: "README.md"
    })
  })

  test("limits pattern input to 20,000 characters", () => {
    const target = buildMatchTarget(
      "Write",
      { content: `${"a".repeat(20_000)}needle`, file_path: "note.md" },
      PROJECT_DIR
    )

    expect(target.text).toHaveLength(20_000)
    expect(target.text).not.toContain("needle")
  })
})

describe("scope glob matching", () => {
  test("matches anchored glob paths, including zero directories for **/", () => {
    const scoped = antibody("ab-2026-0720-001", {
      trigger: {
        event: "PreToolUse",
        tool: "Write",
        pattern: "needle",
        scope: "src/**/*.ts"
      }
    })

    for (const filePath of ["src/main.ts", "src/lib/main.ts"]) {
      const target = buildMatchTarget(
        "Write",
        { content: "needle", file_path: filePath },
        PROJECT_DIR
      )
      expect(matchAntibodies([scoped], target, { now: NOW }).selected).toEqual([
        scoped
      ])
    }

    const missed = buildMatchTarget(
      "Write",
      { content: "needle", file_path: "src/main.js" },
      PROJECT_DIR
    )
    expect(matchAntibodies([scoped], missed, { now: NOW }).selected).toEqual([])
  })

  test("does not let * cross path segments and supports ?", () => {
    const scoped = antibody("ab-2026-0720-002", {
      trigger: {
        event: "PreToolUse",
        tool: "Edit",
        pattern: "needle",
        scope: "docs/?.md"
      }
    })

    const matching = buildMatchTarget(
      "Edit",
      { old_string: "needle", file_path: "docs/a.md" },
      PROJECT_DIR
    )
    const nested = buildMatchTarget(
      "Edit",
      { old_string: "needle", file_path: "docs/archive/a.md" },
      PROJECT_DIR
    )

    expect(matchAntibodies([scoped], matching, { now: NOW }).selected).toEqual([
      scoped
    ])
    expect(matchAntibodies([scoped], nested, { now: NOW }).selected).toEqual([])
  })

  test("ignores scope for Bash", () => {
    const scoped = antibody("ab-2026-0720-003", {
      trigger: {
        event: "PreToolUse",
        tool: "Bash",
        pattern: "npm test",
        scope: "src/**/*.ts"
      }
    })
    const target = buildMatchTarget(
      "Bash",
      { command: "npm test" },
      PROJECT_DIR
    )

    expect(matchAntibodies([scoped], target, { now: NOW }).selected).toEqual([
      scoped
    ])
  })

  test("does not match scoped Edit or Write files outside the project", () => {
    const scoped = antibody("ab-2026-0720-004", {
      trigger: {
        event: "PreToolUse",
        tool: "Write",
        pattern: "needle",
        scope: "src/**"
      }
    })
    const target = buildMatchTarget(
      "Write",
      { content: "needle", file_path: "/workspace/other/src/main.ts" },
      PROJECT_DIR
    )

    expect(target.path).toBeNull()
    expect(matchAntibodies([scoped], target, { now: NOW }).selected).toEqual([])
  })
})

describe("status, expiry, and trigger selection", () => {
  test("selects wildcard tool triggers for Bash, Edit, and Write", () => {
    const wildcard = antibody("ab-2026-0720-010", {
      trigger: { event: "PreToolUse", tool: "*", pattern: "needle" }
    })

    const targets = [
      buildMatchTarget("Bash", { command: "needle" }, PROJECT_DIR),
      buildMatchTarget("Edit", { old_string: "needle" }, PROJECT_DIR),
      buildMatchTarget("Write", { content: "needle" }, PROJECT_DIR)
    ]

    for (const target of targets) {
      expect(
        matchAntibodies([wildcard], target, { now: NOW }).selected
      ).toEqual([wildcard])
    }
  })

  test("returns expired active IDs without evaluating them, while confirmed ignores expiry", () => {
    const expiredActive = antibody("ab-2026-0720-011", {
      expires: "2026-07-23"
    })
    const confirmed = antibody("ab-2026-0720-012", {
      status: "confirmed",
      expires: "2026-07-01"
    })
    const alreadyExpired = antibody("ab-2026-0720-013", {
      status: "expired",
      expires: "2026-07-01"
    })
    const target = buildMatchTarget("Bash", { command: "needle" }, PROJECT_DIR)

    expect(
      matchAntibodies([expiredActive, confirmed, alreadyExpired], target, {
        now: NOW
      })
    ).toEqual({
      expiredActiveIds: [expiredActive.id],
      selected: [confirmed]
    })
  })

  test("does not expire an active antibody on its UTC expiry date", () => {
    const active = antibody("ab-2026-0720-014", { expires: "2026-07-24" })
    const target = buildMatchTarget("Bash", { command: "needle" }, PROJECT_DIR)

    expect(matchAntibodies([active], target, { now: NOW })).toEqual({
      expiredActiveIds: [],
      selected: [active]
    })
  })

  test("sorts by last_fired descending, created descending, then id ascending and limits to three", () => {
    const values = [
      antibody("ab-2026-0720-030", {
        created: "2026-07-20",
        stats: { fired: 1, last_fired: null }
      }),
      antibody("ab-2026-0720-021", {
        created: "2026-07-20",
        stats: { fired: 1, last_fired: "2026-07-23" }
      }),
      antibody("ab-2026-0720-020", {
        created: "2026-07-20",
        stats: { fired: 1, last_fired: "2026-07-23" }
      }),
      antibody("ab-2026-0720-040", {
        created: "2026-07-22",
        stats: { fired: 1, last_fired: "2026-07-22" }
      }),
      antibody("ab-2026-0720-050", {
        created: "2026-07-21",
        stats: { fired: 1, last_fired: null }
      })
    ]
    const target = buildMatchTarget("Bash", { command: "needle" }, PROJECT_DIR)

    expect(
      matchAntibodies(values, target, { now: NOW }).selected.map(({ id }) => id)
    ).toEqual(["ab-2026-0720-020", "ab-2026-0720-021", "ab-2026-0720-040"])
  })

  test("skips an invalid pattern while other antibodies continue matching", () => {
    const invalid = antibody("ab-2026-0720-060", {
      trigger: { event: "PreToolUse", tool: "Bash", pattern: "[" }
    })
    const valid = antibody("ab-2026-0720-061")
    const target = buildMatchTarget("Bash", { command: "needle" }, PROJECT_DIR)

    expect(
      matchAntibodies([invalid, valid], target, { now: NOW }).selected
    ).toEqual([valid])
  })
})

describe("context rendering", () => {
  test("labels each antibody body with its ID", () => {
    const context = renderAntibodyContext([
      antibody("ab-2026-0720-070", { body: "First advice" }),
      antibody("ab-2026-0720-071", { body: "Second advice" })
    ])

    expect(context).toBe(
      "[raphael:ab-2026-0720-070]\nFirst advice\n\n[raphael:ab-2026-0720-071]\nSecond advice"
    )
  })

  test("safely truncates context to 9,000 characters while preserving the first ID boundary", () => {
    const context = renderAntibodyContext([
      antibody("ab-2026-0720-080", { body: "x".repeat(10_000) })
    ])

    expect(context).toHaveLength(9_000)
    expect(context.startsWith("[raphael:ab-2026-0720-080]\n")).toBe(true)
  })

  test("returns selection, expired IDs, and rendered context together", () => {
    const selected = antibody("ab-2026-0720-090")
    const target = buildMatchTarget("Bash", { command: "needle" }, PROJECT_DIR)

    expect(selectAntibodies([selected], target, { now: NOW })).toEqual({
      selected: [selected],
      expiredActiveIds: [],
      additionalContext:
        "[raphael:ab-2026-0720-090]\nAdvice for ab-2026-0720-090"
    })
  })
})
