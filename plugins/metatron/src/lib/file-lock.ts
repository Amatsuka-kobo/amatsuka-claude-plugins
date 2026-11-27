// 対象文書ごとのファイルロック(契約 §12「書き込みの排他」)。
//
// commit-architecture が ARCHITECTURE の書き込みを排他にするために使う。

import fs from "node:fs"
import path from "node:path"

export const LOCK_RETRY_INTERVAL_MS = 50
export const LOCK_MAX_RETRIES = 20
export const LOCK_STALE_MS = 60_000

/** ロックを取れなかったときに投げる。CLI は `code` を `error` として出す。 */
export class FileLockError extends Error {
  readonly code = "lock_timeout" as const

  constructor(message: string) {
    super(message)
    this.name = "FileLockError"
  }
}

/** ロックファイルは対象文書のパスに `.lock` を付けたもの。 */
export function lockPathFor(targetPath: string): string {
  return `${targetPath}.lock`
}

function sleepSync(ms: number): void {
  // 追加依存なしに同期待ちする。CLI はサブコマンドごとの短命プロセスであり、
  // ここで同期的に待っても他の処理を妨げない。
  const shared = new Int32Array(new SharedArrayBuffer(4))
  Atomics.wait(shared, 0, 0, ms)
}

function errnoCode(error: unknown): string | undefined {
  return (error as NodeJS.ErrnoException | undefined)?.code
}

function tryCreateLock(lockPath: string): boolean {
  try {
    const fd = fs.openSync(lockPath, "wx")
    try {
      fs.writeSync(fd, `${process.pid} ${new Date().toISOString()}\n`)
    } finally {
      fs.closeSync(fd)
    }
    return true
  } catch (error) {
    if (errnoCode(error) === "EEXIST") return false
    throw error
  }
}

function statMtimeMs(lockPath: string): number | null {
  try {
    return fs.statSync(lockPath).mtimeMs
  } catch {
    return null
  }
}

// 契約 §12「書き込みの排他」の 4: 死んだロックの奪取。手順を固定する。
// 1. unlink の直前に更新時刻を再取得し、なお 60 秒より古いことを確認する。
// 2. unlink する(ENOENT はそのまま次へ)。
// 3. 改めて wx で作成を試みる。奪取後の作成成功を仮定しない。
function tryStealStaleLock(lockPath: string): boolean {
  const mtimeMs = statMtimeMs(lockPath)
  if (mtimeMs === null) return tryCreateLock(lockPath)
  if (Date.now() - mtimeMs <= LOCK_STALE_MS) return false

  try {
    fs.unlinkSync(lockPath)
  } catch (error) {
    if (errnoCode(error) !== "ENOENT") return false
  }
  return tryCreateLock(lockPath)
}

/**
 * 対象文書のロックを取り、取れた場合だけ `fn` を実行する。
 *
 * `fs.open` の `wx` フラグによる排他作成で相互排除する。取得できなければ 50ms 間隔で
 * 最大 20 回リトライし、それでも取れなければ `FileLockError`(`lock_timeout`)を投げる。
 * 対象パスが違えば別のロックになり、互いをブロックしない。
 */
export function withFileLock<T>(targetPath: string, fn: () => T): T {
  const lockPath = lockPathFor(targetPath)
  try {
    fs.mkdirSync(path.dirname(lockPath), { recursive: true })
  } catch {
    // 作成できない場合は後続の open が同じ理由で失敗するので、ここでは何もしない。
  }

  let acquired = tryCreateLock(lockPath)
  for (let attempt = 0; !acquired && attempt < LOCK_MAX_RETRIES; attempt++) {
    const mtimeMs = statMtimeMs(lockPath)
    if (mtimeMs !== null && Date.now() - mtimeMs > LOCK_STALE_MS) {
      acquired = tryStealStaleLock(lockPath)
      if (acquired) break
    }
    sleepSync(LOCK_RETRY_INTERVAL_MS)
    acquired = tryCreateLock(lockPath)
  }

  if (!acquired) {
    throw new FileLockError(
      `${lockPath} のロックを取得できませんでした。他のプロセスが書き込み中の可能性があります。`
    )
  }

  try {
    return fn()
  } finally {
    try {
      fs.rmSync(lockPath, { force: true })
    } catch {
      // 解放に失敗しても 60 秒後には死んだロックとして奪える。
    }
  }
}
