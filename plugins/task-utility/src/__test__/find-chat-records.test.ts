import fs from "node:fs"
import os from "node:os"
import path from "node:path"
import { fileURLToPath } from "node:url"
import { expect, test } from "vitest"
import { runTs } from "../testing/run-ts.js"

const SCRIPT = fileURLToPath(new URL("../find-chat-records.ts", import.meta.url))

function runScript(args: string[]) {
  return JSON.parse(runTs(SCRIPT, args))
}

// docs/chat/ のフィクスチャを組み立てる。files は { 'YYYY/MMDD/user/name.md': '内容' } 形式
function fixture(files: Record<string, string>, index?: string): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "find-chat-"))
  fs.mkdirSync(path.join(dir, "docs", "chat"), { recursive: true })
  for (const [rel, content] of Object.entries(files)) {
    const abs = path.join(dir, "docs", "chat", rel)
    fs.mkdirSync(path.dirname(abs), { recursive: true })
    fs.writeFileSync(abs, content)
  }
  if (index !== undefined) fs.writeFileSync(path.join(dir, "docs", "chat", "INDEX.md"), index)
  return dir
}

test("docs/chat が無ければ ok: false", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "find-chat-"))
  const out = runScript(["--dir", dir, "keyword"])
  expect(out.ok).toBe(false)
})

test("キーワードも --latest も無ければ ok: false", () => {
  const dir = fixture({})
  expect(runScript(["--dir", dir]).ok).toBe(false)
})

test("--since の形式が不正なら ok: false", () => {
  const dir = fixture({})
  expect(runScript(["--dir", dir, "--since", "0712", "x"]).ok).toBe(false)
})

test("--latest: 日付降順で N 件、タイトルと user を返す(旧構造は user: null)", () => {
  const dir = fixture({
    "2025/1231/alice/year-end.md": "# 年末作業\n本文",
    "2026/0101/alice/new-year.md": "# 年始作業\n本文",
    "2026/0301/old-style.md": "# 旧構造の記録\n本文",
  })
  const out = runScript(["--dir", dir, "--latest", "2"])
  expect(out.ok).toBe(true)
  expect(out.mode).toBe("latest")
  expect(out.hits.map((h: { path: string }) => h.path)).toEqual([
    "2026/0301/old-style.md",
    "2026/0101/alice/new-year.md",
  ])
  expect(out.hits[0].user).toBe(null)
  expect(out.hits[0].title).toBe("旧構造の記録")
  expect(out.hits[1].date).toBe("2026-01-01")
})

test("--latest: N 省略時は 3 件", () => {
  const dir = fixture({
    "2026/0101/a/1.md": "# 一\n",
    "2026/0102/a/2.md": "# 二\n",
    "2026/0103/a/3.md": "# 三\n",
    "2026/0104/a/4.md": "# 四\n",
  })
  expect(runScript(["--dir", dir, "--latest"]).hits.length).toBe(3)
})

test("--latest: 同日内は mtime 降順", () => {
  const dir = fixture({
    "2026/0101/alice/first.md": "# 一\n",
    "2026/0101/alice/second.md": "# 二\n",
  })
  const atime = new Date("2026-01-01T00:00:00Z")
  fs.utimesSync(path.join(dir, "docs/chat/2026/0101/alice/first.md"), atime, new Date("2026-01-01T10:00:00Z"))
  fs.utimesSync(path.join(dir, "docs/chat/2026/0101/alice/second.md"), atime, new Date("2026-01-01T12:00:00Z"))
  const out = runScript(["--dir", dir, "--latest", "2"])
  expect(out.hits.map((h: { title: string }) => h.title)).toEqual(["二", "一"])
})

test("--user に空文字を指定すると ok: false(git config user.name 未設定を想定)", () => {
  const dir = fixture({ "2026/0101/alice/a.md": "# A\n" })
  const out = runScript(["--dir", dir, "--latest", "--user", ""])
  expect(out.ok).toBe(false)
})

test("--latest --user: 指定ユーザーの記録だけを返す", () => {
  const dir = fixture({
    "2026/0101/alice/a.md": "# A\n",
    "2026/0102/bob/b.md": "# B\n",
  })
  const out = runScript(["--dir", dir, "--latest", "--user", "alice"])
  expect(out.hits.map((h: { path: string }) => h.path)).toEqual(["2026/0101/alice/a.md"])
})

test("INDEX.md が無ければ grep モード: マッチ行と前後文脈・タイトルを返す", () => {
  const dir = fixture({
    "2026/0101/alice/design.md": "# 設計セッション\n前の行\nストリーミング方式を採用\n次の行",
    "2026/0102/alice/other.md": "# 別件\n無関係な内容",
  })
  const out = runScript(["--dir", dir, "ストリーミング"])
  expect(out.mode).toBe("grep")
  expect(out.hits.length).toBe(1)
  expect(out.hits[0].path).toBe("2026/0101/alice/design.md")
  expect(out.hits[0].title).toBe("設計セッション")
  expect(out.hits[0].matches[0]).toMatch(/前の行\nストリーミング方式を採用\n次の行/)
})

test("キーワードは大文字小文字を区別せず、複数キーワードは OR で解釈する", () => {
  const dir = fixture({
    "2026/0101/alice/a.md": "# A\nCSV Export の件",
    "2026/0102/alice/b.md": "# B\nストリーミングの件",
  })
  const out = runScript(["--dir", dir, "csv", "ストリーミング"])
  expect(out.hits.length).toBe(2)
})

test("INDEX.md があれば index モード: 索引行から検索し、要旨を title に載せ、索引に無いファイルを unindexed で返す", () => {
  const dir = fixture(
    {
      "2026/0101/alice/design.md": "# 設計\nストリーミングの話",
      "2026/0102/alice/extra.md": "# 未索引\n",
    },
    "# Chat Records Index\n\n- `2026/0101/alice/design.md` | 2026-01-01 | alice | CSV エクスポートの設計\n",
  )
  const out = runScript(["--dir", dir, "エクスポート"])
  expect(out.mode).toBe("index")
  expect(out.hits.map((h: { path: string }) => h.path)).toEqual(["2026/0101/alice/design.md"])
  expect(out.hits[0].title).toBe("CSV エクスポートの設計")
  expect(out.unindexed).toEqual(["2026/0102/alice/extra.md"])
})

test("index モードでは本文だけに現れる語はヒットしない(検索対象は索引行)", () => {
  const dir = fixture(
    { "2026/0101/alice/design.md": "# 設計\nストリーミングの話" },
    "# Chat Records Index\n\n- `2026/0101/alice/design.md` | 2026-01-01 | alice | CSV エクスポートの設計\n",
  )
  expect(runScript(["--dir", dir, "ストリーミング"]).hits.length).toBe(0)
})

test("--since: 指定日より前の記録を除外する(grep モード)", () => {
  const dir = fixture({
    "2026/0101/alice/a.md": "# A\nキーワード x",
    "2026/0301/alice/b.md": "# B\nキーワード x",
  })
  const out = runScript(["--dir", dir, "--since", "2026-02-01", "キーワード"])
  expect(out.hits.map((h: { path: string }) => h.path)).toEqual(["2026/0301/alice/b.md"])
})

test("--latest でも unindexed を返す(INDEX.md 不在時は全記録が unindexed)", () => {
  const dir = fixture({ "2026/0101/alice/a.md": "# A\n" })
  const out = runScript(["--dir", dir, "--latest"])
  expect(out.unindexed).toEqual(["2026/0101/alice/a.md"])
})

test.skipIf(Boolean(process.getuid && process.getuid() === 0))(
  "読めないファイル(chmod 000)があっても exit 0 で JSON を返し、そのファイルはヒットから外れる(grep モード)",
  () => {
    const dir = fixture({
      "2026/0101/alice/readable.md": "# 読める記録\nキーワード x",
      "2026/0102/alice/trap.md": "# 読めない記録\nキーワード x",
    })
    const trapPath = path.join(dir, "docs/chat/2026/0102/alice/trap.md")
    fs.chmodSync(trapPath, 0o000)
    try {
      const out = runScript(["--dir", dir, "キーワード"])
      expect(out.ok).toBe(true)
      expect(out.mode).toBe("grep")
      expect(out.hits.map((h: { path: string }) => h.path)).toEqual(["2026/0101/alice/readable.md"])
    } finally {
      fs.chmodSync(trapPath, 0o644) // 後片付け(mkdtemp ディレクトリの削除に支障が出ないように)
    }
  },
)

test("INDEX.md が読めない(ディレクトリ)場合も grep モードにフォールバックし exit 0 で JSON を返す", () => {
  const dir = fixture({
    "2026/0101/alice/design.md": "# 設計セッション\nストリーミング方式を採用",
  })
  fs.mkdirSync(path.join(dir, "docs", "chat", "INDEX.md"))
  const out = runScript(["--dir", dir, "ストリーミング"])
  expect(out.ok).toBe(true)
  expect(out.mode).toBe("grep")
  expect(out.hits.map((h: { path: string }) => h.path)).toEqual(["2026/0101/alice/design.md"])
})
