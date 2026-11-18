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
  UNCLOSED_DOMAINS_ARCHITECTURE
} from "./helpers/check-intent-env-fixtures.js"

// ---------------------------------------------------------------------------
// ケース 16f の強化: ドメインマップの中身・無効な形状・重複警告を 2 者で突き合わせる
//
// 「読めたかどうか」の真偽だけを比べる比較は、検証 4 項目のどれかを 1 実装だけが
// 見ていない割れ(同じ `{}` を片方だけが受け入れる)を素通しする。
// ---------------------------------------------------------------------------

// ドメインマップブロックだけを持つ最小 ARCHITECTURE(契約 §4-1「すべてのセクションは任意」)。
function architectureWith(body: string): string {
  return [
    "# ARCHITECTURE",
    "",
    "## ドメインマップ",
    "",
    "```json metatron:domains",
    body,
    "```",
    ""
  ].join("\n")
}

test("ケース 16f: 2 実装が同じドメイン定義を返す(値まで突き合わせる)", () => {
  const dir = gitRepo()
  const sub = mkdir(dir, "a/b")
  expectTwoWayMatch(sub, "ドメイン定義の一致", {
    architecture: architectureWith(
      '{ "frontend": ["src/app/**", "src/components/**"], "data": ["db/**"] }'
    )
  })
  expect(readDomains(sub)).toStrictEqual({
    frontend: ["src/app/**", "src/components/**"],
    data: ["db/**"]
  })
  expect(runScript(sub).projectDocs.domainCount).toBe(2)
})

test("ケース 16f: 無効な形状は 2 実装が揃って「読めない」と判定する", () => {
  // 契約 §1 の検証 4 項目に反する形。1 実装だけが受け入れれば割れである。
  const invalid = [
    ["キーが 0 個", "{}"],
    ["トップレベルが配列", "[]"],
    ["トップレベルが配列(非空)", '["src/**"]'],
    ["値が空配列", '{ "x": [] }'],
    ["値の要素が文字列でない", '{ "x": [1] }'],
    ["値が配列でない", '{ "x": "src/**" }'],
    ["有効な JSON でない", '{ "x": ']
  ]
  for (const [name, body] of invalid) {
    const dir = gitRepo()
    expectTwoWayMatch(dir, `無効な形状(${name})`, {
      architecture: architectureWith(body)
    })
    expect(readDomains(dir), `codiel: ${name}`).toBe(null)
    const out = runScript(dir)
    expect(out.projectDocs.domainsReadable, `check-intent-env: ${name}`).toBe(
      false
    )
    expect(out.projectDocs.domainCount, `check-intent-env: ${name}`).toBe(0)
  }
})

test("ケース 16f: 重複ブロックで 2 実装が揃って警告を返し、最初のものを採る", () => {
  const dir = gitRepo()
  expectTwoWayMatch(dir, "重複ブロック", {
    architecture: DUPLICATE_DOMAINS_ARCHITECTURE
  })

  // 2 実装とも警告 1 件。読み取り経路なので拒否はしない(契約 §1)。
  const architecturePath = path.join(dir, "docs/ARCHITECTURE.md")
  const text = fs.readFileSync(architecturePath, "utf8")
  expect(extractDomains(text).warnings.length).toBe(1)
  expect(readDomainsResult(dir).warnings.length).toBe(1)
  expect(runScript(dir).configWarnings.length).toBe(1)

  // 採るのは最初のブロック。2 実装でずれない。
  expect(readDomains(dir)).toStrictEqual({
    frontend: ["src/app/**"],
    backend: ["src/server/**"]
  })
  expect(runScript(dir).projectDocs.domainCount).toBe(2)
})

test("ケース 16f: 未閉フェンスでも 2 実装が揃って警告を返し、読み取りは続く", () => {
  const dir = gitRepo()
  expectTwoWayMatch(dir, "未閉フェンス", {
    architecture: UNCLOSED_DOMAINS_ARCHITECTURE
  })
  expect(readDomainsResult(dir).warnings.length).toBe(1)
  expect(readDomains(dir)).toStrictEqual({ frontend: ["src/app/**"] })
})
