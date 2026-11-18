import fs from "node:fs"
import os from "node:os"
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
  isRoot,
  mkdir,
  runScript,
  UNCLOSED_DOMAINS_ARCHITECTURE,
  write
} from "./helpers/check-intent-env-fixtures.js"

// projectDocs.metatronRules: resolveRulesDir の場所がディレクトリとして存在するか。
test("metatronRules: rules ディレクトリの有無と paths.rulesDir・既定への落ち方", () => {
  const rules = (dir: string): boolean =>
    runScript(dir).projectDocs.metatronRules

  const none = gitRepo()
  expect(rules(none), "rules ディレクトリが無い").toBe(false)

  const def = gitRepo()
  mkdir(def, ".claude/rules/metatron")
  expect(rules(def), "既定の場所にある").toBe(true)

  // ファイルはディレクトリではない。
  const file = gitRepo()
  write(file, ".claude/rules/metatron", "x")
  expect(rules(file), "ファイル").toBe(false)

  const moved = gitRepo()
  write(
    moved,
    "metatron.config.json",
    JSON.stringify({ version: 1, paths: { rulesDir: "ai/rules" } })
  )
  mkdir(moved, ".claude/rules/metatron")
  expect(rules(moved), "設定先が無く既定にだけある").toBe(false)
  mkdir(moved, "ai/rules")
  expect(rules(moved), "設定先にある").toBe(true)

  // 絶対パス・ルート外は既定へ落ちる。
  for (const bad of [path.join(os.tmpdir(), "x"), "../outside"]) {
    const dir = gitRepo()
    write(
      dir,
      "metatron.config.json",
      JSON.stringify({ version: 1, paths: { rulesDir: bad } })
    )
    mkdir(dir, ".claude/rules/metatron")
    expect(rules(dir), `既定へ落ちる: ${bad}`).toBe(true)
  }

  // 未知の version・壊れた設定は既定の場所を見る。
  for (const cfg of [
    JSON.stringify({ version: 99, paths: { rulesDir: "ai/rules" } }),
    "{ not json"
  ]) {
    const dir = gitRepo()
    write(dir, "metatron.config.json", cfg)
    mkdir(dir, ".claude/rules/metatron")
    expect(rules(dir), `既定の場所: ${cfg}`).toBe(true)
  }
})

// root は権限を外しても読めるので、権限での判定を確かめられない(ケース 24 と同じ)
test.skipIf(isRoot)(
  "metatronRules: 読み取り権限の無い rules ディレクトリは false",
  () => {
    const dir = gitRepo()
    const rulesDir = mkdir(dir, ".claude/rules/metatron")
    fs.chmodSync(rulesDir, 0o000)
    try {
      expect(runScript(dir).projectDocs.metatronRules).toBe(false)
    } finally {
      fs.chmodSync(rulesDir, 0o755)
    }
  }
)

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
