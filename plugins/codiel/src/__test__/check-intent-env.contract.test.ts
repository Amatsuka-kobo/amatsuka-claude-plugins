import { execFileSync } from "node:child_process"
import fs from "node:fs"
import path from "node:path"
import { expect, test } from "vitest"
import {
  DOMAINS_ARCHITECTURE,
  fakeBin,
  gitRepo,
  INTENT_DOC,
  isRoot,
  mkdir,
  runScript,
  tmpdir,
  write
} from "./helpers/check-intent-env-fixtures.js"

// ---------------------------------------------------------------------------
// ケース 20: 読み取り専用の担保
// ---------------------------------------------------------------------------

// 相対パス・種別・ファイル内容のスナップショットを取る。
// `.git` は git 自身が更新しうる内部領域であり、このスクリプトの書き込みの有無とは
// 無関係なので除く。
function snapshot(dir: string): string[] {
  const out: string[] = []
  const walk = (current: string, relative: string) => {
    const entries = fs
      .readdirSync(current, { withFileTypes: true })
      .sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0))
    for (const entry of entries) {
      if (entry.name === ".git") continue
      const full = path.join(current, entry.name)
      const rel = relative ? `${relative}/${entry.name}` : entry.name
      if (entry.isDirectory()) {
        out.push(`d ${rel}`)
        walk(full, rel)
      } else {
        out.push(`f ${rel} ${fs.readFileSync(full, "utf8")}`)
      }
    }
  }
  walk(dir, "")
  return out
}

test("ケース 20: 実行前後で対象ディレクトリの内容が変化しない", () => {
  const dir = gitRepo("git@github.com:owner/repo.git")
  write(dir, "docs/ARCHITECTURE.md", DOMAINS_ARCHITECTURE)
  write(dir, "CLAUDE.md", "# CLAUDE\n")
  write(dir, "README.md", "# README\n")
  write(dir, "metatron.config.json", JSON.stringify({ version: 1 }))
  write(
    dir,
    "docs/intents/2026-08-16-add-oauth-login.md",
    INTENT_DOC("add-oauth-login", "approved", "", "OAuth ログインを足す")
  )
  write(dir, ".github/ISSUE_TEMPLATE/bug.md", "---\nname: Bug\n---\n")

  const before = snapshot(dir)
  const out = runScript(dir)
  const after = snapshot(dir)

  expect(after).toEqual(before)
  // 検出そのものは成立している(空振りで「変化なし」になっていないことの確認)
  expect(out.projectDocs.domainsReadable).toBe(true)
  expect(out.existingIntents.length).toBe(1)
})

// ---------------------------------------------------------------------------
// ケース 21: contextDocs
// ---------------------------------------------------------------------------

test("ケース 21: contextDocs は存在するものだけを列挙する", () => {
  const dir = gitRepo()
  write(dir, "docs/ARCHITECTURE.md", DOMAINS_ARCHITECTURE)
  write(dir, "CLAUDE.md", "# CLAUDE\n")
  write(dir, "README.md", "# README\n")
  const out = runScript(dir)
  // ARCHITECTURE は projectDocs.architecture で返し、contextDocs には含めない
  expect(out.contextDocs).toEqual([
    path.join(dir, "CLAUDE.md"),
    path.join(dir, "README.md")
  ])
})

// ---------------------------------------------------------------------------
// ケース 24: 読めないエントリ
// ---------------------------------------------------------------------------

test("ケース 24: 読み取り権限の無いエントリがあっても exit 0", () => {
  const dir = gitRepo()
  write(dir, "docs/ARCHITECTURE.md", DOMAINS_ARCHITECTURE)
  write(
    dir,
    "docs/intents/2026-08-16-ok.md",
    INTENT_DOC("ok", "approved", "", "読める intent")
  )
  const locked = write(
    dir,
    "docs/intents/2026-08-17-locked.md",
    INTENT_DOC("locked", "approved", "", "読めない intent")
  )
  fs.chmodSync(locked, 0o000)

  const out = runScript(dir)
  expect(out.projectDocs.domainsReadable).toBe(true)
  if (!isRoot) {
    // 読めないファイルは existingIntents から落として続行する
    expect(out.existingIntents.map((i: { file: string }) => i.file)).toEqual([
      "2026-08-16-ok.md"
    ])
  }

  fs.chmodSync(locked, 0o644)
})

// ---------------------------------------------------------------------------
// 契約 §14 の検証構成(check-intent-env 単体の性質。2 者で揃うべき規則は
// ケース 16f の expectTwoWayMatch で突き合わせる)
// ---------------------------------------------------------------------------

test("契約 §14: 設定なし + git では docRoot が git ルートになる", () => {
  const dir = gitRepo()
  const sub = mkdir(dir, "src/deep")
  const out = runScript(sub)
  expect(out.docRoot).toBe(dir)
  expect(out.repoRoot).toBe(dir)
})

test("契約 §14: 開始ディレクトリ自身の metatron.config.json を採る(inclusive)", () => {
  const dir = gitRepo()
  const sub = mkdir(dir, "sub")
  write(dir, "sub/metatron.config.json", JSON.stringify({ version: 1 }))
  expect(runScript(sub).docRoot).toBe(sub)
})

test("契約 §14: シンボリックリンク経由でも実体パスで docRoot を決める", () => {
  const base = tmpdir()
  const real = mkdir(base, "real")
  write(base, "real/metatron.config.json", JSON.stringify({ version: 1 }))
  const link = path.join(base, "link")
  fs.symlinkSync(real, link)
  expect(runScript(link).docRoot).toBe(real)
})

test("契約 §14: git バイナリが無くても例外を投げず段 3 へ落ちる", () => {
  const dir = tmpdir()
  const out = runScript(dir, [fakeBin({ git: false })])
  expect(out.isGitRepo).toBe(false)
  expect(out.repoRoot).toBe(null)
  expect(out.docRoot).toBe(dir)
})

test("契約 §14: ネストした git リポジトリでは内側がルートになる", () => {
  const outer = gitRepo()
  const inner = mkdir(outer, "inner")
  execFileSync("git", ["init", "-q"], { cwd: inner })
  const sub = mkdir(inner, "sub")
  const out = runScript(sub)
  expect(out.repoRoot).toBe(inner)
  expect(out.docRoot).toBe(inner)
})

test("契約 §14: Windows 形式の区切りを含む paths も同じパスへ解決する", () => {
  const dir = gitRepo()
  write(
    dir,
    "metatron.config.json",
    JSON.stringify({
      version: 1,
      paths: { architecture: "arch\\MAIN.md" }
    })
  )
  write(dir, "arch/MAIN.md", DOMAINS_ARCHITECTURE)

  const out = runScript(dir)
  expect(out.projectDocs.architecture).toBe(path.join(dir, "arch/MAIN.md"))
  expect(out.configWarnings).toEqual([])
})

test("契約 §14: 壊れた設定・未知の version は全項目を既定値に落とす", () => {
  const broken = gitRepo()
  write(broken, "metatron.config.json", "{ this is not json")
  write(broken, "docs/ARCHITECTURE.md", DOMAINS_ARCHITECTURE)
  const brokenOut = runScript(broken)
  expect(brokenOut.docRoot).toBe(broken)
  expect(brokenOut.projectDocs.architecture).toBe(
    path.join(broken, "docs/ARCHITECTURE.md")
  )
  expect(brokenOut.configWarnings.length).toBe(1)

  const future = gitRepo()
  write(
    future,
    "metatron.config.json",
    JSON.stringify({ version: 99, paths: { architecture: "arch/MAIN.md" } })
  )
  write(future, "arch/MAIN.md", DOMAINS_ARCHITECTURE)
  write(future, "docs/ARCHITECTURE.md", DOMAINS_ARCHITECTURE)
  const futureOut = runScript(future)
  expect(futureOut.projectDocs.architecture).toBe(
    path.join(future, "docs/ARCHITECTURE.md")
  )
  expect(futureOut.configWarnings.length).toBe(1)

  const array = gitRepo()
  write(array, "metatron.config.json", "[]")
  const arrayOut = runScript(array)
  expect(arrayOut.configWarnings.length).toBe(1)
})
