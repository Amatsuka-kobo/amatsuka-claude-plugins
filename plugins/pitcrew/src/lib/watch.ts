import fs from "node:fs"
import path from "node:path"
import { pitcrewDir } from "./run.js"

// .pitcrew/ の監視(設計書 §5: fs.watch / ポーリングのフォールバック)。
// fs.watch は recursive が使えないプラットフォームがあるため、監視対象の
// サブディレクトリを列挙して個別に watch し、まだ無いディレクトリは
// ポーリングで出現を待つ。通知はデバウンス(200ms)してまとめる。

// 注意: これらの定数を変えるときは watch.test.ts の待機時間
// (セットアップ猶予 300ms・出現待ち 10s 等)との整合を保つこと
const SUBDIRS = ["", "review", "reviewed", "comments", "comments/processed"]
const DEBOUNCE_MS = 200
const POLL_MS = 2000

export function watchPitcrew(
  projectDir: string,
  onChange: () => void
): () => void {
  const base = pitcrewDir(projectDir)
  const watchers = new Map<string, fs.FSWatcher>()
  let stopped = false
  let debounce: ReturnType<typeof setTimeout> | null = null

  const fire = (): void => {
    if (stopped) return
    if (debounce) clearTimeout(debounce)
    debounce = setTimeout(() => {
      debounce = null
      if (!stopped) onChange()
    }, DEBOUNCE_MS)
  }

  const ensureWatchers = (): void => {
    if (stopped) return
    for (const sub of SUBDIRS) {
      const dir = sub === "" ? base : path.join(base, sub)
      if (watchers.has(dir)) continue
      try {
        const w = fs.watch(dir, fire)
        // ディレクトリ削除等で watch が死んだら登録を外し、ポーリングで再取得
        w.on("error", () => {
          watchers.delete(dir)
          w.close()
        })
        watchers.set(dir, w)
      } catch {
        // まだ無い・watch 不可 → 次のポーリングで再試行
      }
    }
  }

  ensureWatchers()
  // 「未作成ディレクトリの出現」をカバーする低頻度ポーリング。
  // 新しく watch を張れたディレクトリが出たときだけ fire する
  // (作成された = 変化があったということ。既に張れているディレクトリの
  // 変化は fs.watch 側が拾う)
  const poll = setInterval(() => {
    const before = watchers.size
    ensureWatchers()
    if (watchers.size > before) fire()
  }, POLL_MS)

  return () => {
    stopped = true
    clearInterval(poll)
    if (debounce) clearTimeout(debounce)
    for (const w of watchers.values()) w.close()
    watchers.clear()
  }
}
