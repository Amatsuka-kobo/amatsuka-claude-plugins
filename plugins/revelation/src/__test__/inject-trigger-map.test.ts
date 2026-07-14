import { fileURLToPath } from "node:url"
import { expect, test } from "vitest"
import { runTs } from "../testing/run-ts.js"

const HOOK = fileURLToPath(new URL("../inject-trigger-map.ts", import.meta.url))

test("トリガー表が SessionStart の additionalContext として出力される", () => {
  const out = runTs(HOOK, [], { input: "{}" })
  const o = JSON.parse(out).hookSpecificOutput
  expect(o.hookEventName).toBe("SessionStart")
  for (const s of [
    "revelation:fable-method",
    "revelation:fable-restraint",
    "revelation:fable-subagents"
  ])
    expect(
      o.additionalContext.includes(s),
      `${s} がトリガー表に含まれること`
    ).toBe(true)
})
