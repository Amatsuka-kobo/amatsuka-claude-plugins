#!/usr/bin/env node
// PreToolUse フック(設計書 §6): ツール入力のパスに一致する urgent コメントを、
// processed/ への rename(クレーム)に成功したものだけ additionalContext で注入する。
// permissionDecision は返さない(権限フローに介入しない)。全経路フェイルオープン。
import path from "node:path"
import {
  claimComment,
  listComments,
  pathMatchesComment,
  renderInjection
} from "../lib/comments.js"
import { logError, readStdinSync, resolveProjectDir } from "../lib/hook-io.js"

// additionalContext の上限 10,000 文字に対する余裕を持った切り詰め幅
const MAX_INJECT_CHARS = 9000

const input = readStdinSync()
if (!input) process.exit(0)
const projectDir = resolveProjectDir(input)

try {
  const filePath =
    input.tool_name === "Write" || input.tool_name === "Edit"
      ? input.tool_input?.file_path
      : undefined
  if (typeof filePath === "string") {
    const rel = path.relative(projectDir, filePath).replaceAll("\\", "/")
    // isAbsolute は Windows の別ドライブ(relative が絶対パスを返すケース)対策。
    // Stage 1 の capture-post-tool-use.ts と同一のガード
    if (!rel.startsWith("..") && !path.isAbsolute(rel)) {
      const matched = listComments(projectDir).filter(
        (c) =>
          c.urgency === "urgent" &&
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
