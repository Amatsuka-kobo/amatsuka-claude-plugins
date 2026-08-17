// テスト用の故障注入。`lib/config.ts` の `loadConfig` を、必ず例外を投げる実装へ差し替える。
//
// `lib/config.ts` の `loadConfig` は「例外を投げない」ことを契約にしているため、
// 「設定の読み取り自体が例外で失敗した」経路は通常の入力では再現できない。
// それでも inject-context.ts はこの場合に**何も出力してはならない**
// (設計書 §8-7 の限定・ファイル契約 §12)。壊れた機構が誤った CLI パスを
// 広告するのを防ぐためである。この不変条件を確かめるために、
// モジュール解決の層で差し替える。
//
// 使い方: 子プロセスへ `NODE_OPTIONS="--import <このファイルの file: URL>"` を渡す。
// biome / tsc の対象外にするため拡張子は .mjs にしてある(どちらも .ts / .js だけを見る)。

import { registerHooks } from "node:module"

registerHooks({
  load(url, context, nextLoad) {
    if (url.endsWith("/lib/config.ts")) {
      return {
        format: "module",
        shortCircuit: true,
        source:
          "export function loadConfig() {\n  throw new Error('injected config failure')\n}\n"
      }
    }
    return nextLoad(url, context)
  }
})
