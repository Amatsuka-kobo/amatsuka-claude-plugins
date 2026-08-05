import fs from "node:fs"
import os from "node:os"
import path from "node:path"
import { fileURLToPath } from "node:url"
import { expect, test } from "vitest"
import { runTs } from "../testing/run-ts.js"

const SCRIPT = fileURLToPath(new URL("../list-issues.ts", import.meta.url))

const mockEnv = (binDir: string) => ({
  ...process.env,
  PATH: `${binDir}${path.delimiter}${path.dirname(process.execPath)}`
})

// スクリプトを起動し stdout の JSON を返す。binDir 指定時は PATH をそのディレクトリだけに差し替える(gh モック用)
function runScript(args: string[], binDir?: string) {
  const env = binDir ? mockEnv(binDir) : process.env
  return JSON.parse(runTs(SCRIPT, args, { env }))
}

function tmpdir(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), "list-issues-"))
}

// PATH をこのディレクトリだけに差し替えるため(link-sub-issue.test.mjs と同じ規約)、
// モック gh スクリプトが呼ぶ cat は外部コマンドとして解決できない。実体を同じ bin ディレクトリに
// symlink して持ち込むことで、file + cat によるクォート事故防止の書き方を成立させる。
const CAT_BIN = ["/bin/cat", "/usr/bin/cat"].find((p) => fs.existsSync(p))

// gh モック: 応答 JSON はファイルに置き、case 分岐で cat する(クォート事故防止)
function fakeGh(
  responses: Record<string, string>,
  failPattern?: string
): string {
  const dir = tmpdir()
  for (const [name, content] of Object.entries(responses)) {
    fs.writeFileSync(path.join(dir, name), content)
  }
  if (CAT_BIN) fs.symlinkSync(CAT_BIN, path.join(dir, "cat"))
  const lines = [
    "#!/bin/sh",
    'case "$*" in',
    ...(failPattern
      ? [`  ${failPattern}) echo "boom (HTTP 500)" >&2; exit 1 ;;`]
      : []),
    `  "api user") cat "${dir}/user.json" ;;`,
    `  *"/issues?"*) cat "${dir}/issues.json" ;;`,
    `  *"/labels?"*) cat "${dir}/labels.json" ;;`,
    "  *) exit 1 ;;",
    "esac"
  ]
  const file = path.join(dir, "gh")
  fs.writeFileSync(file, `${lines.join("\n")}\n`)
  fs.chmodSync(file, 0o755)
  return dir
}

const USER = JSON.stringify({ login: "alice" })
// --slurp はページごとの配列をさらに配列でラップする(ページ 1 件でも [[...]])
const ISSUES = JSON.stringify([
  [
    {
      number: 1,
      title: "古いバグ",
      body: "x".repeat(600),
      labels: [{ name: "bug" }],
      assignees: [],
      user: { login: "alice" },
      comments: 2,
      updated_at: "2026-01-01T00:00:00Z"
    },
    {
      number: 2,
      title: "新しい要望",
      body: null,
      labels: [],
      assignees: [{ login: "bob" }],
      user: { login: "bob" },
      comments: 0,
      updated_at: "2026-06-30T00:00:00Z"
    },
    {
      number: 3,
      title: "PR は除外",
      pull_request: {},
      labels: [],
      assignees: [],
      user: { login: "alice" },
      comments: 0,
      updated_at: "2026-06-30T00:00:00Z"
    }
  ]
])
const LABELS = JSON.stringify([
  [
    { name: "bug", description: "バグ報告" },
    { name: "feature", description: "" }
  ]
])
const NOW = ["--now", "2026-07-01T00:00:00Z"]

test("--stale-days が正の整数でなければ step: args", () => {
  const out = runScript(["--stale-days", "abc"])
  expect(out.ok).toBe(false)
  expect(out.step).toBe("args")
})

test("不明な引数は step: args", () => {
  expect(runScript(["--bogus"]).step).toBe("args")
})

test("gh が PATH に無ければ step: user の失敗", () => {
  const out = runScript([...NOW], tmpdir())
  expect(out.ok).toBe(false)
  expect(out.step).toBe("user")
})

test("正常系: PR 除外・stale 判定・body 切り詰め・ラベル一覧・ログインを返す", () => {
  const dir = fakeGh({
    "user.json": USER,
    "issues.json": ISSUES,
    "labels.json": LABELS
  })
  const out = runScript([...NOW], dir)
  expect(out.ok).toBe(true)
  expect(out.currentLogin).toBe("alice")
  expect(out.staleDaysThreshold).toBe(90)
  expect(out.issues.map((i: { number: number }) => i.number)).toEqual([1, 2]) // PR(#3)は除外
  const [old, fresh] = out.issues
  expect(old.body.length).toBe(500)
  expect(old.labels).toEqual(["bug"])
  expect(old.author).toBe("alice")
  expect(old.commentsCount).toBe(2)
  expect(old.staleDays).toBe(181)
  expect(old.stale).toBe(true)
  expect(fresh.assignees).toEqual(["bob"])
  expect(fresh.body).toBe("")
  expect(fresh.staleDays).toBe(1)
  expect(fresh.stale).toBe(false)
  expect(out.labels).toEqual([
    { name: "bug", description: "バグ報告" },
    { name: "feature", description: "" }
  ])
})

test("--stale-days で閾値を変えられる", () => {
  const dir = fakeGh({
    "user.json": USER,
    "issues.json": ISSUES,
    "labels.json": LABELS
  })
  const out = runScript([...NOW, "--stale-days", "365"], dir)
  expect(out.staleDaysThreshold).toBe(365)
  expect(out.issues[0].stale).toBe(false)
})

test("Issue が 0 件なら issues: []", () => {
  const dir = fakeGh({
    "user.json": USER,
    "issues.json": "[[]]",
    "labels.json": LABELS
  })
  const out = runScript([...NOW], dir)
  expect(out.ok).toBe(true)
  expect(out.issues).toEqual([])
})

test("--paginate --slurp の複数ページ・末尾の空ページ・] [ を含むタイトルを扱える", () => {
  const issueA = {
    number: 1,
    title: "A",
    body: "",
    labels: [],
    assignees: [],
    user: { login: "a" },
    comments: 0,
    updated_at: "2026-06-30T00:00:00Z"
  }
  const issueB = {
    number: 2,
    title: "[UI] [P1] fix",
    body: "",
    labels: [],
    assignees: [],
    user: { login: "a" },
    comments: 0,
    updated_at: "2026-06-30T00:00:00Z"
  }
  // ページ 1・ページ 2・末尾の空ページ([...][] に相当)
  const pages = JSON.stringify([[issueA], [issueB], []])
  const dir = fakeGh({
    "user.json": USER,
    "issues.json": pages,
    "labels.json": LABELS
  })
  const out = runScript([...NOW], dir)
  expect(out.issues.map((i: { number: number }) => i.number)).toEqual([1, 2])
  expect(out.issues[1].title).toBe("[UI] [P1] fix") // 文字列内の "] [" が誤って書き換わらない
})

test("Issue 取得が失敗したら step: issues で stderr を返す", () => {
  const dir = fakeGh(
    { "user.json": USER, "issues.json": "[[]]", "labels.json": LABELS },
    '*"/issues?"*'
  )
  const out = runScript([...NOW], dir)
  expect(out.ok).toBe(false)
  expect(out.step).toBe("issues")
  expect(out.error).toMatch(/boom/)
})

test("ラベル取得が失敗したら step: labels", () => {
  const dir = fakeGh(
    { "user.json": USER, "issues.json": "[[]]", "labels.json": LABELS },
    '*"/labels?"*'
  )
  expect(runScript([...NOW], dir).step).toBe("labels")
})
