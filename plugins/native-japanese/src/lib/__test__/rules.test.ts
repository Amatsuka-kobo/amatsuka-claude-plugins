import fs from "node:fs"
import { describe, expect, test } from "vitest"
import { buildRules, type Rule } from "../rules.js"

const DISCIPLINE = fs.readFileSync(
  new URL("../../../skills/japanese-writing/SKILL.md", import.meta.url),
  "utf8"
)

const TRANSLATION_IDS = ["koto-dekiru", "dash-insert"]

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

  test("表は 11 行で、規則の id は重複しない", () => {
    const ids = rules.map((r) => r.id)
    expect(new Set(ids).size).toBe(ids.length)
    expect(literalRules.map((r) => r.id)).toEqual(
      expect.arrayContaining(["literal:段", "literal:契機", "literal:節"])
    )
  })

  test("2 行に現れる語は 1 本にまとめ、「使う訳」を出現順につなぐ", () => {
    expect(hits(literalRules, "手順の段が足りない")).toHaveLength(1)
    const dan = literalRules.find((r) => r.id === "literal:段")
    expect(dan?.advice).toContain("Step・ステップ / Stage・ステージ")
    const kiki = literalRules.find((r) => r.id === "literal:契機")
    expect(kiki?.advice).toContain(" / ")
  })

  test("「目」を許す特例は「段」だけにある", () => {
    expect(hitIds(literalRules, "2 段目")).toContain("literal:段")
    expect(hitIds(literalRules, "節目")).toEqual([])
  })

  test.each([
    "根っこを確かめる",
    "木の根を掘る",
    "地面に根を張る",
    "土に根を下ろす",
    "根が深い問題",
    "根こそぎ消す",
    "問題に根ざす",
    "根に持つ",
    "根も葉もない話",
    "習慣が根づく",
    "1 節を読む",
    "1節を読む",
    "第２節を読む",
    "その節は失礼しました",
    "その節にはお世話になりました",
    "気になる節がある",
    "疑った節もある",
    "怪しい節がある",
    "ぎこちない節もある",
    "節々が痛い",
    "お節料理",
    "かつお節を削る"
  ])("慣用の語「%s」は違反にしない", (text) => {
    expect(hitIds(literalRules, text), text).toEqual([])
  })

  test.each([
    ["literal:節", "catch 節がある場合"],
    ["literal:節", "この節がある"],
    ["literal:節", "その節で述べた"],
    ["literal:節", "その節に書いた"],
    ["literal:節", "次の節で述べる"],
    ["literal:根", "システムの根を確認する"]
  ])("%s は「%s」で違反のまま残る", (id, text) => {
    expect(hitIds(literalRules, text)).toContain(id)
  })

  test("漢字が隣接する複合語の一部には当たらない", () => {
    for (const text of ["確定版", "出版", "段階", "手段", "凍結文書群"])
      expect(hitIds(literalRules, text), text).toEqual([])
  })
})

describe("避ける語", () => {
  const table = avoidTable()

  test("表の 5 分類すべてが category に現れる", () => {
    expect(table).toHaveLength(5)
    expect(avoidRules).toHaveLength(16)
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
      hitIds(avoidRules, "今回は日本語の書き方について紹介します")
    ).not.toEqual([])
  })

  test("先頭の「〜」は落とし、一致が「」の外へ広がらない", () => {
    const table =
      "## 避ける語\n\n| 分類 | 語 |\n| --- | --- |\n| 例 | 「〜なんですよね」 |\n"
    const [rule] = buildRules(table)
    expect(rule?.pattern.source).toBe("なんですよね")
  })

  test("複合語の一部には当たらない", () => {
    expect(hitIds(avoidRules, "承認ポイントはなく、そのまま進む")).toEqual([])
    expect(hits(avoidRules, "ポイントは主に以下の通りです")).not.toEqual([])
  })

  test("advice は表の直前の文の方針", () => {
    for (const r of avoidRules)
      expect(r.advice).toBe("語を消して具体的な事実・数値・条件を書く")
  })

  test("避ける語の表が無い本文では、翻訳調と冗長の 2 型だけを返す", () => {
    const only = buildRules("# 見出し\n\n本文だけ。\n")
    expect(only.map((r) => r.id).sort()).toEqual([...TRANSLATION_IDS].sort())
  })
})

describe("翻訳調", () => {
  test("2 型の id がそろう", () => {
    const ids = rules.map((r) => r.id)
    for (const id of TRANSLATION_IDS) expect(ids).toContain(id)
  })

  test.each([
    ["koto-dekiru", "この設定で作業時間を短縮することができる。"],
    ["koto-dekiru", "同時に処理することが可能だ。"],
    ["koto-dekiru", "設定を変えることができる。"],
    ["koto-dekiru", "動かすことが可能だ。"],
    ["dash-insert", "収束するまで——つまり指摘が消えるまで——繰り返す。"],
    ["dash-insert", "収束するまで――繰り返す。"]
  ])("%s が「%s」に当たる", (id, text) => {
    expect(hitIds(rules, text)).toContain(id)
  })

  test("koto-dekiru の category は冗長、dash-insert は翻訳調", () => {
    const category = (id: string) => rules.find((r) => r.id === id)?.category
    expect(category("koto-dekiru")).toBe("冗長")
    expect(category("dash-insert")).toBe("翻訳調")
  })
})
