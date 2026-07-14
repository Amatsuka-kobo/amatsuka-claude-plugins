import { describe, expect, it } from "vitest"
import { parseDiff } from "../diffParse.js"

describe("parseDiff", () => {
  it("追加行と削除行を分類する", () => {
    const diff = [
      "diff --git a/src/foo.ts b/src/foo.ts",
      "index 111..222 100644",
      "--- a/src/foo.ts",
      "+++ b/src/foo.ts",
      "@@ -1,3 +1,3 @@",
      " context line",
      "-const x = 1",
      "+const x = 2",
      "+const y = 3"
    ].join("\n")

    const result = parseDiff(diff)
    expect(result.files).toHaveLength(1)
    expect(result.files[0].path).toBe("src/foo.ts")
    expect(result.files[0].additions).toEqual(["const x = 2", "const y = 3"])
    expect(result.files[0].deletions).toEqual(["const x = 1"])
    expect(result.totalChangedLines).toBe(3)
  })

  it("新規ファイルを isNew として検出する", () => {
    const diff = [
      "diff --git a/src/new.ts b/src/new.ts",
      "new file mode 100644",
      "index 000..111",
      "--- /dev/null",
      "+++ b/src/new.ts",
      "@@ -0,0 +1,2 @@",
      "+line1",
      "+line2"
    ].join("\n")

    const result = parseDiff(diff)
    expect(result.files[0].isNew).toBe(true)
    expect(result.files[0].additions).toEqual(["line1", "line2"])
  })

  it("削除ファイルを isDeleted として検出する", () => {
    const diff = [
      "diff --git a/src/old.ts b/src/old.ts",
      "deleted file mode 100644",
      "index 111..000",
      "--- a/src/old.ts",
      "+++ /dev/null",
      "@@ -1,2 +0,0 @@",
      "-line1",
      "-line2"
    ].join("\n")

    const result = parseDiff(diff)
    expect(result.files[0].isDeleted).toBe(true)
    expect(result.files[0].deletions).toEqual(["line1", "line2"])
  })

  it("リネームを isRename と oldPath で検出する", () => {
    const diff = [
      "diff --git a/src/old.ts b/src/new.ts",
      "similarity index 100%",
      "rename from src/old.ts",
      "rename to src/new.ts"
    ].join("\n")

    const result = parseDiff(diff)
    expect(result.files[0].isRename).toBe(true)
    expect(result.files[0].oldPath).toBe("src/old.ts")
    expect(result.files[0].path).toBe("src/new.ts")
  })

  it("バイナリファイルを isBinary として検出する", () => {
    const diff = [
      "diff --git a/image.png b/image.png",
      "index 111..222 100644",
      "Binary files a/image.png and b/image.png differ"
    ].join("\n")

    const result = parseDiff(diff)
    expect(result.files[0].isBinary).toBe(true)
    expect(result.files[0].path).toBe("image.png")
  })

  it("複数ファイルを個別に集計する", () => {
    const diff = [
      "diff --git a/a.ts b/a.ts",
      "--- a/a.ts",
      "+++ b/a.ts",
      "@@ -1 +1 @@",
      "+one",
      "diff --git a/b.ts b/b.ts",
      "--- a/b.ts",
      "+++ b/b.ts",
      "@@ -1 +1,2 @@",
      "+two",
      "+three"
    ].join("\n")

    const result = parseDiff(diff)
    expect(result.files).toHaveLength(2)
    expect(result.files[0].path).toBe("a.ts")
    expect(result.files[1].path).toBe("b.ts")
    expect(result.totalChangedLines).toBe(3)
  })

  it("非 diff 文字列は files 空で返す(呼び出し側フォールバック用)", () => {
    const code = "function foo() {\n  return 1\n}\n"
    const result = parseDiff(code)
    expect(result.files).toEqual([])
    expect(result.totalChangedLines).toBe(0)
  })
})
