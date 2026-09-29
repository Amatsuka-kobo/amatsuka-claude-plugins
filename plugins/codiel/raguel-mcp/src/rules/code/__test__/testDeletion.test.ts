import { describe, expect, it } from "vitest"
import { makeArtifact, makeCtx } from "../../testHelpers.js"
import { testDeletionRule } from "../testDeletion.js"
import { deletedFileDiff, fileDiff } from "./helpers/diff.js"

function check(content: string) {
  return testDeletionRule.check(makeArtifact({ content }), makeCtx())
}

describe("testDeletionRule のファイルの削除", () => {
  it.each([
    "src/foo.test.ts",
    "src/foo.spec.js",
    "__tests__/foo.ts",
    "pkg/store/foo_test.go",
    "app/test_api.py",
    "tests/helpers.py",
    "src/test/java/com/x/FooTest.java"
  ])("%s の削除を ask にする(所見 A11)", (path) => {
    const findings = check(deletedFileDiff(path, ["x"]))
    expect(findings).toHaveLength(1)
    expect(findings[0].severity).toBe("ask")
    expect(findings[0].evidence?.path).toBe(path)
  })

  it("通常ファイルの削除では出さない", () => {
    expect(check(deletedFileDiff("src/foo.ts", ["x"]))).toEqual([])
  })
})

describe("testDeletionRule の skip 化", () => {
  it.each([
    ["src/foo.test.ts", "it.skip('broken', () => {})"],
    ["src/foo.test.ts", "xdescribe('group', () => {})"],
    ["test_foo.py", "@pytest.mark.skip(reason='flaky')"],
    ["test_foo.py", "@unittest.skip('later')"],
    ["test_foo.py", "@unittest.skipIf(sys.platform == 'win32', 'x')"],
    ["foo_test.go", '\tt.Skip("flaky")'],
    ["foo_test.go", "\tt.SkipNow()"],
    ["FooTest.java", "  @Disabled"]
  ])("%s の %s を出す(所見 A11)", (path, line) => {
    const findings = check(fileDiff(path, [line]))
    expect(findings).toHaveLength(1)
    expect(findings[0].evidence?.line).toBe(6)
  })

  it("通常の追加行では出さない", () => {
    expect(
      check(fileDiff("src/foo.test.ts", ["it('works', () => {})"]))
    ).toEqual([])
  })
})
