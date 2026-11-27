// テスト用の故障注入。`lib/checks.ts` の `runChecks` を、必ず例外を投げる実装へ差し替える。
//
// `metatron check` の想定外の内部エラー(終了コード 3)を、違反(1)と区別できることを
// 確かめるために使う。通常の入力では `runChecks` は例外を投げない。
//
// 使い方: 子プロセスへ `NODE_OPTIONS="--import <このファイルの file: URL>"` を渡す。

import { registerHooks } from "node:module"

registerHooks({
  load(url, context, nextLoad) {
    if (url.endsWith("/lib/checks.ts")) {
      const loaded = nextLoad(url, context)
      const source = String(loaded.source).replace(
        "export function runChecks(",
        "export function runChecks() {\n  throw new Error('injected check failure')\n}\nfunction originalRunChecks("
      )
      return { ...loaded, source, shortCircuit: true }
    }
    return nextLoad(url, context)
  }
})
