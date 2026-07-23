import fs from "node:fs"
import os from "node:os"
import path from "node:path"
import { expect, test } from "vitest"
import { writeFileAtomic } from "../atomic.js"

function withTmpDir(fn: (dir: string) => void): void {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "raphael-atomic-"))
  try {
    fn(dir)
  } finally {
    fs.rmSync(dir, { recursive: true, force: true })
  }
}

test("親ディレクトリを作成して書き込み、既存内容を原子的に置換する", () => {
  withTmpDir((dir) => {
    const file = path.join(dir, "state", "state.json")
    writeFileAtomic(file, "v1")
    writeFileAtomic(file, "v2")

    expect(fs.readFileSync(file, "utf8")).toBe("v2")
    expect(fs.readdirSync(path.dirname(file))).toEqual(["state.json"])
  })
})

test("rename の失敗時も temporary file を残さない", () => {
  withTmpDir((dir) => {
    const target = path.join(dir, "target")
    fs.mkdirSync(target)

    expect(() => writeFileAtomic(target, "content")).toThrow()
    expect(
      fs.readdirSync(dir).filter((name) => name.startsWith(".tmp-"))
    ).toEqual([])
  })
})
