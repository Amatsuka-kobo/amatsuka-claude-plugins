import fs from "node:fs"
import os from "node:os"
import path from "node:path"
import { afterEach, beforeEach, expect, test } from "vitest"
import {
  FileLockError,
  LOCK_STALE_MS,
  lockPathFor,
  withFileLock
} from "../file-lock.js"

let dir: string

beforeEach(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), "metatron-lock-"))
})

afterEach(() => {
  fs.rmSync(dir, { recursive: true, force: true })
})

test("FL1: ロックが取られている間は lock_timeout を投げ、fn を呼ばない", () => {
  const target = path.join(dir, "ARCHITECTURE.md")
  fs.writeFileSync(lockPathFor(target), "held\n")
  let called = false
  let caught: unknown
  try {
    withFileLock(target, () => {
      called = true
    })
  } catch (error) {
    caught = error
  }
  expect(caught).toBeInstanceOf(FileLockError)
  expect((caught as FileLockError).code).toBe("lock_timeout")
  expect(called).toBe(false)
  // 他者のロックは消さない。
  expect(fs.existsSync(lockPathFor(target))).toBe(true)
})

test("FL2: LOCK_STALE_MS を過ぎたロックは取り直す", () => {
  const target = path.join(dir, "ARCHITECTURE.md")
  const lock = lockPathFor(target)
  fs.writeFileSync(lock, "dead\n")
  const old = new Date(Date.now() - LOCK_STALE_MS - 5_000)
  fs.utimesSync(lock, old, old)
  expect(withFileLock(target, () => "ran")).toBe("ran")
  expect(fs.existsSync(lock)).toBe(false)
})

test("FL3: fn が例外を投げてもロックを外す", () => {
  const target = path.join(dir, "ARCHITECTURE.md")
  expect(() =>
    withFileLock(target, () => {
      throw new Error("boom")
    })
  ).toThrow("boom")
  expect(fs.existsSync(lockPathFor(target))).toBe(false)
  expect(withFileLock(target, () => 1)).toBe(1)
})

test("FL4: 対象のファイルが違えば互いのロックをブロックしない", () => {
  const a = path.join(dir, "A.md")
  const b = path.join(dir, "B.md")
  const result = withFileLock(a, () => withFileLock(b, () => "both"))
  expect(result).toBe("both")
  expect(fs.existsSync(lockPathFor(a))).toBe(false)
  expect(fs.existsSync(lockPathFor(b))).toBe(false)
})
