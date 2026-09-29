import fs from "node:fs"
import { describe, expect, test } from "vitest"
import { loadAnalyzer } from "../../morph-runtime.js"
import { type Block, extractBlocks } from "../extract.js"
import type { Analyzer } from "../lint.js"
import { checkBlocks, splitSentences, toToken } from "../morph.js"

type Raw = { surface: string; details: string[] }
const FIXTURE: { text: string; tokens: Raw[] }[] = JSON.parse(
  fs.readFileSync(
    new URL("../../fixtures/morph/tokens.json", import.meta.url),
    "utf8"
  )
)

// 固定データの例文だけを知っている解析器。知らない本文を渡されたら、段落の組み方の誤りなので落とす
const fake: Analyzer = {
  tokenize(text) {
    const hit = FIXTURE.find((s) => s.text === text)
    if (!hit) throw new Error(`固定データに無い本文: ${text}`)
    return hit.tokens
  }
}

// sentences.txt の n 行目(1 始まり)
const sentence = (n: number) => (FIXTURE[n - 1] as { text: string }).text

function block(text: string, kind: Block["kind"] = "prose"): Block {
  return { kind, text, lineOf: [...text].map(() => 1) }
}

function ruleIds(n: number, kind: Block["kind"] = "prose"): string[] {
  return checkBlocks([block(sentence(n), kind)], fake).map((v) => v.ruleId)
}

// sentences.txt の各行に当たる規則。空の配列はどの規則にも当たらない行
const EXPECTED: Record<number, string[]> = {
  1: ["muse-shugo"],
  2: ["muse-shugo"], // 人を指す普通名詞の主語。誤検知として残ると設計書が認めた例
  3: ["muse-shugo"],
  4: [],
  5: [],
  6: [],
  7: [],
  8: [],
  9: [],
  10: [],
  11: ["bunmatsu-renzoku"],
  12: ["bunmatsu-renzoku"],
  13: [],
  14: [],
  15: [],
  16: [],
  17: ["bun-nagasa"],
  18: [],
  19: ["bun-nagasa"],
  20: [],
  21: [],
  22: [],
  23: [],
  24: [],
  25: ["rentai-kasanari"],
  26: [],
  27: [],
  28: [],
  29: ["rentai-kasanari"],
  30: [],
  31: []
}

test("固定データは sentences.txt と同じ行数で、表がすべての行を覆う", () => {
  const lines = fs
    .readFileSync(
      new URL("../../fixtures/morph/sentences.txt", import.meta.url),
      "utf8"
    )
    .split("\n")
    .filter((l) => l !== "")
  expect(FIXTURE.map((s) => s.text)).toEqual(lines)
  expect(Object.keys(EXPECTED).map(Number)).toEqual(lines.map((_, i) => i + 1))
})

describe("toToken", () => {
  test("details の添字を自前の名前に付け替える", () => {
    const suru = FIXTURE.flatMap((s) => s.tokens).find(
      (t) => t.surface === "する" && t.details[5] === "基本形"
    ) as Raw
    expect(toToken(suru)).toEqual({
      surface: "する",
      pos: "動詞",
      pos1: "自立",
      pos2: "*",
      conjType: "サ変・スル",
      conjForm: "基本形",
      base: "する"
    })
  })

  test("details が短い未知語でも空文字で埋める", () => {
    expect(toToken({ surface: "x", details: ["UNK"] })).toMatchObject({
      pos: "UNK",
      pos1: "",
      conjForm: "",
      base: ""
    })
  })
})

describe("checkBlocks: 固定データの例文ごとの判定", () => {
  test.each(
    Object.entries(EXPECTED).map(([n, ids]) => [Number(n), ids] as const)
  )("%i 行目に当たる規則は %j", (n, ids) => {
    expect(ruleIds(n)).toEqual(ids)
  })
})

describe("checkBlocks: muse-shugo", () => {
  test("「こと」の節を目的語にとる「示す」系の述語に当たる", () => {
    expect(ruleIds(1)).toContain("muse-shugo")
    expect(ruleIds(3)).toContain("muse-shugo") // サ変接続の名詞と「する」を合わせた「意味する」
  })

  test("「こと」の節でない目的語と、述部の中心が別の動詞の文に当たらない", () => {
    expect(ruleIds(4)).toEqual([])
    expect(ruleIds(5)).toEqual([])
    expect(ruleIds(6)).toEqual([]) // 述部の中心は「ある」
  })

  test("例外は述語に最も近い「は」の直前の名詞だけで判定する", () => {
    expect(ruleIds(7)).toEqual([]) // 人名
    // 「この事実は」を持つが、述語に最も近い「は」の直前は代名詞の「彼」
    expect(ruleIds(8)).toEqual([])
  })

  // 1 行目の形態素の列の、先頭の「この事実は」を差し替えて判定する
  function museWith(subject: Raw[]): string[] {
    const tokens = [
      ...subject,
      ...(FIXTURE[0] as { tokens: Raw[] }).tokens.slice(3)
    ]
    const text = tokens.map((t) => t.surface).join("")
    return checkBlocks([block(text)], { tokenize: () => tokens }).map(
      (v) => v.ruleId
    )
  }
  const noun = (surface: string, pos1 = "一般"): Raw => ({
    surface,
    details: ["名詞", pos1, "*", "*", "*", "*", surface]
  })
  const particle = (surface: string, pos1: string): Raw => ({
    surface,
    details: ["助詞", pos1, "*", "*", "*", "*", surface]
  })

  test("「は」が無く「が」で受けた名詞だけでも当たる", () => {
    expect(museWith([noun("事実"), particle("が", "格助詞")])).toEqual([
      "muse-shugo"
    ])
  })

  test("代名詞に分類されない語でも、一覧の表層なら当てない", () => {
    expect(museWith([noun("私"), particle("は", "係助詞")])).toEqual([])
  })

  test("category と advice は設計書のとおり", () => {
    const [v] = checkBlocks([block(sentence(1))], fake)
    expect(v).toMatchObject({ category: "翻訳調" })
    expect(v?.advice).toContain("と分かる")
  })
})

describe("checkBlocks: bunmatsu-renzoku", () => {
  test("同じ文末表現の 3 文には当たらず、4 文目で当たる", () => {
    expect(ruleIds(10)).toEqual([])
    const [v] = checkBlocks([block(sentence(11))], fake)
    expect(v?.text).toBe("影響は限定的である。")
    expect(v?.match).toBe("影響は限定的である。")
  })

  test("5 文続いても同じ連続からは 1 件だけ", () => {
    expect(ruleIds(12)).toEqual(["bunmatsu-renzoku"])
  })

  test("文末表現が空か 1 字の文で連続が切れる", () => {
    expect(ruleIds(14)).toEqual([]) // 「読む」「書く」の文末表現は空
    expect(ruleIds(15)).toEqual([]) // 「だ」「た」は 1 字
    expect(ruleIds(16)).toEqual([]) // 3 文目の「消す」で切れ、そこから 2 文だけ続く
  })

  test("リストの項目には当てない", () => {
    expect(ruleIds(11, "list")).toEqual([])
  })
})

describe("checkBlocks: bun-nagasa", () => {
  test("99 字の文には当たらず、100 字の文に当たる", () => {
    expect(ruleIds(18)).toEqual([])
    expect(ruleIds(19)).toEqual(["bun-nagasa"])
  })

  test("節の切れ目が 1 つだけの長い文に当たらない", () => {
    expect(ruleIds(20)).toEqual([])
  })

  test("「は、」の読点と名詞の列挙の読点を節の切れ目に数えない", () => {
    expect(ruleIds(21)).toEqual([])
    expect(ruleIds(22)).toEqual([])
  })

  test("category は「文」で、match は文の先頭 20 字", () => {
    const [v] = checkBlocks([block(sentence(17))], fake)
    expect(v).toMatchObject({
      ruleId: "bun-nagasa",
      category: "文",
      match: [...sentence(17)].slice(0, 20).join("")
    })
  })
})

describe("checkBlocks: rentai-kasanari", () => {
  test("修飾の節が 2 つある区間は、29 字で当たらず 30 字で当たる", () => {
    expect(ruleIds(23)).toEqual([]) // 27 字
    expect(ruleIds(24)).toEqual([]) // 29 字
    expect(ruleIds(25)).toEqual(["rentai-kasanari"]) // 30 字
  })

  test("「とき」と「場合」を修飾される名詞に数えない", () => {
    expect(ruleIds(26)).toEqual([])
    expect(ruleIds(27)).toEqual([])
  })

  test("「静かな部屋」を修飾の節に数えない", () => {
    expect(ruleIds(28)).toEqual([])
  })

  test("「事実」と「結果」を修飾される名詞として数える", () => {
    expect(ruleIds(29)).toEqual(["rentai-kasanari"])
  })
})

describe("checkBlocks: ブロックの種類と位置", () => {
  test("見出しと表は形態素解析の規則にかけない", () => {
    expect(ruleIds(1, "heading")).toEqual([])
    expect(ruleIds(17, "table")).toEqual([])
  })

  test("コメントには 4 規則すべてを当てる", () => {
    expect(ruleIds(1, "comment")).toEqual(["muse-shugo"])
    expect(ruleIds(11, "comment")).toEqual(["bunmatsu-renzoku"])
  })

  test("違反した文が始まる行を line、終わる行を endLine にする", () => {
    // 17 行目の文を「ので、」の後で折り返した 2 行の段落
    const text = sentence(17)
    const cut = text.indexOf("形態素解析の規則")
    const md = `前置きの行。\n\n${text.slice(0, cut)}\n${text.slice(cut)}\n`
    const [v] = checkBlocks(extractBlocks({ path: "a.md", text: md }), {
      tokenize: (t) => (t === text ? fake.tokenize(t) : [])
    })
    expect(v).toMatchObject({ ruleId: "bun-nagasa", line: 3, endLine: 4 })
  })
})

describe("置き換えの 1 字", () => {
  test("インラインコードを置き換えた字が、名詞として解析される", () => {
    const [b] = extractBlocks({ path: "a.md", text: "設定は `foo` で変える。" })
    expect(b?.text).toBe(sentence(30))
    for (const n of [30, 31]) {
      const ph = (FIXTURE[n - 1] as { tokens: Raw[] }).tokens
        .map(toToken)
        .filter((t) => t.surface === "甲")
      expect(ph.length).toBeGreaterThan(0)
      for (const t of ph) expect(t.pos).toBe("名詞")
    }
  })
})

describe("splitSentences", () => {
  test("「。」「！」「？」で区切り、区切りが無ければ終わりまでを 1 文とする", () => {
    const text = "一つ目。 二つ目！三つ目？四つ目"
    expect(splitSentences(text).map((r) => text.slice(r.start, r.end))).toEqual(
      ["一つ目。", "二つ目！", "三つ目？", "四つ目"]
    )
  })

  test("空白だけの残りは文に数えない", () => {
    expect(splitSentences("一つ目。 ")).toHaveLength(1)
  })
})

// 実物の lindera で、固定データと規則の判定が変わらないかを確かめる。取得済みの開発機でだけ動かす
describe.skipIf(!process.env.NATIVE_JAPANESE_MORPH_DIR)(
  "実物の lindera との突き合わせ",
  () => {
    const real = loadAnalyzer(process.env.NATIVE_JAPANESE_MORPH_DIR)

    test("解析器を読み込める", () => {
      expect(real).not.toBeNull()
    })

    test("固定データの例文を解析し直すと、固定データと一致する", () => {
      for (const s of FIXTURE) {
        const got = (real as Analyzer)
          .tokenize(s.text)
          .map((t) => ({ surface: t.surface, details: [...t.details] }))
        expect(got, s.text).toEqual(s.tokens)
      }
    })

    test("4 規則の違反が固定データのときと同じになる", () => {
      for (const s of FIXTURE) {
        const b = [block(s.text)]
        expect(checkBlocks(b, real as Analyzer), s.text).toEqual(
          checkBlocks(b, fake)
        )
      }
    })
  }
)
