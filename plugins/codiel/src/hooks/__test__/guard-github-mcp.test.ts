import fs from "node:fs"
import os from "node:os"
import path from "node:path"
import { fileURLToPath } from "node:url"
import { expect, test } from "vitest"
import { runTs } from "../../testing/run-ts.js"

const HOOK = fileURLToPath(new URL("../guard-github-mcp.ts", import.meta.url))
const CLI = fileURLToPath(new URL("../../codiel-state-cli.ts", import.meta.url))

const MARKER = "<!-- codiel:generated -->"

const HOOKS_JSON = fileURLToPath(
  new URL("../../../hooks/hooks.json", import.meta.url)
)

// 対象ツール。本文の引数名はいずれも body(guard-github-mcp.ts の出典のコメントを参照)。
const TARGET_TOOLS = [
  "issue_write",
  "create_issue",
  "update_issue",
  "update_issue_body",
  "add_issue_comment",
  "update_issue_comment",
  "create_pull_request",
  "update_pull_request",
  "update_pull_request_body",
  "create_pull_request_review",
  "pull_request_review_write",
  "submit_pending_pull_request_review",
  "add_comment_to_pending_review",
  "add_pull_request_review_comment",
  "add_reply_to_pull_request_comment"
]

interface HookOutput {
  permissionDecision: string
  permissionDecisionReason: string
}

function hook(
  cwd: string,
  toolName: string,
  toolInput: Record<string, unknown>
): HookOutput | null {
  const input = JSON.stringify({
    cwd,
    tool_name: toolName,
    tool_input: toolInput
  })
  const out = runTs(HOOK, [], { input })
  if (out === "") return null
  return (JSON.parse(out) as { hookSpecificOutput: HookOutput })
    .hookSpecificOutput
}

function cli(root: string, args: string[]): string {
  return runTs(CLI, args, { cwd: root })
}

// v2 の必須引数を揃えて active な run を作る。
function setupRun(slug = "ghmcp-test"): string {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "guard-github-mcp-"))
  cli(root, [
    "init",
    "--slug",
    slug,
    "--intent",
    "docs/intents/ghmcp-test.md",
    "--integration",
    "local",
    "--scale",
    "standard",
    "--adr-target",
    "intents",
    "--image-upload",
    "none"
  ])
  return root
}

for (const tool of TARGET_TOOLS) {
  test(`run あり・mcp__github__${tool} でマーカー付きの body は素通し(無出力)`, () => {
    const root = setupRun()
    const r = hook(root, `mcp__github__${tool}`, {
      body: `内容\n\n${MARKER}`
    })
    expect(r).toBe(null)
  })

  test(`run あり・mcp__github__${tool} でマーカー無しの body は deny`, () => {
    const root = setupRun()
    const r = hook(root, `mcp__github__${tool}`, { body: "マーカーが無い本文" })
    expect(r?.permissionDecision).toBe("deny")
  })
}

test("run あり・body 引数を持たない呼び出し(add_issue_comment の reaction だけ)は素通し(無出力)", () => {
  const root = setupRun()
  const r = hook(root, "mcp__github__add_issue_comment", {
    issue_number: 1,
    reaction: "+1"
  })
  expect(r).toBe(null)
})

test("run あり・対象外のツール(読み取りの get_issue)は素通し(無出力)", () => {
  const root = setupRun()
  const r = hook(root, "mcp__github__get_issue", {
    body: "マーカーが無い本文"
  })
  expect(r).toBe(null)
})

test("run あり・サーバー名が違う github 系接続(プラグイン経由)でも matcher と検査が効く", () => {
  const root = setupRun()
  const r = hook(root, "mcp__my-github-plugin__create_pull_request", {
    body: "マーカーが無い本文"
  })
  expect(r?.permissionDecision).toBe("deny")
})

test("run あり・github に大文字を含むサーバー名でも検査が効く", () => {
  const root = setupRun()
  const r = hook(root, "mcp__GitHub__add_reply_to_pull_request_comment", {
    body: "マーカーが無い本文"
  })
  expect(r?.permissionDecision).toBe("deny")
})

test("hooks.json の matcher が対象ツールすべてに当たり、github を含まないサーバーには当たらない", () => {
  const hooks = JSON.parse(fs.readFileSync(HOOKS_JSON, "utf8")) as {
    hooks: {
      PreToolUse: { matcher: string; hooks: { command: string }[] }[]
    }
  }
  const entry = hooks.hooks.PreToolUse.find((e) =>
    e.hooks.some((h) => h.command.includes("guard-github-mcp"))
  )
  const matcher = new RegExp(entry?.matcher ?? "")
  for (const tool of TARGET_TOOLS) {
    expect(matcher.test(`mcp__github__${tool}`)).toBe(true)
    expect(matcher.test(`mcp__plugin_github_github__${tool}`)).toBe(true)
    expect(matcher.test(`mcp__GitHub__${tool}`)).toBe(true)
    expect(matcher.test(`mcp__linear__${tool}`)).toBe(false)
  }
  expect(matcher.test("mcp__github__get_issue")).toBe(false)
})

test("run あり・github を含まないサーバー名の同名ツールは掛からない(Linear 等との混同防止)", () => {
  const root = setupRun()
  const r = hook(root, "mcp__linear__create_pull_request", {
    body: "マーカーが無い本文"
  })
  expect(r).toBe(null)
})

test("run なしでマーカー無しの body でも素通し(無出力)", () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "guard-github-mcp-"))
  const r = hook(root, "mcp__github__issue_write", {
    body: "マーカーが無い本文"
  })
  expect(r).toBe(null)
})
