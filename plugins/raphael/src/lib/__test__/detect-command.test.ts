import { describe, expect, test } from "vitest"
import {
  classifyCommandOutcome,
  detectCommandFailure,
  detectRetryLoop,
  extractExitCode,
  isBenignExit1Command,
  normalizeCommand
} from "../detect-command.js"
import type { RaphaelStateV1 } from "../types.js"

type RecentCommand = RaphaelStateV1["recent_commands"][number]

function recent(
  normalizedCommand: string,
  failed: boolean,
  exitCode: number | null
): RecentCommand {
  return {
    ts: "2026-07-24T00:00:00.000Z",
    normalized_command: normalizedCommand,
    failed,
    exit_code: exitCode,
    infection_id: null
  }
}

describe("exit code extraction", () => {
  test.each([
    [{ exit_code: 7, exitCode: 8, code: 9 }, undefined, 7],
    [{ exit_code: "-2", exitCode: 8, code: 9 }, undefined, -2],
    [{ exit_code: 1.5, exitCode: "8", code: 9 }, undefined, 8],
    [{ exit_code: null, exitCode: {}, code: "09" }, undefined, 9],
    ["plain output", "Command failed with STATUS CODE 23", 23],
    [{ code: "not-a-number" }, "process exited with exit code -1", -1],
    [{ exit_code: "9" }, "process exited with exit code 2", 9]
  ])("uses supported sources in priority order", (response, error, expected) => {
    expect(extractExitCode(response, error)).toBe(expected)
  })

  test.each([
    [{ exit_code: Number.POSITIVE_INFINITY }, undefined],
    [{ exit_code: 1.5 }, undefined],
    [{ exit_code: "1.0" }, undefined],
    [{ exit_code: " 1" }, undefined],
    [{ exit_code: "+1" }, undefined],
    ["exit code 2", undefined],
    [undefined, "command failed"]
  ])("rejects unsupported exit code values", (response, error) => {
    expect(extractExitCode(response, error)).toBeNull()
  })
})

test("command normalization only trims and collapses whitespace", () => {
  expect(normalizeCommand("  printf   '%s  x'\n  file  ")).toBe(
    "printf '%s x' file"
  )
})

test.each([
  "grep needle file",
  "rg needle",
  "git grep needle",
  "diff a b",
  "git diff --quiet -- file",
  "cmp a b",
  "test -f file",
  "[ -f file ]"
])("%s is benign only for exit 1", (command) => {
  expect(isBenignExit1Command(command, 1)).toBe(true)
  expect(isBenignExit1Command(command, 2)).toBe(false)
})

test("config benign commands extend rather than replace built-ins", () => {
  expect(isBenignExit1Command("custom check value", 1, ["custom check"])).toBe(
    true
  )
  expect(isBenignExit1Command("grep value", 1, ["custom check"])).toBe(true)
})

test.each([
  ["pnpm vitest", 1],
  ["pnpm run lint", 1],
  ["npm test", 1],
  ["npm test", 2],
  ["yarn test", 1],
  ["yarn lint", 1],
  ["npm run typecheck", 2],
  ["pnpm run typecheck", 2],
  ["cd x && pnpm vitest", 1],
  ["pnpm --dir x vitest", 1],
  ["TZ=UTC pnpm vitest", 1],
  ["pnpm -C x run test", 1],
  ["pnpm exec biome", 2],
  ["/abs/path/node_modules/.bin/tsc", 2],
  ["npx jest", 1],
  ["pnpm dlx pytest", 2]
] as const)("extended benign commands are benign: %s (exit %s)", (command, exitCode) => {
  expect(isBenignExit1Command(command, exitCode)).toBe(true)
})

test.each([
  "pnpm test:unit",
  "npm lint:ci",
  "yarn check:all"
])("%s does not match an extended script prefix", (command) => {
  expect(isBenignExit1Command(command, 1)).toBe(false)
})

test("extended normalization can be disabled without disabling configured commands", () => {
  expect(isBenignExit1Command("cd x && pnpm vitest", 1, [], false)).toBe(false)
  expect(isBenignExit1Command("pnpm run typecheck", 2, [], false)).toBe(false)
  expect(
    isBenignExit1Command("custom command", 1, ["custom command"], false)
  ).toBe(true)
})

test.each([
  "grep value file",
  "rg value",
  "git diff --quiet -- file"
])("%s remains benign only for exit 1", (command) => {
  expect(isBenignExit1Command(command, 1)).toBe(true)
  expect(isBenignExit1Command(command, 2)).toBe(false)
})

test("signal exits are not failures but neighboring exit codes remain failures", () => {
  for (const exitCode of [130, 137, 143]) {
    expect(
      classifyCommandOutcome({
        hookEvent: "PostToolUseFailure",
        command: "git status",
        toolResponse: { exit_code: exitCode }
      }).failed
    ).toBe(false)
  }
  for (const exitCode of [128, 129]) {
    expect(
      classifyCommandOutcome({
        hookEvent: "PostToolUseFailure",
        command: "git status",
        toolResponse: { exit_code: exitCode }
      }).failed
    ).toBe(true)
  }
})

test("PostToolUseFailure is a failure even without an exit code", () => {
  expect(
    classifyCommandOutcome({
      hookEvent: "PostToolUseFailure",
      command: "npm test",
      toolResponse: { stderr: "failed" }
    })
  ).toMatchObject({ failed: true, exit_code: null })
})

test("PostToolUse requires an explicit nonzero exit code", () => {
  expect(
    classifyCommandOutcome({
      hookEvent: "PostToolUse",
      command: "npm test",
      toolResponse: { stderr: "failed" }
    }).failed
  ).toBe(false)
  expect(
    classifyCommandOutcome({
      hookEvent: "PostToolUse",
      command: "node scripts/build.mjs",
      toolResponse: { exit_code: 2 }
    }).failed
  ).toBe(true)
})

test("benign exit 1 does not produce command-failure details", () => {
  expect(
    detectCommandFailure({
      hookEvent: "PostToolUseFailure",
      command: "grep value file",
      toolResponse: { code: 1 }
    })
  ).toBeNull()
})

test("non-benign failures produce typed command-failure details", () => {
  expect(
    detectCommandFailure({
      hookEvent: "PostToolUseFailure",
      command: "  node   scripts/build.mjs  ",
      toolResponse: { stdout: "out", stderr: "boom", exitCode: "2" }
    })
  ).toEqual({
    type: "command-failure",
    command: "  node   scripts/build.mjs  ",
    normalized_command: "node scripts/build.mjs",
    exit_code: 2,
    output_tail: "out\nboom"
  })
})

test("same normalized command must fail three times consecutively", () => {
  const commands = [
    recent("npm test", true, 1),
    recent("npm test", true, 2),
    recent("npm test", true, null)
  ]
  expect(detectRetryLoop(" npm   test ", commands)).toEqual({
    type: "retry-loop",
    command: " npm   test ",
    normalized_command: "npm test",
    consecutive_failures: 3,
    exit_codes: [1, 2, null]
  })
})

test.each([
  [
    [
      recent("npm test", true, 1),
      recent("npm test", false, 0),
      recent("npm test", true, 1)
    ]
  ],
  [
    [
      recent("npm test", true, 1),
      recent("npm run lint", true, 1),
      recent("npm test", true, 1)
    ]
  ],
  [[recent("npm test", true, 1), recent("npm test", true, 1)]]
])("a success, different command, or short run resets retry detection", (commands) => {
  expect(detectRetryLoop("npm test", commands)).toBeNull()
})
