import fs from "node:fs"
import { describe, expect, test } from "vitest"
import { buildRules, type Rule } from "../rules.js"

const DISCIPLINE = fs.readFileSync(
  new URL("../../../references/discipline.md", import.meta.url),
  "utf8"
)

const TRANSLATION_IDS = [
  "koto-dekiru",
  "kanten",
  "ni-totte-juyo",
  "wo-motsu",
  "koto-ni-yotte",
  "hoka-naranai",
  "dash-insert"
]

// テスト側で表を読み直し、実装の読み取りと突き合わせる
function avoidTable(): { category: string; words: string[] }[] {
  const section = DISCIPLINE.split(/^## 避ける語\s*$/m)[1]?.split(/^## /m)[0]
  if (section === undefined) throw new Error("避ける語の節が無い")
  return section
    .split("\n")
    .filter((line) => line.startsWith("|") && line.includes("「"))
    .map((line) => {
      const cells = line.split("|").map((c) => c.trim())
      return {
        category: cells[1] ?? "",
        words: [...(cells[2] ?? "").matchAll(/「([^」]+)」/g)].map(
          (m) => m[1] ?? ""
        )
      }
    })
}

function hits(rules: Rule[], text: string): Rule[] {
  return rules.filter((r) => r.pattern.test(text))
}

function hitIds(rules: Rule[], text: string): string[] {
  return hits(rules, text).map((r) => r.id)
}

const rules = buildRules(DISCIPLINE)
const avoidRules = rules.filter((r) => r.id.startsWith("avoid:"))
const literalRules = rules.filter((r) => r.id.startsWith("literal:"))

describe("直訳語", () => {
  test("実物の規律の表から漢字・カタカナの語だけを規則にする", () => {
    const ids = literalRules.map((rule) => rule.id)
    for (const id of [
      "literal:版",
      "literal:緑",
      "literal:赤",
      "literal:凍結文書",
      "literal:段"
    ])
      expect(ids).toContain(id)
    expect(ids).not.toContain("literal:用途を無視した一語")
  })

  test.each([
    ["literal:版", "新しい版で"],
    ["literal:段", "2 段目"],
    ["literal:緑", "テストが緑になる"]
  ])("%s が「%s」に当たる", (id, text) => {
    expect(hitIds(literalRules, text)).toContain(id)
  })

  test("漢字が隣接する複合語の一部には当たらない", () => {
    for (const text of ["確定版", "出版", "段階", "手段", "凍結文書群"])
      expect(hitIds(literalRules, text), text).toEqual([])
  })
})

describe("避ける語", () => {
  const table = avoidTable()

  test("表の 9 行すべての分類が category に現れる", () => {
    expect(table).toHaveLength(9)
    expect(avoidRules.length).toBeGreaterThan(0)
    const categories = new Set(avoidRules.map((r) => r.category))
    for (const row of table) expect(categories).toContain(row.category)
  })

  test("表の語はどれも、同じ分類の規則のどれかに当たる", () => {
    for (const { category, words } of table) {
      for (const word of words) {
        const matched = hits(avoidRules, `前置き。${word}`).filter(
          (r) => r.category === category
        )
        expect(matched, `${category}: ${word}`).not.toHaveLength(0)
      }
    }
  })

  test("〜 を含む語は、間に語句を挟んだ文に当たる", () => {
    expect(
      hitIds(avoidRules, "ぜひ新しい設定を試してみてください")
    ).not.toEqual([])
    expect(
      hitIds(avoidRules, "今回は日本語の書き方について紹介します")
    ).not.toEqual([])
  })

  test("複合語の一部には当たらない", () => {
    expect(hitIds(avoidRules, "承認ポイントはなく、そのまま進む")).toEqual([])
    expect(hits(avoidRules, "ポイントは主に以下の通りです")).not.toEqual([])
  })

  test("advice は表の直前の文の方針", () => {
    for (const r of avoidRules)
      expect(r.advice).toBe("語を消して具体的な事実・数値・条件を書く")
  })

  test("避ける語の表が無い本文では、翻訳調の 7 型だけを返す", () => {
    const only = buildRules("# 見出し\n\n本文だけ。\n")
    expect(only.map((r) => r.id).sort()).toEqual([...TRANSLATION_IDS].sort())
  })
})

describe("翻訳調", () => {
  test("7 型の id がそろう", () => {
    const ids = rules.map((r) => r.id)
    for (const id of TRANSLATION_IDS) expect(ids).toContain(id)
  })

  test.each([
    ["koto-dekiru", "この設定で作業時間を短縮することができる。"],
    ["koto-dekiru", "同時に処理することが可能だ。"],
    ["koto-dekiru", "設定を変えることができる。"],
    ["koto-dekiru", "動かすことが可能だ。"],
    ["kanten", "コストという観点から見ると妥当だ。"],
    ["kanten", "安全という観点で比べる。"],
    ["ni-totte-juyo", "この計画にとって重要なのは合意だ。"],
    ["ni-totte-juyo", "利用者にとって大切な機能だ。"],
    ["wo-motsu", "この決定は大きな意味を持つ。"],
    ["koto-ni-yotte", "情報を整理することによって判断が速くなる。"],
    ["hoka-naranai", "これは変化の表れに他ならない。"],
    ["hoka-naranai", "これは変化の表れにほかならない。"],
    ["dash-insert", "収束するまで——つまり指摘が消えるまで——繰り返す。"],
    ["dash-insert", "収束するまで――繰り返す。"]
  ])("%s が「%s」に当たる", (id, text) => {
    expect(hitIds(rules, text)).toContain(id)
  })

  test("wo-motsu は句点か行末の直前の 持つ だけを拾う", () => {
    expect(hitIds(rules, "意味を持つ。")).toContain("wo-motsu")
    expect(hitIds(rules, "この値は大きな意味を持つ")).toContain("wo-motsu")
    for (const text of [
      "意味を持つ定義",
      "役割を持つ定義",
      "鍵を持つ",
      "責任を持って進める"
    ])
      expect(hitIds(rules, text), text).not.toContain("wo-motsu")
  })
})
