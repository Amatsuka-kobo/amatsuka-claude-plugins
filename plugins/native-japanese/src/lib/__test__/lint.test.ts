import fs from "node:fs"
import { describe, expect, test } from "vitest"
import type { Source } from "../extract.js"
import {
  type Analyzer,
  findEditRanges,
  lint,
  overlaps,
  type Violation
} from "../lint.js"
import { buildRules } from "../rules.js"

const RULES = buildRules(
  fs.readFileSync(
    new URL("../../../skills/japanese-writing/SKILL.md", import.meta.url),
    "utf8"
  )
)

function run(path: string, text: string, wholeFile?: Source): Violation[] {
  return lint({ path, text }, { rules: RULES, wholeFile })
}

function ids(path: string, text: string): string[] {
  return run(path, text).map((v) => v.ruleId)
}

describe("lint: 翻訳調の型", () => {
  test.each([
    ["koto-dekiru", "この設定で時間を短縮することができる。"],
    ["koto-dekiru", "この設定で時間を短縮することが可能だ。"],
    ["dash-insert", "収束するまで——つまり指摘が出なくなるまで——繰り返す。"],
    ["dash-insert", "収束するまで――つまり指摘が出なくなるまで繰り返す。"]
  ])("%s が「%s」に当たる", (id, text) => {
    expect(ids("a.md", text)).toContain(id)
  })

  test("違反は行番号・該当部分・分類・advice を持つ", () => {
    const got = run("a.md", "一行目です。\n短縮することができる。")
    const v = got.find((x) => x.ruleId === "koto-dekiru")
    expect(v).toMatchObject({
      line: 2,
      endLine: 2,
      text: "短縮することができる。",
      category: "冗長",
      match: "ことができ"
    })
    expect(v?.advice).not.toBe("")
  })

  test("同じ行の同じ規則の違反を 1 件ずつ数える", () => {
    const got = run("a.md", "することができる。そしてすることができた。")
    expect(got.filter((v) => v.ruleId === "koto-dekiru")).toHaveLength(2)
  })

  test("避ける語にも当たり、規則 id が avoid:<語> になる", () => {
    expect(ids("a.md", "大切なのは設定だ。")).toContain("avoid:大切なのは")
  })

  test("コードのコメントだけを検査し、コードの文字列は見ない", () => {
    const text = [
      'const s = "することができる"',
      "// 設定を変更することができる"
    ].join("\n")
    expect(run("a.ts", text).map((v) => [v.ruleId, v.line])).toEqual([
      ["koto-dekiru", 2]
    ])
  })

  test("インラインコードとコードフェンスの中は違反にしない", () => {
    const text = [
      "`することができる` を探す。",
      "```",
      "することができる",
      "```"
    ]
    expect(run("a.md", text.join("\n"))).toEqual([])
  })

  test("「」か『』の中に収まる一致は違反にしない", () => {
    expect(ids("a.md", "「短縮することができる」のような癖を直す。")).toEqual(
      []
    )
    expect(ids("a.md", "『大切なのは』を使わない。")).toEqual([])
    // 入れ子の内側と、閉じた内側の括弧の後も外側の括弧の中とみなす
    expect(
      ids("a.md", "「型は『することができる』で、ことが可能 も同じ」と書く。")
    ).toEqual([])
    // 閉じていない括弧は行の終わりまでを中とみなす
    expect(ids("a.md", "「短縮することができる")).toEqual([])
  })

  test("「〜」を前に置いて型の名前として示した一致は違反にしない", () => {
    expect(ids("a.md", "〜することができる")).toEqual([])
    expect(ids("a.md", "型: 〜することができる / 〜ことが可能")).toEqual([])
    expect(ids("a.md", "| 〜することが可能 |")).toEqual([])
  })

  test("「〜」との間に空白や区切りがあれば違反にする", () => {
    expect(ids("a.md", "短縮することができる。")).toContain("koto-dekiru")
    expect(ids("a.md", "〜 することができる")).toContain("koto-dekiru")
    expect(ids("a.md", "〜、ことができる")).toContain("koto-dekiru")
    // 「〜」が一致の 4 字以上前にあるときは型の名前とみなさない
    expect(ids("a.md", "〜を短縮することができる")).toContain("koto-dekiru")
  })

  test("避ける語の「〜」で、一致が「」の外へ広がらない", () => {
    expect(ids("a.md", "「今回は〜紹介します」「大切なのは」")).toEqual([])
    expect(ids("a.md", "今回は新機能を紹介します。")).toContain(
      "avoid:今回は〜紹介します"
    )
  })

  test("括弧の外の一致は違反にする", () => {
    expect(
      ids("a.md", "「例」の後で短縮することができる。").filter(
        (id) => id === "koto-dekiru"
      )
    ).toHaveLength(1)
    // 括弧は行ごとに閉じる。前の行の開いた括弧は次の行に及ばない
    expect(ids("a.md", "「開いたまま\n短縮することができる。")).toContain(
      "koto-dekiru"
    )
  })

  test("HTML ではブロックの中の括弧で判定する", () => {
    expect(
      ids("a.html", "<p>「設定を変えることが<em>できる</em>」の型。</p>")
    ).toEqual([])
    expect(
      ids("a.html", "<p>「開いたまま</p><p>変えることができる。</p>")
    ).toEqual(["koto-dekiru"])
  })

  test("Markdown の > で始まる行(引用)は違反にしない", () => {
    expect(ids("a.md", "> 大切なのは判断を行うことができれば")).toEqual([])
  })

  test("対象外の拡張子は何も返さない", () => {
    expect(run("a.json", "することができる")).toEqual([])
  })
})

describe("lint: 解析器と ignore-file", () => {
  test("解析器を渡さないと、正規表現の層の規則の違反だけを返す", () => {
    const text = "時間を短縮することができる。\n\n大切なのは表れだ。"
    const got = lint({ path: "a.md", text }, { rules: RULES })
    expect(got.map((v) => v.ruleId)).toEqual([
      "koto-dekiru",
      "avoid:大切なのは"
    ])
    expect(
      lint({ path: "a.md", text }, { rules: RULES, analyzer: null })
    ).toEqual(got)
  })

  test("解析器を渡しても、正規表現の層の違反はそのまま返す", () => {
    const analyzer: Analyzer = { tokenize: () => [] }
    const got = lint(
      { path: "a.md", text: "短縮することができる。" },
      { rules: RULES, analyzer }
    )
    expect(got.map((v) => v.ruleId)).toContain("koto-dekiru")
  })

  test("ignore-file の目印を含むファイルは検査しない", () => {
    const text = "<!-- native-japanese: ignore-file -->\n短縮することができる。"
    expect(run("a.md", text)).toEqual([])
  })

  test("書き込み後のファイルに目印があれば、断片に違反があっても検査しない", () => {
    const whole = {
      path: "a.md",
      text: "<!-- native-japanese: ignore-file -->\n短縮することができる。"
    }
    expect(run("a.md", "短縮することができる。", whole)).toEqual([])
  })

  test("HTML 以外では、正規表現の層を書き込み後のファイルではなく渡した本文に当てる", () => {
    const whole = {
      path: "a.md",
      text: "既存のことが可能だ。\n短縮することができる。"
    }
    expect(
      run("a.md", "短縮することができる。", whole).map((v) => [
        v.ruleId,
        v.line
      ])
    ).toEqual([["koto-dekiru", 1]])
  })
})

describe("lint: HTML", () => {
  test("タグをまたいで当たり、元のファイルの行で報告する", () => {
    const text =
      "<html>\n<body>\n<p>設定を変えることが<em>できる</em>。</p>\n</body>"
    const got = run("a.html", text)
    expect(got).toHaveLength(1)
    expect(got[0]).toMatchObject({
      ruleId: "koto-dekiru",
      line: 3,
      endLine: 3,
      match: "ことができ"
    })
  })

  test("複数行にまたがる違反は line と endLine が違う", () => {
    const text = "<p>設定を変更すること\nができる。</p>"
    expect(run("a.html", text)).toMatchObject([
      { ruleId: "koto-dekiru", line: 1, endLine: 2 }
    ])
  })

  test("<code> の中は違反にしない", () => {
    expect(run("a.html", "<p><code>することができる</code></p>")).toEqual([])
  })

  test("実体参照を戻してから当てる", () => {
    const text =
      "<p>A&nbsp;&amp;&nbsp;B は、設定を変えるこ&#12392;が可能だ。</p>"
    expect(ids("a.html", text)).toEqual(["koto-dekiru"])
  })

  test("wholeFile があれば、そのブロックに当てる", () => {
    const whole = {
      path: "a.html",
      text: "<p>一行目</p>\n<p>設定を変更することが\n<em>できる</em>。</p>"
    }
    expect(
      run("a.html", "<em>できる</em>", whole).map((v) => [v.line, v.endLine])
    ).toEqual([[2, 3]])
  })
})

describe("lint: 形態素解析の層", () => {
  const FIXTURE: { text: string; tokens: ReturnType<Analyzer["tokenize"]> }[] =
    JSON.parse(
      fs.readFileSync(
        new URL("../../fixtures/morph/tokens.json", import.meta.url),
        "utf8"
      )
    )
  // 固定データの例文だけを知っている解析器。知らない本文には何も返さない
  const fake: Analyzer = {
    tokenize: (t) => FIXTURE.find((s) => s.text === t)?.tokens ?? []
  }
  const sentence = (n: number) => (FIXTURE[n - 1] as { text: string }).text

  test("形態素解析の違反が line と endLine を持ち、正規表現の層の違反と並ぶ", () => {
    const text = `${sentence(9)}\n\n${sentence(11)}\n`
    const got = lint({ path: "a.md", text }, { rules: RULES, analyzer: fake })
    expect(got.map((v) => [v.ruleId, v.line, v.endLine])).toEqual([
      ["koto-dekiru", 1, 1],
      ["bunmatsu-renzoku", 3, 3]
    ])
  })

  test("形態素解析の層は書き込み後のファイル全体の段落に当てる", () => {
    const whole = { path: "a.md", text: `${sentence(11)}\n\n${sentence(12)}\n` }
    const got = lint(
      { path: "a.md", text: sentence(12) },
      { rules: RULES, analyzer: fake, wholeFile: whole }
    )
    expect(got.map((v) => [v.ruleId, v.line])).toEqual([
      ["bunmatsu-renzoku", 1],
      ["bunmatsu-renzoku", 3]
    ])
  })

  test("編集範囲の外の文の違反は overlaps で落ちる", () => {
    const whole = { path: "a.md", text: `${sentence(11)}\n\n${sentence(12)}\n` }
    const [range] = findEditRanges(whole.text, [sentence(12)])
    const got = lint(
      { path: "a.md", text: sentence(12) },
      { rules: RULES, analyzer: fake, wholeFile: whole }
    ).filter((v) => overlaps(v, [range as { start: number; end: number }]))
    expect(got.map((v) => [v.ruleId, v.line])).toEqual([
      ["bunmatsu-renzoku", 3]
    ])
  })

  test("HTML でもブロックに形態素解析の規則を当てる", () => {
    const text = `<ul><li>${sentence(11)}</li></ul>\n<p>${sentence(11)}</p>\n`
    const got = lint({ path: "a.html", text }, { rules: RULES, analyzer: fake })
    // li はリストなので文末の連続を当てない
    expect(got.map((v) => [v.ruleId, v.line])).toEqual([
      ["bunmatsu-renzoku", 2]
    ])
  })

  test("ignore-file の目印があれば形態素解析の層も動かさない", () => {
    const text = `<!-- native-japanese: ignore-file -->\n${sentence(1)}\n`
    expect(
      lint({ path: "a.md", text }, { rules: RULES, analyzer: fake })
    ).toEqual([])
  })
})

describe("findEditRanges", () => {
  const file = "一行目\n二行目\n三行目\n四行目\n"

  test("本文を探し、1 始まりで両端を含む行の範囲を返す", () => {
    expect(
      findEditRanges(file, [
        "二行目\n三行目",
        "四行目",
        "一行目\n二行目\n三行目\n四行目\n"
      ])
    ).toEqual([
      { start: 2, end: 3 },
      { start: 4, end: 4 },
      { start: 1, end: 4 }
    ])
  })

  test("行の途中から始まる本文は、その行から数える", () => {
    expect(findEditRanges(file, ["目\n三"])).toEqual([{ start: 2, end: 3 }])
  })

  test("末尾の改行は次の行に数えない", () => {
    expect(findEditRanges(file, ["二行目\n"])).toEqual([{ start: 2, end: 2 }])
  })

  test("見つからない本文と空の本文は null", () => {
    expect(findEditRanges(file, ["五行目", "", "三行目"])).toEqual([
      null,
      null,
      { start: 3, end: 3 }
    ])
  })
})

describe("overlaps", () => {
  const v = (line: number, endLine: number): Violation => ({
    line,
    endLine,
    text: "",
    ruleId: "x",
    category: "x",
    match: "",
    advice: ""
  })

  test("範囲と 1 行でも重なれば真", () => {
    expect(overlaps(v(3, 5), [{ start: 4, end: 4 }])).toBe(true)
    expect(overlaps(v(4, 4), [{ start: 1, end: 9 }])).toBe(true)
  })

  test("範囲の端の行だけで重なっても真", () => {
    expect(overlaps(v(1, 3), [{ start: 3, end: 6 }])).toBe(true)
    expect(overlaps(v(6, 8), [{ start: 3, end: 6 }])).toBe(true)
  })

  test("どの範囲とも重ならなければ偽", () => {
    expect(
      overlaps(v(1, 2), [
        { start: 3, end: 6 },
        { start: 8, end: 9 }
      ])
    ).toBe(false)
    expect(
      overlaps(v(7, 7), [
        { start: 3, end: 6 },
        { start: 8, end: 9 }
      ])
    ).toBe(false)
    expect(overlaps(v(1, 1), [])).toBe(false)
  })
})
