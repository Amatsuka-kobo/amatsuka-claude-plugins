import fs from "node:fs"
import os from "node:os"
import path from "node:path"
import { fileURLToPath } from "node:url"
import { expect, test } from "vitest"
import { runTsAsync } from "../../testing/run-ts.js"
import { withRunLock } from "../lock.js"

const CONTENDER = fileURLToPath(
  new URL("./helpers/lock-contender.ts", import.meta.url)
)

function makeProject(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), "pitcrew-lock-"))
}

function lockPath(dir: string): string {
  return path.join(dir, ".pitcrew", "run.lock")
}

test("withRunLock は実行中だけ run.lock を作り、終了後に削除する", () => {
  const dir = makeProject()
  try {
    let seen = false
    const result = withRunLock(dir, () => {
      seen = fs.existsSync(lockPath(dir))
      return 42
    })
    expect(result).toBe(42)
    expect(seen).toBe(true)
    expect(fs.existsSync(lockPath(dir))).toBe(false)
  } finally {
    fs.rmSync(dir, { recursive: true, force: true })
  }
})

test("fn が throw してもロックは解放される", () => {
  const dir = makeProject()
  try {
    expect(() =>
      withRunLock(dir, () => {
        throw new Error("boom")
      })
    ).toThrow("boom")
    expect(fs.existsSync(lockPath(dir))).toBe(false)
  } finally {
    fs.rmSync(dir, { recursive: true, force: true })
  }
})

test("stale なロック(mtime が staleMs より古い)は回収して取得する", () => {
  const dir = makeProject()
  try {
    fs.mkdirSync(path.join(dir, ".pitcrew"), { recursive: true })
    fs.writeFileSync(lockPath(dir), '{"pid":0}')
    const past = new Date(Date.now() - 60_000)
    fs.utimesSync(lockPath(dir), past, past)
    const result = withRunLock(dir, () => "ok", { staleMs: 10_000 })
    expect(result).toBe("ok")
    expect(fs.existsSync(lockPath(dir))).toBe(false)
  } finally {
    fs.rmSync(dir, { recursive: true, force: true })
  }
})

test("stale ロックの回収に失敗しても待機予算内にロックなしで実行する", () => {
  const dir = makeProject()
  try {
    fs.mkdirSync(lockPath(dir), { recursive: true })
    const past = new Date(Date.now() - 60_000)
    fs.utimesSync(lockPath(dir), past, past)

    const startedAt = Date.now()
    const result = withRunLock(dir, () => "ran", {
      waitBudgetMs: 200,
      retryIntervalMs: 20,
      staleMs: 10
    })

    expect(result).toBe("ran")
    expect(Date.now() - startedAt).toBeLessThan(1_000)
    expect(fs.statSync(lockPath(dir)).isDirectory()).toBe(true)
  } finally {
    fs.rmSync(dir, { recursive: true, force: true })
  }
})

test("取得できないまま待機予算を使い切ったらロックなしで実行する(フェイルオープン)", () => {
  const dir = makeProject()
  try {
    fs.mkdirSync(path.join(dir, ".pitcrew"), { recursive: true })
    fs.writeFileSync(lockPath(dir), '{"pid":0}') // mtime は今 = stale ではない
    const result = withRunLock(dir, () => "ran", {
      waitBudgetMs: 100,
      retryIntervalMs: 20,
      staleMs: 60_000
    })
    expect(result).toBe("ran")
    // 他者のロックは消さない
    expect(fs.existsSync(lockPath(dir))).toBe(true)
    // フェイルオープンの痕跡がログに残る
    const log = fs.readFileSync(
      path.join(dir, ".pitcrew", "log", "errors.log"),
      "utf8"
    )
    expect(log).toContain("run.lock")
  } finally {
    fs.rmSync(dir, { recursive: true, force: true })
  }
})

test("並行プロセスの run.json 更新が直列化され lost update が起きない", async () => {
  const dir = makeProject()
  try {
    fs.mkdirSync(path.join(dir, ".pitcrew"), { recursive: true })
    fs.writeFileSync(
      path.join(dir, ".pitcrew", "run.json"),
      JSON.stringify({
        startedAt: "2026-07-16T00:00:00.000Z",
        lastCaptureCommit: null,
        lastCaptureAt: null,
        nextReviewId: 1
      })
    )
    const procs = 4
    const per = 5
    await Promise.all(
      Array.from({ length: procs }, () =>
        runTsAsync(CONTENDER, [dir, String(per)])
      )
    )
    const run = JSON.parse(
      fs.readFileSync(path.join(dir, ".pitcrew", "run.json"), "utf8")
    ) as { nextReviewId: number }
    expect(run.nextReviewId).toBe(1 + procs * per)
  } finally {
    fs.rmSync(dir, { recursive: true, force: true })
  }
}, 20_000)
