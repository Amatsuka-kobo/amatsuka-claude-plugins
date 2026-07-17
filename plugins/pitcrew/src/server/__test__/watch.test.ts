import fs from "node:fs"
import os from "node:os"
import path from "node:path"
import { expect, test } from "vitest"
import { watchPitcrew } from "../watch.js"

function makeProject(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), "pitcrew-watch-"))
}

function waitFor(cond: () => boolean, timeoutMs: number): Promise<void> {
  return new Promise((resolve, reject) => {
    const start = Date.now()
    const timer = setInterval(() => {
      if (cond()) {
        clearInterval(timer)
        resolve()
      } else if (Date.now() - start > timeoutMs) {
        clearInterval(timer)
        reject(new Error("timeout"))
      }
    }, 50)
  })
}

test("review/ への書き込みで onChange が呼ばれる", async () => {
  const dir = makeProject()
  const review = path.join(dir, ".pitcrew", "review")
  fs.mkdirSync(review, { recursive: true })
  let calls = 0
  const stop = watchPitcrew(dir, () => {
    calls++
  })
  try {
    // watch 開始の非同期セットアップ猶予
    await new Promise((r) => setTimeout(r, 300))
    fs.writeFileSync(path.join(review, "001-diff-x.md"), "x")
    await waitFor(() => calls >= 1, 5000)
    expect(calls).toBeGreaterThanOrEqual(1)
  } finally {
    stop()
    fs.rmSync(dir, { recursive: true, force: true })
  }
})

test(".pitcrew/ が無くても開始でき、後から作られた変更を拾う", async () => {
  const dir = makeProject()
  let calls = 0
  const stop = watchPitcrew(dir, () => {
    calls++
  })
  try {
    await new Promise((r) => setTimeout(r, 300))
    const comments = path.join(dir, ".pitcrew", "comments")
    fs.mkdirSync(comments, { recursive: true })
    fs.writeFileSync(path.join(comments, "c-001.md"), "x")
    await waitFor(() => calls >= 1, 10000)
    expect(calls).toBeGreaterThanOrEqual(1)
  } finally {
    stop()
    fs.rmSync(dir, { recursive: true, force: true })
  }
})

test("stop 後は変更を拾わない", async () => {
  const dir = makeProject()
  const review = path.join(dir, ".pitcrew", "review")
  fs.mkdirSync(review, { recursive: true })
  let calls = 0
  const stop = watchPitcrew(dir, () => {
    calls++
  })
  await new Promise((r) => setTimeout(r, 300))
  stop()
  try {
    fs.writeFileSync(path.join(review, "001-diff-x.md"), "x")
    await new Promise((r) => setTimeout(r, 800))
    expect(calls).toBe(0)
  } finally {
    fs.rmSync(dir, { recursive: true, force: true })
  }
})
