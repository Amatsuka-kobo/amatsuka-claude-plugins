import { execFileSync, spawnSync } from "node:child_process"
import fs from "node:fs"
import path from "node:path"
import { expect, test } from "vitest"
import { loadConfig } from "../../../metatron/src/lib/config.js"
import {
  expectTwoWayMatch,
  gitRepo,
  mkdir,
  tmpdir,
  withoutGitBinary,
  write
} from "./helpers/check-intent-env-fixtures.js"

// ---------------------------------------------------------------------------
// ケース 16f: 2 者比較(契約 §14)
//
// 契約は metatron と codiel が同じ規則の写しを独立に持つことを認めており、一致の担保は
// このテストだけである。metatron の loadConfig と codiel の resolveDocPaths は関数として
// 直接呼べるが、check-intent-env はトップレベルで副作用を持つスクリプトなので、
// 子プロセスとして起動して出力 JSON を突き合わせる。check-intent-env は lib.ts を使うので、
// 実装としては metatron と codiel の 2 つを比べることになる。
// ---------------------------------------------------------------------------

function insideGitRepo(dir: string): boolean {
  return (
    spawnSync("git", ["rev-parse", "--show-toplevel"], {
      cwd: dir,
      encoding: "utf8"
    }).status === 0
  )
}

/**
 * 同一構成に対して metatron と codiel を走らせ、docRoot と解決した ARCHITECTURE の
 * パス、既定値へ落とした理由(warnings)、ドメインマップの可読性・値・件数がすべて一致する
 * ことを検証する(契約 §14)。codiel は lib.ts の関数と check-intent-env の出力の両方を比べる。
 *
 * check-intent-env は「存在するファイル」だけを `projectDocs` に返すため、比較の前に metatron が
 * 解決したパスへ実体を置く。2 者が同じ規則で解決していれば check-intent-env も同じ絶対パスを
 * 返し、規則がずれていれば `null`(または別のパス)になって不一致として現れる。
 *
 * warnings は**文言の完全一致までは求めない**。2 実装が同じ規則の写しを独立に持つ設計で
 * 文言まで揃えると同期コストが上がりすぎるため、「警告が出るか出ないか」と
 * 「理由の件数」だけを突き合わせる(契約 §3 規則 3)。
 *
 * ドメインマップの可読性も比較対象に含める。契約 §1 は「独自のフェンス判定を書かない」と
 * 定めており、同じ ARCHITECTURE を 2 実装のうち 1 つだけが読めない状態を検出する唯一の
 * 機械的担保がここである(codiel が正規表現でブロックを切り出していたため、CRLF 改行の
 * 文書を codiel だけが読めない不整合が生じていた)。
 */

test("ケース 16f: 設定ファイル無し + git リポジトリ", () => {
  const dir = gitRepo()
  const sub = mkdir(dir, "a/b")
  expectTwoWayMatch(dir, "git リポジトリのルート")
  expectTwoWayMatch(sub, "git リポジトリのサブディレクトリ")
  expect(loadConfig(sub).docRoot).toBe(dir)
})

test("ケース 16f: 設定ファイル無し + git 管理外", () => {
  const dir = tmpdir()
  const sub = mkdir(dir, "a/b")
  if (insideGitRepo(sub)) return
  expectTwoWayMatch(dir, "git 管理外のルート")
  expectTwoWayMatch(sub, "git 管理外のサブディレクトリ")
  expect(loadConfig(sub).docRoot).toBe(sub)
})

test("ケース 16f: サブディレクトリから実行し祖先に metatron.config.json", () => {
  const dir = gitRepo()
  write(
    dir,
    "metatron.config.json",
    JSON.stringify({
      version: 1,
      paths: { architecture: "arch/MAIN.md" }
    })
  )
  const sub = mkdir(dir, "a/b")
  expectTwoWayMatch(sub, "祖先に設定ファイル")
  expect(loadConfig(sub).docRoot).toBe(dir)

  // 最も近い祖先が採られること(中間にもう 1 つ置く)。
  const mid = path.join(dir, "a")
  write(dir, "a/metatron.config.json", JSON.stringify({ version: 1 }))
  expectTwoWayMatch(sub, "最も近い祖先の設定ファイル")
  expect(loadConfig(sub).docRoot).toBe(mid)
})

test("ケース 16f: 開始ディレクトリ自身に metatron.config.json(inclusive)", () => {
  const dir = gitRepo()
  const sub = mkdir(dir, "sub")
  write(dir, "sub/metatron.config.json", JSON.stringify({ version: 1 }))
  expectTwoWayMatch(sub, "開始ディレクトリ自身に設定ファイル")
  expect(loadConfig(sub).docRoot).toBe(sub)
})

test("ケース 16f: repo/metatron.config.json と repo/sub/.codiel の併存", () => {
  const dir = gitRepo()
  write(dir, "metatron.config.json", JSON.stringify({ version: 1 }))
  const sub = mkdir(dir, "sub")
  mkdir(dir, "sub/.codiel")
  expectTwoWayMatch(sub, ".codiel と設定ファイルの併存")
  // 文書のルートは config を持つ祖先で決まり、`.codiel` の位置には引きずられない。
  expect(loadConfig(sub).docRoot).toBe(dir)
})

test("ケース 16f: paths が絶対パス / ルート脱出", () => {
  const abs = gitRepo()
  write(
    abs,
    "metatron.config.json",
    JSON.stringify({
      version: 1,
      paths: { architecture: "/etc/ARCHITECTURE.md" }
    })
  )
  expectTwoWayMatch(abs, "絶対パス")

  const esc = gitRepo()
  write(
    esc,
    "metatron.config.json",
    JSON.stringify({
      version: 1,
      paths: { architecture: "../outside/ARCHITECTURE.md" }
    })
  )
  expectTwoWayMatch(esc, "ルート脱出")

  for (const architecture of [
    "C:/ARCHITECTURE.md",
    "C:\\ARCHITECTURE.md",
    "//server/share/ARCHITECTURE.md",
    "\\\\server\\share\\ARCHITECTURE.md"
  ]) {
    const win = gitRepo()
    write(
      win,
      "metatron.config.json",
      JSON.stringify({ version: 1, paths: { architecture } })
    )
    expectTwoWayMatch(win, `Windows の絶対パス ${architecture}`)
  }
})

test("ケース 16f: シンボリックリンク経由の開始ディレクトリ", () => {
  const base = tmpdir()
  const real = mkdir(base, "real")
  write(base, "real/metatron.config.json", JSON.stringify({ version: 1 }))
  const link = path.join(base, "link")
  try {
    fs.symlinkSync(real, link, "dir")
  } catch {
    return // symlink を作れない環境ではスキップする
  }
  expectTwoWayMatch(link, "シンボリックリンク経由")
  expect(loadConfig(link).docRoot).toBe(real)
})

test("ケース 16f: git バイナリが無い環境", () => {
  const dir = tmpdir()
  const sub = mkdir(dir, "a/b")
  expectTwoWayMatch(sub, "git バイナリ無し", { withoutGit: true })
  expect(withoutGitBinary(() => loadConfig(sub).docRoot)).toBe(sub)
})

test("ケース 16f: ネストした git リポジトリ", () => {
  const outer = gitRepo()
  const inner = mkdir(outer, "inner")
  execFileSync("git", ["init", "-q"], { cwd: inner })
  const sub = mkdir(inner, "sub")
  expectTwoWayMatch(sub, "ネストした git リポジトリ")
  expect(loadConfig(sub).docRoot).toBe(inner)
})
