#!/usr/bin/env node
import { logError, readStdinSync, resolveProjectDir } from "../lib/hook-io.js"
// PreToolUse フック: ツール種別やパスを問わず、未処理質問を早い者勝ちで注入する。
// permissionDecision は返さず権限フローに介入しない。全経路フェイルオープン。
import { MAX_INJECT_CHARS, renderInjection } from "../lib/injection.js"
import { claimQuestion, listQuestions } from "../lib/queue.js"

const input = readStdinSync()
if (!input) process.exit(0)
const projectDir = resolveProjectDir(input)

try {
  const claimed = listQuestions(projectDir).filter((question) =>
    claimQuestion(projectDir, question.name)
  )
  if (claimed.length > 0) {
    console.log(
      JSON.stringify({
        hookSpecificOutput: {
          hookEventName: "PreToolUse",
          additionalContext: renderInjection(
            claimed,
            projectDir,
            MAX_INJECT_CHARS
          )
        }
      })
    )
  }
} catch (err) {
  logError(projectDir, "inject-pre-tool-use", err)
}
process.exit(0)
