import { describe, expect, it } from "vitest"
import { makeArtifact, makeCtx } from "../testHelpers.js"
import { testDeletionRule } from "./testDeletion.js"

function deletedFileDiff(path: string): string {
  return [
    `diff --git a/${path} b/${path}`,
    "deleted file mode 100644",
    `--- a/${path}`,
    "+++ /dev/null",
    "@@ -1,2 +0,0 @@",
    "-it('works', () => {})",
    "-expect(1).toBe(1)"
  ].join("\n")
}

function addedLineDiff(path: string, line: string): string {
  return [
    `diff --git a/${path} b/${path}`,
    `--- a/${path}`,
    `+++ b/${path}`,
    "@@ -1,1 +1,2 @@",
    `+${line}`
  ].join("\n")
}

describe("testDeletionRule", () => {
  it(".test. ファイルの削除を検出する", () => {
    const findings = testDeletionRule.check(
      makeArtifact({ content: deletedFileDiff("src/foo.test.ts") }),
      makeCtx()
    )
    expect(findings.length).toBeGreaterThan(0)
    expect(findings[0].severity).toBe("ask")
  })

  it("__tests__ 配下のファイル削除を検出する", () => {
    const findings = testDeletionRule.check(
      makeArtifact({ content: deletedFileDiff("__tests__/foo.ts") }),
      makeCtx()
    )
    expect(findings.length).toBeGreaterThan(0)
  })

  it("it.skip の追加を検出する", () => {
    const findings = testDeletionRule.check(
      makeArtifact({
        content: addedLineDiff("src/foo.test.ts", "it.skip('broken', () => {})")
      }),
      makeCtx()
    )
    expect(findings.length).toBeGreaterThan(0)
  })

  it("@pytest.mark.skip の追加を検出する", () => {
    const findings = testDeletionRule.check(
      makeArtifact({
        content: addedLineDiff(
          "test_foo.py",
          "@pytest.mark.skip(reason='flaky')"
        )
      }),
      makeCtx()
    )
    expect(findings.length).toBeGreaterThan(0)
  })

  it("通常ファイルの削除では発火しない", () => {
    const findings = testDeletionRule.check(
      makeArtifact({ content: deletedFileDiff("src/foo.ts") }),
      makeCtx()
    )
    expect(findings).toEqual([])
  })

  it("通常の追加行では発火しない", () => {
    const findings = testDeletionRule.check(
      makeArtifact({
        content: addedLineDiff("src/foo.test.ts", "it('works', () => {})")
      }),
      makeCtx()
    )
    expect(findings).toEqual([])
  })
})
