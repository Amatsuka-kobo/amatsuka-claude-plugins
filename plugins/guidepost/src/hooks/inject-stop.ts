#!/usr/bin/env node
import { logError, readStdinSync, resolveProjectDir } from "../lib/hook-io.js"
// Stop フック: ターン境界で未処理質問をクレームし、回答を促して差し戻す。
// stop_hook_active と processed/ 移動の二重ガードで再注入を防ぐ。全経路フェイルオープン。
import { MAX_INJECT_CHARS, renderInjection } from "../lib/injection.js"
import { claimQuestion, listQuestions } from "../lib/queue.js"

const input = readStdinSync()
if (!input) process.exit(0)
const projectDir = resolveProjectDir(input)

try {
  if (input.stop_hook_active !== true) {
    const claimed = listQuestions(projectDir).filter((question) =>
      claimQuestion(projectDir, question.name)
    )
    if (claimed.length > 0) {
      console.log(
        JSON.stringify({
          decision: "block",
          reason: renderInjection(claimed, projectDir, MAX_INJECT_CHARS)
        })
      )
    }
  }
} catch (err) {
  logError(projectDir, "inject-stop", err)
}
process.exit(0)
