#!/usr/bin/env node
// PreToolUse フック(設計書 §6): ツール入力のパスに一致する urgent コメントを、
// processed/ への rename(クレーム)に成功したものだけ additionalContext で注入する。
// 注入タイミングは config の injection_timing に従う(設計書 §7)。
// permissionDecision は返さない(権限フローに介入しない)。全経路フェイルオープン。
import path from "node:path"
import {
  claimComment,
  listComments,
  pathMatchesComment,
  renderInjection
} from "../lib/comments.js"
import { loadConfig } from "../lib/config.js"
import { logError, readStdinSync, resolveProjectDir } from "../lib/hook-io.js"

// additionalContext の上限 10,000 文字に対する余裕を持った切り詰め幅
const MAX_INJECT_CHARS = 9000

const input = readStdinSync()
if (!input) process.exit(0)
const projectDir = resolveProjectDir(input)

try {
  const timing = loadConfig(projectDir).injectionTiming
  const filePath =
    input.tool_name === "Write" || input.tool_name === "Edit"
      ? input.tool_input?.file_path
      : undefined
  // turn-boundary モードでは即時注入を止め、すべて Stop に委ねる(設計書 §7)
  if (timing !== "turn-boundary" && typeof filePath === "string") {
    const rel = path.relative(projectDir, filePath).replaceAll("\\", "/")
    // isAbsolute は Windows の別ドライブ(relative が絶対パスを返すケース)対策。
    // Stage 1 の capture-post-tool-use.ts と同一のガード
    if (!rel.startsWith("..") && !path.isAbsolute(rel)) {
      // 照合対象(設計書 §7): hybrid = urgent のみ / immediate = urgency 不問で
      // 全コメント / turn-boundary = ここに到達しない(上の分岐で除外済み)
      const matched = listComments(projectDir).filter(
        (c) =>
          (timing === "immediate" || c.urgency === "urgent") &&
          c.paths.some((p) => pathMatchesComment(p, rel))
      )
      // rename に成功したコメントだけを注入する(早い者勝ち。設計書 §6)
      const claimed = matched.filter((c) => claimComment(projectDir, c.name))
      if (claimed.length > 0) {
        console.log(
          JSON.stringify({
            hookSpecificOutput: {
              hookEventName: "PreToolUse",
              additionalContext: renderInjection(claimed, MAX_INJECT_CHARS)
            }
          })
        )
      }
    }
  }
} catch (err) {
  logError(projectDir, "inject-pre-tool-use", err)
}
process.exit(0)
