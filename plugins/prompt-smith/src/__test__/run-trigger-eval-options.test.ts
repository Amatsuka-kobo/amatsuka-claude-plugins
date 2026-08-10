import { describe, expect, it } from "vitest"
import { parseEvalSet, parseNumericOption } from "../run-trigger-eval.js"

describe("parseEvalSet", () => {
  it("正常な配列を通す", () => {
    const input = [
      { query: "use the skill", should_trigger: true },
      { query: "use another tool", should_trigger: false }
    ]
    expect(parseEvalSet(JSON.stringify(input))).toEqual(input)
  })

  it("重複クエリで Error を投げる", () => {
    const input = [
      { query: "duplicate", should_trigger: true },
      { query: "duplicate", should_trigger: false }
    ]
    expect(() => parseEvalSet(JSON.stringify(input))).toThrow(
      "duplicate query in eval set: duplicate"
    )
  })

  it("配列でない JSON で Error を投げる", () => {
    expect(() => parseEvalSet('{"query":"not-an-array"}')).toThrow(
      "--eval-set must contain a JSON array"
    )
  })

  it.each([
    [{ should_trigger: true }],
    [{ query: "missing should_trigger" }]
  ])("必須フィールドを欠く要素で Error を投げる", (item) => {
    expect(() => parseEvalSet(JSON.stringify([item]))).toThrow(
      "invalid eval item at index 0"
    )
  })
})

describe("parseNumericOption", () => {
  it("正常な数値文字列を通す", () => {
    expect(parseNumericOption("timeout", "45", 30)).toBe(45)
  })

  it("数値でない文字列で Error を投げる", () => {
    expect(() => parseNumericOption("timeout", "not-a-number", 30)).toThrow(
      "--timeout must be a number"
    )
  })

  it("未指定なら既定値を返す", () => {
    expect(parseNumericOption("timeout", undefined, 30)).toBe(30)
  })
})
