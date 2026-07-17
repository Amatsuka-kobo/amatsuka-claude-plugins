import fs from "node:fs"
import os from "node:os"
import path from "node:path"
import { expect, test } from "vitest"
import { loadRun, pitcrewDir, saveRun } from "../run.js"

function withTmpDir(fn: (dir: string) => void) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "pitcrew-run-"))
  try {
    fn(dir)
  } finally {
    fs.rmSync(dir, { recursive: true, force: true })
  }
}

test("run.json が無ければ初期値を返し、ファイルは作らない", () => {
  withTmpDir((dir) => {
    const run = loadRun(dir)
    expect(run.nextReviewId).toBe(1)
    expect(run.lastCaptureCommit).toBeNull()
    expect(run.lastCaptureAt).toBeNull()
    expect(Date.parse(run.startedAt)).not.toBeNaN()
    expect(fs.existsSync(path.join(dir, ".pitcrew", "run.json"))).toBe(false)
  })
})

test("save → load で往復できる", () => {
  withTmpDir((dir) => {
    saveRun(dir, {
      startedAt: "2026-07-16T00:00:00.000Z",
      lastCaptureCommit: "a3f2c01",
      lastCaptureAt: "2026-07-16T01:00:00.000Z",
      nextReviewId: 3
    })
    const run = loadRun(dir)
    expect(run.lastCaptureCommit).toBe("a3f2c01")
    expect(run.nextReviewId).toBe(3)
  })
})

test("壊れた run.json は初期値にフォールバックする", () => {
  withTmpDir((dir) => {
    fs.mkdirSync(pitcrewDir(dir), { recursive: true })
    fs.writeFileSync(path.join(pitcrewDir(dir), "run.json"), "{broken")
    expect(loadRun(dir).nextReviewId).toBe(1)
  })
})

test("nextReviewId が数値でない run.json も初期値にフォールバックする", () => {
  withTmpDir((dir) => {
    fs.mkdirSync(pitcrewDir(dir), { recursive: true })
    fs.writeFileSync(
      path.join(pitcrewDir(dir), "run.json"),
      JSON.stringify({ nextReviewId: "abc" })
    )
    expect(loadRun(dir).nextReviewId).toBe(1)
  })
})
