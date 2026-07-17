#!/usr/bin/env node
// Stop フック(設計書 §6): ターン境界で未回収コメント(normal と、パスにマッチ
// しないまま残った urgent)をまとめて差し戻す。urgent の「即時」はベストエフォート
// であり、ターン境界が最終防衛線。stop_hook_active と processed/ 移動の二重ガードで
// 無限ループを防ぐ。全経路フェイルオープン。
import { claimComment, listComments, renderInjection } from "../lib/comments.js"
import { logError, readStdinSync, resolveProjectDir } from "../lib/hook-io.js"

const MAX_INJECT_CHARS = 9000

const input = readStdinSync()
if (!input) process.exit(0)
const projectDir = resolveProjectDir(input)

try {
  // 直前の Stop 差し戻しから継続中のターンでは差し戻さない(設計書 §6 暴走防止)
  if (input.stop_hook_active !== true) {
    const claimed = listComments(projectDir).filter((c) =>
      claimComment(projectDir, c.name)
    )
    if (claimed.length > 0) {
      console.log(
        JSON.stringify({
          decision: "block",
          reason: renderInjection(claimed, MAX_INJECT_CHARS)
        })
      )
    }
  }
} catch (err) {
  logError(projectDir, "inject-stop", err)
}
process.exit(0)
