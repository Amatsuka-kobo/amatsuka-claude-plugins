import { describe, expect, it } from "vitest"
import { vocabularyFor } from "../vocabulary"

describe("vocabularyFor", () => {
  it("ja は日本語の見出しと約物を返す", () => {
    const vocabulary = vocabularyFor("ja")
    expect(vocabulary.bodyOrder).toContain("## 作業手順")
    expect(vocabulary.constraintHeading).toBe("## 制約")
    expect(vocabulary.listSeparator).toBe("、")
    expect(vocabulary.quote("実装")).toBe("「実装」")
    expect(vocabulary.describe("実装")).toBe(
      "Use this agent when 実装を委譲するとき。詳細は本文の「When to invoke」を参照。"
    )
  })

  it("en は英語の見出しと約物を返す", () => {
    const vocabulary = vocabularyFor("en")
    expect(vocabulary.bodyOrder).toContain("## Procedure")
    expect(vocabulary.constraintHeading).toBe("## Constraints")
    expect(vocabulary.listSeparator).toBe(", ")
    expect(vocabulary.quote("implementation")).toBe('"implementation"')
    expect(vocabulary.describe("implementation")).toBe(
      'Use this agent when delegating implementation. See "When to invoke" below for details.'
    )
  })

  it("ja と en 以外は en の語彙を返す", () => {
    expect(vocabularyFor("de").bodyOrder).toEqual(vocabularyFor("en").bodyOrder)
    expect(vocabularyFor("de").listSeparator).toBe(", ")
  })
})
