#!/usr/bin/env node
import { findActiveRun } from "../codiel-state.js"
import { emit, findProjectRoot, pass, readStdin } from "./lib.js"

const MARKER = "<!-- codiel:generated -->"

// GitHub MCP(github/github-mcp-server)で本文を書き込むツール。対象と本文の引数名は
// Context7 で同ライブラリ(v1.12.2、2026-09-27 取得)の現行のツール定義を確認して確定した。
// create_issue / update_issue は issue_write に統合済みで現行のツール定義に無いため対象から外した。
// 本文の引数名はいずれも body である。
// サーバー名に github を含むことを条件にし、Linear など別の MCP の同名のツールには掛けない。
const TARGET_TOOL_RE =
  /^mcp__.*github.*__(issue_write|add_issue_comment|update_issue_comment|create_pull_request|update_pull_request|update_pull_request_body|create_pull_request_review|add_comment_to_pending_review|pull_request_review_write)$/

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
