import { createHash } from "node:crypto"
import { describe, expect, it } from "vitest"
import {
  computeDigest,
  DIGEST_SCHEMA_VERSION,
  digestSimilarity,
  normalizeText
} from "../digest"

const MAX32 = 2 ** 32 - 1

describe("正規化", () => {
  it("NFC・空白の圧縮・前後の除去・小文字化を行う", () => {
    expect(normalizeText("  Hello \n\t  World  ")).toBe("hello world")
    // 合成済みの「が」と、「か」+ 濁点は NFC で同じになる
    expect(normalizeText("が")).toBe("が")
  })

  it("NFC の違いは同じダイジェストになる", () => {
    expect(computeDigest("がきくけこ")).toEqual(computeDigest("がきくけこ"))
  })

  it("sha256 は正規化後の本文で取る", () => {
    const d = computeDigest("ABC")
    expect(d.sha256).toBe(createHash("sha256").update("abc").digest("hex"))
    expect(computeDigest("  abc\n").sha256).toBe(d.sha256)
  })
})

describe("署名", () => {
  it("128 個の 32 bit の整数と schemaVersion を持つ", () => {
    const d = computeDigest("これは署名の長さを確かめる本文です")
    expect(d.schemaVersion).toBe(DIGEST_SCHEMA_VERSION)
    expect(d.signature).toHaveLength(128)
    for (const v of d.signature) {
      expect(Number.isInteger(v)).toBe(true)
      expect(v).toBeGreaterThanOrEqual(0)
      expect(v).toBeLessThanOrEqual(MAX32)
    }
  })

  it("定数を固定した署名の値が変わらない(変えたら schemaVersion を上げる)", () => {
    const d = computeDigest("Hello, Raguel! 日本語のテキスト")
    expect(d.sha256).toBe(
      "874526f9205a8ef823bb162242dcb223dd356fc97ab1e2b01b033727cf43cf7a"
    )
    expect(d.signature.slice(0, 4)).toEqual([
      169063135, 230591718, 37588604, 198952518
    ])
    expect(d.signature.slice(-2)).toEqual([276154998, 29210277])
    expect(d.signature.reduce((a, b) => a + b, 0)).toBe(25576047555)

    const abc = computeDigest("abc")
    expect(abc.sha256).toBe(
      "ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad"
    )
    expect(abc.signature.slice(0, 4)).toEqual([
      245511616, 2474636465, 3118637631, 3817346540
    ])
  })

  it("5 コードポイント未満は全体を 1 つの 5-gram として扱う", () => {
    // 1 つの 5-gram なら、5 コードポイントちょうどの同じ文字列と署名の作り方が同じになる
    expect(computeDigest("abcd").signature).not.toEqual(
      new Array(128).fill(MAX32)
    )
    expect(computeDigest("abcd").signature).not.toEqual(
      computeDigest("abcde").signature
    )
    expect(computeDigest("a").signature).not.toEqual(
      computeDigest("b").signature
    )
  })

  it("5-gram はコードポイント単位で取る(サロゲートペアを割らない)", () => {
    // 絵文字 5 個は 10 コード単位だが 5 コードポイントで、5-gram は 1 つだけになる
    const five = computeDigest("😀😁😂🤣😃")
    const six = computeDigest("😀😁😂🤣😃😄")
    // 6 個なら 5-gram は 2 つで、最初の 5-gram は共通なので署名の一部が一致する
    expect(digestSimilarity(five, six)).toBeGreaterThan(0)
    expect(digestSimilarity(five, six)).toBeLessThan(1)
  })

  it("空の本文と空白だけの本文は、128 個すべてが 2^32 - 1 になる", () => {
    for (const t of ["", "  \n\t "]) {
      const d = computeDigest(t)
      expect(d.signature).toEqual(new Array(128).fill(MAX32))
      expect(d.sha256).toBe(createHash("sha256").update("").digest("hex"))
    }
  })
})

describe("類似度", () => {
  const base =
    "The quick brown fox jumps over the lazy dog. ".repeat(20) +
    "日本語の文章も混ぜておく。".repeat(10)

  it("同じ本文で 1 になる", () => {
    expect(digestSimilarity(computeDigest(base), computeDigest(base))).toBe(1)
  })

  it("空同士も 1 になる", () => {
    expect(digestSimilarity(computeDigest(""), computeDigest(""))).toBe(1)
  })

  it("少し変えた本文は高く、無関係な本文は低い", () => {
    const near = digestSimilarity(
      computeDigest(base),
      computeDigest(`${base} 追記`)
    )
    const far = digestSimilarity(
      computeDigest(base),
      computeDigest("zzzzyyyyxxxx 全く別の内容です。 0123456789 ".repeat(20))
    )
    expect(near).toBeGreaterThan(0.8)
    expect(far).toBeLessThan(0.2)
  })

  it("値は 位置の一致数 ÷ 128 になる", () => {
    const a = computeDigest("abc")
    const b = {
      ...a,
      signature: a.signature.map((v, i) => (i < 32 ? v + 1 : v))
    }
    expect(digestSimilarity(a, b)).toBe(96 / 128)
  })

  it("schemaVersion が違うダイジェストは比べず null を返す", () => {
    const a = computeDigest("abc")
    expect(
      digestSimilarity(a, { ...a, schemaVersion: a.schemaVersion + 1 })
    ).toBeNull()
  })
})
