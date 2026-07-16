import fs from "node:fs"
import path from "node:path"
import { logError } from "./hook-io.js"
import { pitcrewDir } from "./run.js"

// run.json の read-modify-write 区間を直列化するアドバイザリロック(設計書 §6)。
// O_CREAT|O_EXCL("wx")の排他作成で取得し、finally で必ず削除する。
// 取得できない場合はフェイルオープン: ログに記録してロックなしで続行する
// (Stage 1 の既知制限と同じ挙動への劣化。セッションは絶対に止めない)。

export interface LockOptions {
  waitBudgetMs?: number
  staleMs?: number
  retryIntervalMs?: number
}

function sleepSync(ms: number): void {
  Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms)
}

function tryAcquire(lockFile: string): boolean {
  try {
    const fd = fs.openSync(lockFile, "wx")
    fs.writeSync(
      fd,
      JSON.stringify({ pid: process.pid, acquiredAt: new Date().toISOString() })
    )
    fs.closeSync(fd)
    return true
  } catch {
    return false
  }
}

function acquire(lockFile: string, opts: Required<LockOptions>): boolean {
  const deadline = Date.now() + opts.waitBudgetMs
  for (;;) {
    if (tryAcquire(lockFile)) return true
    // 保持プロセスが hook timeout 等で異常終了した stale ロックは回収する
    try {
      const st = fs.statSync(lockFile)
      if (Date.now() - st.mtimeMs > opts.staleMs) {
        fs.rmSync(lockFile, { force: true })
        continue
      }
    } catch {
      continue // 直前に解放された: 即再試行
    }
    if (Date.now() >= deadline) return false
    sleepSync(opts.retryIntervalMs)
  }
}

export function withRunLock<T>(
  projectDir: string,
  fn: () => T,
  opts: LockOptions = {}
): T {
  const resolved: Required<LockOptions> = {
    waitBudgetMs: opts.waitBudgetMs ?? 3000,
    staleMs: opts.staleMs ?? 10_000,
    retryIntervalMs: opts.retryIntervalMs ?? 50
  }
  const lockFile = path.join(pitcrewDir(projectDir), "run.lock")
  let acquired = false
  try {
    fs.mkdirSync(path.dirname(lockFile), { recursive: true })
    acquired = acquire(lockFile, resolved)
  } catch {
    acquired = false
  }
  if (!acquired)
    logError(
      projectDir,
      "with-run-lock",
      new Error("run.lock を取得できないためロックなしで続行")
    )
  try {
    return fn()
  } finally {
    if (acquired) fs.rmSync(lockFile, { force: true })
  }
}
