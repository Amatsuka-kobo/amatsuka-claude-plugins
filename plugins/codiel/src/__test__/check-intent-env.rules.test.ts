import fs from "node:fs"
import path from "node:path"
import { expect, test } from "vitest"
// 契約 §14 / ケース 16f の 2 者比較のためだけの相対 import(テストコード限定)。
// codiel の実行時に metatron を参照することはない。
import { extractDomains } from "../../../metatron/src/lib/architecture.js"
import { readDomains, readDomainsResult } from "../hooks/lib.js"
import {
  DUPLICATE_DOMAINS_ARCHITECTURE,
  expectTwoWayMatch,
  gitRepo,
  mkdir,
  runScript,
  UNCLOSED_DOMAINS_ARCHITECTURE,
  write
} from "./helpers/check-intent-env-fixtures.js"

// projectDocs.metatronConfig: docRoot に metatron.config.json がファイルとしてあるか。
test("metatronConfig: 設定ファイルの有無", () => {
  const has = (dir: string): boolean =>
    runScript(dir).projectDocs.metatronConfig

  expect(has(gitRepo()), "設定ファイルが無い").toBe(false)

  const file = gitRepo()
  write(file, "metatron.config.json", JSON.stringify({ version: 1 }))
  expect(has(file), "設定ファイルがある").toBe(true)

  // ディレクトリはファイルではない。
  const dirCase = gitRepo()
  mkdir(dirCase, "metatron.config.json")
  expect(has(dirCase), "ディレクトリ").toBe(false)
})

// ---------------------------------------------------------------------------
// 契約 §1 / §4-3: 独立レビューが挙げた欠陥の回帰テスト
// ---------------------------------------------------------------------------

test("契約 §1: metatron:domains が重複していれば警告を返し、最初のブロックを採る", () => {
  const dir = gitRepo()
  write(dir, "docs/ARCHITECTURE.md", DUPLICATE_DOMAINS_ARCHITECTURE)

  const out = runScript(dir)
  // 最初のブロック(frontend / backend)の 2 件。後ろの data は採らない。
  expect(out.projectDocs.domainsReadable).toBe(true)
  expect(out.projectDocs.domainCount).toBe(2)
  // 警告は経路を問わず返す(契約 §1)。文言は正本(metatron)と一致させる。
  expect(out.configWarnings).toEqual(
    extractDomains(DUPLICATE_DOMAINS_ARCHITECTURE).warnings
  )
  expect(out.configWarnings.length).toBe(1)
})

test("契約 §4-3: 未閉のドメインブロックは警告を添えて読み取りを続け、exit 0 を保つ", () => {
  const dir = gitRepo()
  write(dir, "docs/ARCHITECTURE.md", UNCLOSED_DOMAINS_ARCHITECTURE)

  // 読み取り経路はフェイルオープン。例外を投げず(runTs は非 0 終了で throw する)続行する。
  expect(() => runScript(dir)).not.toThrow()
  const out = runScript(dir)
  expect(out.projectDocs.domainsReadable).toBe(true)
  expect(out.projectDocs.domainCount).toBe(1)
  expect(out.configWarnings).toEqual(
    extractDomains(UNCLOSED_DOMAINS_ARCHITECTURE).warnings
  )
  expect(out.configWarnings.length).toBe(1)
})

// 手前の未閉フェンスがドメインブロックの開始行を呑み込む構成。ドメインブロック自体は
// 「見つからなかった」扱いになるため、`blocks[0]` 起点の警告では検出できない。
const SWALLOWED_DOMAINS_ARCHITECTURE = [
  "# ARCHITECTURE",
  "",
  "```ts",
  "const x = 1",
  "",
  "## ドメインマップ",
  "",
  "```json metatron:domains",
  '{ "frontend": ["src/app/**"] }',
  ""
].join("\n")

test("契約 §4-3: ドメインブロックを呑み込む未閉フェンスも黙って落とさない", () => {
  const dir = gitRepo()
  // **2 者比較を必ず通す(契約 §14)。** ここを check-intent-env 単体で検証すると、
  // 「1 実装だけが警告を出す」という、まさにこのテストが守るべき割れが素通しになる。
  expectTwoWayMatch(dir, "呑み込む未閉フェンス", {
    architecture: SWALLOWED_DOMAINS_ARCHITECTURE
  })

  // 手前のフェンスが閉じていないため、ドメインブロックの開始行はフェンス内に呑まれて読めない。
  // 警告が無ければ「ドメインが未定義」と区別できない。
  const text = fs.readFileSync(path.join(dir, "docs/ARCHITECTURE.md"), "utf8")
  expect(extractDomains(text).ok).toBe(false)
  expect(extractDomains(text).warnings.length).toBe(1)
  expect(readDomains(dir)).toBe(null)
  expect(readDomainsResult(dir).warnings.length).toBe(1)

  const out = runScript(dir)
  expect(out.projectDocs.domainsReadable).toBe(false)
  expect(out.configWarnings.length).toBe(1)
  expect(out.configWarnings[0]).toContain("閉じていないコードフェンス")
})
