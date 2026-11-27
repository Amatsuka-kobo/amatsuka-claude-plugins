import path from "node:path"
import { expect, test } from "vitest"
import { loadConfig } from "../../../metatron/src/lib/config.js"
import { readDomains, resolveDocPaths } from "../hooks/lib.js"
import {
  DOMAINS_ARCHITECTURE,
  expectTwoWayMatch,
  gitRepo,
  mkdir,
  runScript,
  write
} from "./helpers/check-intent-env-fixtures.js"

test("ケース 16f: CRLF 改行の ARCHITECTURE", () => {
  // Windows で作られた ARCHITECTURE。契約 §4-2 は判定の前に行末の `\r` を除去すると定める。
  // 独自のフェンス判定を持つ実装はここで開始フェンスを認識できず、その実装だけが
  // 同じ文書を読めない状態になる。以前の契約違反はこのケースがテストに無かったため
  // 見逃された。
  const dir = gitRepo()
  write(
    dir,
    "docs/ARCHITECTURE.md",
    DOMAINS_ARCHITECTURE.replace(/\n/g, "\r\n")
  )
  expectTwoWayMatch(dir, "CRLF 改行の ARCHITECTURE")

  // 2 実装が同じドメイン定義を読めていること(可読性だけでなく中身も確認する)。
  expect(readDomains(dir)).toStrictEqual({
    frontend: ["src/app/**"],
    backend: ["src/server/**"]
  })
  expect(runScript(dir).projectDocs.domainCount).toBe(2)
})

test("ケース 16f: CRLF 改行 + 設定でパスを変えた ARCHITECTURE", () => {
  const dir = gitRepo()
  write(
    dir,
    "metatron.config.json",
    JSON.stringify({
      version: 1,
      paths: { architecture: "arch/MAIN.md" }
    })
  )
  write(dir, "arch/MAIN.md", DOMAINS_ARCHITECTURE.replace(/\n/g, "\r\n"))
  const sub = mkdir(dir, "a/b")
  expectTwoWayMatch(sub, "CRLF 改行 + 設定でパスを変えた ARCHITECTURE")
  expect(readDomains(sub)).toStrictEqual({
    frontend: ["src/app/**"],
    backend: ["src/server/**"]
  })
})

test("ケース 16f: Windows 形式のパス区切り", () => {
  const dir = gitRepo()
  write(
    dir,
    "metatron.config.json",
    JSON.stringify({
      version: 1,
      paths: { architecture: "..\\outside.md" }
    })
  )
  expectTwoWayMatch(dir, "Windows 形式の区切り")
})

test("ケース 16f: 正当な Windows 形式のパス区切り(ルート脱出を含まない)", () => {
  // 直前のケースは architecture が `..\outside.md`(ルート脱出)なので、「正当な区切りでは
  // 警告が出ない」ことを 2 者で突き合わせていない。1 実装だけが正当な相対パスへ
  // 余計な警告を出しても担保をすり抜ける(契約 §14)。
  const dir = gitRepo()
  write(
    dir,
    "metatron.config.json",
    JSON.stringify({
      version: 1,
      paths: { architecture: "docs\\arch\\MAIN.md" }
    })
  )
  expectTwoWayMatch(dir, "正当な Windows 形式の区切り")

  // 件数の一致だけでは「2 者が揃って誤警告する」を見逃す。0 件で揃うことまで求める。
  expect(loadConfig(dir).warnings, "metatron の警告").toEqual([])
  expect(resolveDocPaths(dir).warnings, "codiel の警告").toEqual([])
  expect(runScript(dir).configWarnings, "check-intent-env の警告").toEqual([])

  // 区切りを "/" に寄せた同じパスへ解決すること(契約 §3 規則 2)。
  expect(loadConfig(dir).architecturePath).toBe(
    path.join(dir, "docs/arch/MAIN.md")
  )
})

test("ケース 16f: paths.gotchas を含む設定は警告も解決への影響も無い", () => {
  const dir = gitRepo()
  write(
    dir,
    "metatron.config.json",
    JSON.stringify({
      version: 1,
      paths: { architecture: "arch/MAIN.md", gotchas: "..\\outside.md" }
    })
  )
  expectTwoWayMatch(dir, "paths.gotchas の無視")
  expect(loadConfig(dir).warnings, "metatron の警告").toEqual([])
  expect(resolveDocPaths(dir).warnings, "codiel の警告").toEqual([])
  expect(runScript(dir).configWarnings, "check-intent-env の警告").toEqual([])
  expect(resolveDocPaths(dir).architecture).toBe(path.join(dir, "arch/MAIN.md"))
})

test("ケース 16f: 壊れた設定・未知の version・型不整合", () => {
  const broken = gitRepo()
  write(broken, "metatron.config.json", "{ not json")
  expectTwoWayMatch(broken, "壊れた JSON")

  const array = gitRepo()
  write(array, "metatron.config.json", "[1, 2, 3]\n")
  expectTwoWayMatch(array, "トップレベルが配列")

  const unknown = gitRepo()
  write(
    unknown,
    "metatron.config.json",
    JSON.stringify({ version: 99, paths: { architecture: "arch/MAIN.md" } })
  )
  expectTwoWayMatch(unknown, "未知の version")

  const typed = gitRepo()
  write(
    typed,
    "metatron.config.json",
    JSON.stringify({ version: 1, paths: { architecture: 42 } })
  )
  expectTwoWayMatch(typed, "paths の型不整合")
})
