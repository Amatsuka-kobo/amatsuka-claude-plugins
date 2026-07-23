import { expect, test } from "vitest"
import {
  detectEditChurn,
  findUniqueEditFootprint,
  footprintsOverlap
} from "../detect-edit-churn.js"
import type { RaphaelStateV1 } from "../types.js"

type RecentEdit = RaphaelStateV1["recent_edits"][number]

function edit(
  filePath: string,
  lineStart: number,
  lineEnd: number
): RecentEdit {
  return {
    ts: "2026-07-24T00:00:00.000Z",
    file_path: filePath,
    line_start: lineStart,
    line_end: lineEnd
  }
}

test("derives the correct closed line interval from a unique new_string", () => {
  expect(
    findUniqueEditFootprint(
      "src/file.ts",
      "first\nchanged\nline\nlast\n",
      "changed\nline"
    )
  ).toEqual({ file_path: "src/file.ts", line_start: 2, line_end: 3 })
})

test.each([
  ["empty", "one\n", ""],
  ["missing", "one\n", "two"],
  ["duplicate", "same\nsame\n", "same"]
])("returns null for %s new_string footprints", (_name, content, newString) => {
  expect(findUniqueEditFootprint("file.ts", content, newString)).toBeNull()
})

test("closed intervals overlap at a shared endpoint", () => {
  expect(footprintsOverlap(edit("file.ts", 2, 4), edit("file.ts", 4, 7))).toBe(
    true
  )
  expect(footprintsOverlap(edit("file.ts", 2, 3), edit("file.ts", 4, 7))).toBe(
    false
  )
  expect(footprintsOverlap(edit("a.ts", 2, 4), edit("b.ts", 2, 4))).toBe(false)
})

test("three overlapping edits of the same file trigger churn", () => {
  expect(
    detectEditChurn([
      edit("src/file.ts", 2, 6),
      edit("src/file.ts", 4, 8),
      edit("src/file.ts", 5, 7)
    ])
  ).toEqual({
    type: "edit-churn",
    file_path: "src/file.ts",
    line_start: 5,
    line_end: 6,
    edits_in_window: 3
  })
})

test("other files do not break a same-file window", () => {
  expect(
    detectEditChurn([
      edit("src/file.ts", 2, 6),
      edit("src/other.ts", 1, 1),
      edit("src/file.ts", 4, 8),
      edit("src/file.ts", 5, 7)
    ])
  )?.toMatchObject({ file_path: "src/file.ts", edits_in_window: 3 })
})

test.each([
  [edit("file.ts", 1, 2), edit("file.ts", 2, 3)],
  [edit("file.ts", 1, 2), edit("file.ts", 2, 3), edit("file.ts", 4, 5)],
  [edit("a.ts", 1, 3), edit("b.ts", 1, 3), edit("b.ts", 2, 4)]
])("fewer than three mutually overlapping same-file edits do not trigger", (...edits) => {
  expect(detectEditChurn(edits)).toBeNull()
})
