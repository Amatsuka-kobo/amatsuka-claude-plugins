import fs from "node:fs"
import os from "node:os"
import path from "node:path"
import { afterEach, expect, test, vi } from "vitest"
import { logError, readStdinSync, resolveProjectDir } from "../hook-io.js"

afterEach(() => {
  vi.restoreAllMocks()
  delete process.env.CLAUDE_PROJECT_DIR
})

test("不正な stdin JSON は null を返す", () => {
  vi.spyOn(fs, "readFileSync").mockReturnValue("{")
  expect(readStdinSync()).toBeNull()
})

test("stdin JSON を HookInput として読み込む", () => {
  vi.spyOn(fs, "readFileSync").mockReturnValue(
    '{"session_id":"session-1","cwd":"/project","tool_name":"Bash"}'
  )
  expect(readStdinSync()).toMatchObject({
    session_id: "session-1",
    cwd: "/project",
    tool_name: "Bash"
  })
})

test("project directory は環境変数、stdin.cwd、process.cwd の順に選ぶ", () => {
  process.env.CLAUDE_PROJECT_DIR = "/from-env"
  expect(resolveProjectDir({ cwd: "/from-stdin" })).toBe("/from-env")

  delete process.env.CLAUDE_PROJECT_DIR
  expect(resolveProjectDir({ cwd: "/from-stdin" })).toBe("/from-stdin")
  expect(resolveProjectDir({})).toBe(process.cwd())
})

test("error log は .raphael/log/errors.log に追記する", () => {
  const projectDir = fs.mkdtempSync(path.join(os.tmpdir(), "raphael-hook-io-"))
  try {
    logError(projectDir, "test-context", new Error("failure"))
    const log = fs.readFileSync(
      path.join(projectDir, ".raphael", "log", "errors.log"),
      "utf8"
    )
    expect(log).toContain("[test-context]")
    expect(log).toContain("failure")
  } finally {
    fs.rmSync(projectDir, { recursive: true, force: true })
  }
})

test("error log の書き込み失敗は握り潰す", () => {
  expect(() =>
    logError("\0", "test-context", new Error("failure"))
  ).not.toThrow()
})
