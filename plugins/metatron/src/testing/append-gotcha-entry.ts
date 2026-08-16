// テスト専用のエントリポイント。設計書 §13-1 の G14(append-gotcha を 5 プロセス同時実行)で
// 使う。CLI 本体ではなくライブラリを直接呼ぶのは、ロックの相互排除だけを検証するため。
//
// 使い方: tsx append-gotcha-entry.ts <gotchas パス> <タイトル> [バリア用ディレクトリ]
//
// バリア用ディレクトリを渡すと、`<dir>/ready.<pid>` を作ってから `<dir>/go` の出現を待つ。
// tsx の起動時間の差で実行がずれて競合が起きないまま通ってしまうのを防ぐ。

import fs from "node:fs"
import path from "node:path"
import { appendGotcha, GotchaError } from "../lib/gotchas.js"

const BARRIER_TIMEOUT_MS = 15_000

function sleepSync(ms: number): void {
  const shared = new Int32Array(new SharedArrayBuffer(4))
  Atomics.wait(shared, 0, 0, ms)
}

function waitForBarrier(barrierDir: string): void {
  fs.mkdirSync(barrierDir, { recursive: true })
  fs.writeFileSync(path.join(barrierDir, `ready.${process.pid}`), "")
  const goPath = path.join(barrierDir, "go")
  const deadline = Date.now() + BARRIER_TIMEOUT_MS
  while (!fs.existsSync(goPath)) {
    if (Date.now() > deadline) throw new Error("barrier timeout")
    sleepSync(5)
  }
}

const [gotchasPath, title, barrierDir] = process.argv.slice(2)

if (gotchasPath === undefined || title === undefined) {
  process.stderr.write(
    "usage: append-gotcha-entry <gotchas> <title> [barrier]\n"
  )
  process.exit(2)
}

if (barrierDir !== undefined) waitForBarrier(barrierDir)

try {
  const result = appendGotcha(gotchasPath, {
    title,
    date: "2026-08-16",
    task: `${title} をしようとした`,
    mistake: `${title} で間違えた`,
    cause: `${title} の前提を確認しなかった`,
    countermeasure: `${title} の前に対象ファイルを Read して確認する`,
    promotionCandidate: "No"
  })
  process.stdout.write(JSON.stringify(result))
} catch (error) {
  const code = error instanceof GotchaError ? error.code : "unknown"
  process.stdout.write(
    JSON.stringify({ error: code, message: String((error as Error).message) })
  )
  process.exit(1)
}
