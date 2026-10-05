import { describe, expect, it } from "vitest"
import { parseDiff } from "../diffParse.js"

describe("parseDiff", () => {
  it("追加行と削除行を分類し、追加行の行番号を持つ", () => {
    const diff = [
      "diff --git a/src/foo.ts b/src/foo.ts",
      "index 111..222 100644",
      "--- a/src/foo.ts",
      "+++ b/src/foo.ts",
      "@@ -1,2 +1,3 @@",
      " context line",
      "-const x = 1",
      "+const x = 2",
      "+const y = 3"
    ].join("\n")

    const result = parseDiff(diff)
    expect(result.files).toHaveLength(1)
    expect(result.files[0].path).toBe("src/foo.ts")
    expect(result.files[0].additions).toEqual(["const x = 2", "const y = 3"])
    expect(result.files[0].additionLines).toEqual([8, 9])
    expect(result.files[0].deletions).toEqual(["const x = 1"])
    expect(result.totalChangedLines).toBe(3)
    expect(result.headingLines).toEqual([0, 1, 2, 3])
    expect(result.malformedHeaders).toEqual([])
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
    expect(result.files[0].path).toBe("src/old.ts")
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

  it("複数ファイルを個別に集計し、ファイルごとの区間を持つ", () => {
    const diff = [
      "diff --git a/a.ts b/a.ts",
      "--- a/a.ts",
      "+++ b/a.ts",
      "@@ -0,0 +1 @@",
      "+one",
      "diff --git a/b.ts b/b.ts",
      "--- a/b.ts",
      "+++ b/b.ts",
      "@@ -0,0 +1,2 @@",
      "+two",
      "+three"
    ].join("\n")

    const result = parseDiff(diff)
    expect(result.files.map((f) => f.path)).toEqual(["a.ts", "b.ts"])
    expect(result.files.map((f) => [f.start, f.end])).toEqual([
      [0, 5],
      [5, 11]
    ])
    expect(result.totalChangedLines).toBe(3)
  })

  it("hunk の中の `--- ` で始まる削除行をファイル見出しと取り違えない", () => {
    const diff = [
      "diff --git a/q.sql b/q.sql",
      "--- a/q.sql",
      "+++ b/q.sql",
      "@@ -1,2 +1,1 @@",
      "--- a/secret comment",
      "-++ b/x",
      "+SELECT 1;"
    ].join("\n")

    const result = parseDiff(diff)
    expect(result.files).toHaveLength(1)
    expect(result.files[0].path).toBe("q.sql")
    expect(result.files[0].deletions).toEqual(["-- a/secret comment", "++ b/x"])
    expect(result.malformedHeaders).toEqual([])
  })

  it("diff でない文字列は files 空で返す", () => {
    const result = parseDiff("function foo() {\n  return 1\n}\n")
    expect(result.files).toEqual([])
    expect(result.totalChangedLines).toBe(0)
  })
})

describe("parseDiff の引用符付きのパス(所見 A6)", () => {
  it("8 進エスケープの日本語のファイル名を復号する", () => {
    const quoted = "\\346\\227\\245\\346\\234\\254 \\350\\252\\236.txt"
    const diff = [
      `diff --git "a/${quoted}" "b/${quoted}"`,
      "new file mode 100644",
      "--- /dev/null",
      `+++ "b/${quoted}"`,
      "@@ -0,0 +1 @@",
      "+y"
    ].join("\n")

    const result = parseDiff(diff)
    expect(result.files[0].path).toBe("日本 語.txt")
    expect(result.files[0].additions).toEqual(["y"])
    expect(result.malformedHeaders).toEqual([])
  })

  it("タブと二重引用符のエスケープを復号する", () => {
    const diff = [
      'diff --git "a/a\\tb.txt" "b/a\\tb.txt"',
      "new file mode 100644",
      "--- /dev/null",
      '+++ "b/a\\tb.txt"',
      "@@ -0,0 +1 @@",
      "+x",
      'diff --git "a/q\\"uote.txt" "b/q\\"uote.txt"',
      "--- /dev/null",
      '+++ "b/q\\"uote.txt"',
      "@@ -0,0 +1 @@",
      "+z"
    ].join("\n")

    const result = parseDiff(diff)
    expect(result.files.map((f) => f.path)).toEqual(["a\tb.txt", 'q"uote.txt'])
  })

  it("quotePath=false の空白を含む名前と、+++ の末尾のタブを読む", () => {
    const diff = [
      "diff --git a/日本 語.txt b/日本 語.txt",
      "--- a/日本 語.txt\t",
      "+++ b/日本 語.txt\t",
      "@@ -1 +1,2 @@",
      " y",
      "+w"
    ].join("\n")

    const result = parseDiff(diff)
    expect(result.files[0].path).toBe("日本 語.txt")
    expect(result.files[0].oldPath).toBeUndefined()
    expect(result.files[0].additions).toEqual(["w"])
  })

  it("引用符付きの rename from・rename to を復号する", () => {
    const diff = [
      'diff --git "a/\\346\\227\\247.md" "b/\\346\\226\\260.md"',
      "similarity index 100%",
      'rename from "\\346\\227\\247.md"',
      'rename to "\\346\\226\\260.md"'
    ].join("\n")

    const result = parseDiff(diff)
    expect(result.files[0].oldPath).toBe("旧.md")
    expect(result.files[0].path).toBe("新.md")
  })

  it("解釈できないファイル見出しを malformedHeaders に集め、追加行は失わない", () => {
    const diff = [
      "diff --git src/x.ts src/x.ts",
      "--- src/x.ts",
      "+++ src/x.ts",
      "@@ -0,0 +1 @@",
      "+ok",
      'diff --git "a/broken\\q" "b/broken"',
      "@@ -0,0 +1 @@",
      "+rm -rf /"
    ].join("\n")

    const result = parseDiff(diff)
    expect(result.malformedHeaders).toEqual([
      "diff --git src/x.ts src/x.ts",
      "--- src/x.ts",
      "+++ src/x.ts",
      'diff --git "a/broken\\q" "b/broken"'
    ])
    expect(result.files.flatMap((f) => f.additions)).toEqual(["ok", "rm -rf /"])
  })
})
