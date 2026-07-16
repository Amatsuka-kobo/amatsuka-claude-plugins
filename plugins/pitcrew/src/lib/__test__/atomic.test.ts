import fs from "node:fs"
import os from "node:os"
import path from "node:path"
import { expect, test } from "vitest"
import { writeFileAtomic } from "../atomic.js"

function withTmpDir(fn: (dir: string) => void) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "pitcrew-atomic-"))
  try {
    fn(dir)
  } finally {
    fs.rmSync(dir, { recursive: true, force: true })
  }
}

test("親ディレクトリごと作成して書き込む", () => {
  withTmpDir((dir) => {
    const file = path.join(dir, "a", "b", "c.md")
    writeFileAtomic(file, "hello")
    expect(fs.readFileSync(file, "utf8")).toBe("hello")
  })
})

test("既存ファイルを上書きし、一時ファイルを残さない", () => {
  withTmpDir((dir) => {
    const file = path.join(dir, "x.md")
    writeFileAtomic(file, "v1")
    writeFileAtomic(file, "v2")
    expect(fs.readFileSync(file, "utf8")).toBe("v2")
    expect(fs.readdirSync(dir)).toEqual(["x.md"])
  })
})

test("rename が失敗しても一時ファイルを残さない", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "pitcrew-atomic-"))
  try {
    // 書き込み先がディレクトリだと renameSync が失敗する
    const target = path.join(dir, "sub")
    fs.mkdirSync(target)
    expect(() => writeFileAtomic(target, "x")).toThrow()
    const leftovers = fs
      .readdirSync(dir)
      .filter((name) => name.startsWith(".tmp-"))
    expect(leftovers).toEqual([])
  } finally {
    fs.rmSync(dir, { recursive: true, force: true })
  }
})
