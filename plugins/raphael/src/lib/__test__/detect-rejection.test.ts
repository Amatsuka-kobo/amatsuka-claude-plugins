import { expect, test } from "vitest"
import { detectUserRejection } from "../detect-rejection.js"

const previousTool = {
  tool: "Edit" as const,
  input_digest: "digest"
}

test.each([
  ["違う。戻して", "ja-restore"],
  ["No, that's wrong", "en-thats-wrong"],
  ["please undo the last change", "en-revert-that"],
  ["　ＷＲＯＮＧ！ please redo it", "en-wrong"],
  ["いえ、これはお願いしたことと異なる", "ja-not-intended"],
  ["元に　戻して", "ja-restore"]
])("detects built-in rejection %s", (prompt, expectedPattern) => {
  expect(detectUserRejection(prompt, [], previousTool)).toMatchObject({
    type: "user-rejection",
    matched_pattern: expectedPattern,
    previous_tool: previousTool
  })
})

test("multiple matches choose the first pattern in the built-in table", () => {
  expect(detectUserRejection("違う。戻して", [])?.matched_pattern).toBe(
    "ja-restore"
  )
  expect(detectUserRejection("No, that's wrong", [])?.matched_pattern).toBe(
    "en-thats-wrong"
  )
})

test.each([
  "違うファイルを検索して",
  "This is a new request, not a rejection.",
  "修正してください",
  "変更して",
  "ダメ"
])("does not over-detect ordinary requests: %s", (prompt) => {
  expect(detectUserRejection(prompt)).toBeNull()
})

test.each([
  "<system-reminder>違う。戻して</system-reminder>",
  "  <user-meta>No, that's wrong</user-meta>",
  "　<system-reminder>please undo the last change</system-reminder>"
])("skips XML-like harness/meta prompts: %s", (prompt) => {
  expect(detectUserRejection(prompt)).toBeNull()
})

test("config patterns are appended and invalid regexes are skipped individually", () => {
  expect(
    detectUserRejection("custom rollback signal", ["(", "custom\\s+rollback"])
  ).toMatchObject({
    type: "user-rejection",
    matched_pattern: "custom\\s+rollback"
  })
})

test("built-ins take precedence over matching config patterns", () => {
  expect(detectUserRejection("戻して", ["戻して"])?.matched_pattern).toBe(
    "ja-restore"
  )
})

test("returns one record with a 1000 character excerpt", () => {
  const prompt = `${"x".repeat(1_100)} please undo the last change`
  const result = detectUserRejection(prompt)
  expect(result?.prompt_excerpt).toHaveLength(1_000)
  expect(result?.matched_pattern).toBe("en-revert-that")
})
