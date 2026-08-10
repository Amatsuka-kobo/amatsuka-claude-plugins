import { describe, expect, it } from "vitest"
import { mulberry32, splitEvalSet } from "../lib/split-eval-set.js"

const makeSet = (positives: number, negatives: number) => [
  ...Array.from({ length: positives }, (_, i) => ({
    query: `pos-${i}`,
    should_trigger: true
  })),
  ...Array.from({ length: negatives }, (_, i) => ({
    query: `neg-${i}`,
    should_trigger: false
  }))
]

describe("mulberry32", () => {
  it("同じ seed なら同じ列を返す", () => {
    const a = mulberry32(42)
    const b = mulberry32(42)
    expect([a(), a(), a()]).toEqual([b(), b(), b()])
  })

  it("違う seed なら違う列を返す", () => {
    expect(mulberry32(1)()).not.toBe(mulberry32(2)())
  })

  it("0 以上 1 未満を返す", () => {
    const rand = mulberry32(7)
    for (let i = 0; i < 100; i++) {
      const value = rand()
      expect(value).toBeGreaterThanOrEqual(0)
      expect(value).toBeLessThan(1)
    }
  })
})

describe("splitEvalSet", () => {
  it("holdout の割合で分ける", () => {
    const { train, test } = splitEvalSet(makeSet(10, 10), 0.4)
    expect(test).toHaveLength(8)
    expect(train).toHaveLength(12)
  })

  it("両群から test を取る", () => {
    const { test } = splitEvalSet(makeSet(10, 10), 0.4)
    expect(test.filter((e) => e.should_trigger)).toHaveLength(4)
    expect(test.filter((e) => !e.should_trigger)).toHaveLength(4)
  })

  it("割合が小さくても各群から最低 1 問を test に入れる", () => {
    const { test } = splitEvalSet(makeSet(3, 3), 0.1)
    expect(test.filter((e) => e.should_trigger)).toHaveLength(1)
    expect(test.filter((e) => !e.should_trigger)).toHaveLength(1)
  })

  it("同じ入力と seed なら同じ分割になる", () => {
    const set = makeSet(10, 10)
    const a = splitEvalSet(set, 0.4)
    const b = splitEvalSet(set, 0.4)
    expect(a.test.map((e) => e.query)).toEqual(b.test.map((e) => e.query))
  })

  it("train と test の和が元の集合と一致する", () => {
    const set = makeSet(10, 10)
    const { train, test } = splitEvalSet(set, 0.4)
    expect([...train, ...test].map((e) => e.query).sort()).toEqual(
      set.map((e) => e.query).sort()
    )
  })

  it("シャッフルを通っている", () => {
    // 固定 seed の結果が偶然入力順と一致しうるので、seed を変えて 3 回試し、
    // 1 回でも入力順と違えばシャッフルが効いているとみなす。
    const set = makeSet(10, 10)
    const heads = [1, 2, 3].map((seed) =>
      splitEvalSet(set, 0.4, seed)
        .test.map((e) => e.query)
        .join(",")
    )
    const inputOrder = "pos-0,pos-1,pos-2,pos-3,neg-0,neg-1,neg-2,neg-3"
    expect(heads.some((order) => order !== inputOrder)).toBe(true)
  })

  it("入力を壊さない", () => {
    const set = makeSet(4, 4)
    const before = set.map((e) => e.query)
    splitEvalSet(set, 0.4)
    expect(set.map((e) => e.query)).toEqual(before)
  })
})
