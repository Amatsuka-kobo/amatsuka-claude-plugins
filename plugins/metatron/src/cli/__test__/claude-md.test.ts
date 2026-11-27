import fs from "node:fs"
import os from "node:os"
import path from "node:path"
import { afterEach, expect, test, vi } from "vitest"
import { createConfigIfMissing, runLinkClaudeMd } from "../claude-md.js"

const dirs: string[] = []

function mkTmp(): string {
  const dir = fs.realpathSync(
    fs.mkdtempSync(path.join(os.tmpdir(), "metatron-link-"))
  )
  dirs.push(dir)
  return dir
}

afterEach(() => {
  vi.restoreAllMocks()
  process.exitCode = undefined
  for (const dir of dirs.splice(0)) {
    fs.rmSync(dir, { recursive: true, force: true })
  }
})

test("LK1: 設定ファイルの書き込みに失敗したら、作ったファイルを消して投げる", () => {
  const dir = mkTmp()
  const configPath = path.join(dir, "metatron.config.json")
  vi.spyOn(fs, "writeFileSync").mockImplementationOnce(() => {
    throw new Error("ENOSPC")
  })
  expect(() => createConfigIfMissing(configPath)).toThrow("ENOSPC")
  expect(fs.existsSync(configPath)).toBe(false)
})

test("LK2: 既存の設定ファイルには触れず false を返す", () => {
  const dir = mkTmp()
  const configPath = path.join(dir, "metatron.config.json")
  fs.writeFileSync(configPath, "{}")
  expect(createConfigIfMissing(configPath)).toBe(false)
  expect(fs.readFileSync(configPath, "utf8")).toBe("{}")
})

test("LK3: 書き込みが済んだ後の出力の失敗では、作った設定ファイルを消さない", () => {
  const dir = mkTmp()
  fs.mkdirSync(path.join(dir, ".git"))
  fs.mkdirSync(path.join(dir, "docs"))
  fs.writeFileSync(
    path.join(dir, "docs", "ARCHITECTURE.md"),
    "# ARCHITECTURE\n"
  )
  vi.spyOn(process.stdout, "write").mockImplementation(() => {
    throw new Error("EPIPE")
  })
  vi.spyOn(process.stderr, "write").mockImplementation(() => true)
  expect(() => runLinkClaudeMd({ cwd: dir })).toThrow("EPIPE")
  expect(fs.existsSync(path.join(dir, "metatron.config.json"))).toBe(true)
  expect(fs.readFileSync(path.join(dir, "CLAUDE.md"), "utf8")).toContain(
    "@docs/ARCHITECTURE.md"
  )
})
