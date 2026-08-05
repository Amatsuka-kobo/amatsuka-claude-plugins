#!/usr/bin/env node
// GitHub Sub-issues のリンク(親 Issue への子 Issue 登録)を gh api で行い、結果を JSON で stdout に出力する。
// REST API の 2 ステップ(子 Issue の内部 ID 取得 → 親への POST)と、sub_issue_id を数値型で送るための
// -F(型付きフィールド)をここに閉じ込める。sub_issue_id は Issue「番号」ではなく内部「ID」である点に注意。
// 成否の判断(STOP するか等)はスキル側が行い、このスクリプトは常に exit 0。
// 使い方: node link-sub-issue.mjs <owner/repo> <親番号> <子番号>
import { spawnSync } from "node:child_process"

function fail(step: string, error: string): never {
  console.log(JSON.stringify({ ok: false, step, error }, null, 2))
  process.exit(0)
}

function parseIssueNumber(raw: string | undefined, label: string): number {
  const n = Number(raw)
  if (!/^\d+$/.test(raw ?? "") || !Number.isInteger(n) || n <= 0) {
    fail("args", `${label} は正の整数で指定してください: ${raw ?? "(missing)"}`)
  }
  return n
}

const [slug, parentArg, childArg] = process.argv.slice(2)
if (!/^[^/\s]+\/[^/\s]+$/.test(slug ?? "")) {
  fail(
    "args",
    `リポジトリは owner/repo 形式で指定してください: ${slug ?? "(missing)"}`
  )
}
const parent = parseIssueNumber(parentArg, "親 Issue 番号")
const child = parseIssueNumber(childArg, "子 Issue 番号")

// gh 未インストール時、spawnSync は ENOENT で status: null を返す(例外は投げない)
function gh(
  ...args: string[]
): { ok: true; stdout: string } | { ok: false; error: string } {
  const res = spawnSync("gh", args, { encoding: "utf8" })
  if (res.status !== 0) {
    return {
      ok: false,
      error: (
        res.stderr ||
        res.stdout ||
        String(res.error ?? "gh の実行に失敗")
      ).trim()
    }
  }
  return { ok: true, stdout: res.stdout }
}

// 1. 子 Issue の内部 ID を取得(Sub-issues API は Issue 番号ではなく内部 ID を要求する)
const childRes = gh("api", `repos/${slug}/issues/${child}`)
if (!childRes.ok) fail("get-child", childRes.error)
let childId: unknown
try {
  childId = (JSON.parse(childRes.stdout) as { id?: unknown }).id
} catch (e) {
  fail(
    "get-child",
    `子 Issue 応答の JSON パースに失敗: ${e instanceof Error ? e.message : String(e)}`
  )
}
if (!Number.isInteger(childId))
  fail("get-child", `子 Issue の内部 ID が取得できません: ${childId}`)

// 2. 親 Issue に Sub-issue としてリンク(-F で数値型のまま送る。-f だと文字列になり API に拒否される)
const linkRes = gh(
  "api",
  "-X",
  "POST",
  `repos/${slug}/issues/${parent}/sub_issues`,
  "-F",
  `sub_issue_id=${childId}`
)
if (!linkRes.ok) fail("link", linkRes.error)

console.log(
  JSON.stringify({ ok: true, parent, child, subIssueId: childId }, null, 2)
)
