#!/usr/bin/env node
import { findActiveRun } from "../codiel-state.js"
import { emit, findProjectRoot, pass, readStdin } from "./lib.js"

const MARKER = "<!-- codiel:generated -->"

// GitHub MCP で Issue・PR へ本文を書き込むツール。本文の引数名はいずれも body である。
// 対象は 2026-09-27 に次の定義で確かめた。
// - github/github-mcp-server の README.md(既定のツール)と docs/feature-flags.md
//   (issues_granular・pull_requests_granular で有効になるツール)。Context7 の
//   /github/github-mcp-server と、同リポジトリの main の原文で確かめた。
// - 旧 @modelcontextprotocol/server-github(servers-archived)の update_issue。
// サーバー名に github を含むことを条件にし、Linear など別の MCP の同名のツールには掛けない。
// サーバー名は利用者が付けるので、github の大文字小文字は区別しない(例 mcp__GitHub__…)。
// hooks/hooks.json の matcher と同じ正規表現にする。
const TARGET_TOOL_RE =
  /^mcp__.*[Gg][Ii][Tt][Hh][Uu][Bb].*__(issue_write|create_issue|update_issue|update_issue_body|add_issue_comment|update_issue_comment|create_pull_request|update_pull_request|update_pull_request_body|create_pull_request_review|pull_request_review_write|submit_pending_pull_request_review|add_comment_to_pending_review|add_pull_request_review_comment|add_reply_to_pull_request_comment)$/

try {
  const input = await readStdin()
  if (!TARGET_TOOL_RE.test(input.tool_name ?? "")) pass()

  const root = findProjectRoot(input.cwd ?? process.cwd())
  const run = findActiveRun(root)
  // findActiveRun は active / awaiting_human の run しか返さない。
  // guard-bash と同じく、人間の判断待ち中も投稿を防ぐため status では分岐しない。
  if (!run) pass()

  const body = input.tool_input?.body
  // 本文の引数を持たない呼び出し(reaction だけの add_issue_comment など)は通す。
  if (typeof body !== "string") pass()

  if (!body.includes(MARKER))
    emit(
      "deny",
      `GitHub MCP の投稿にはマーカーが必要です。本文に ${MARKER} を含めて投稿し直してください。`
    )
  pass()
} catch (e) {
  emit(
    "ask",
    `guard-github-mcp の内部エラー(フェイルクローズド): ${(e as Error).message}`
  )
}
