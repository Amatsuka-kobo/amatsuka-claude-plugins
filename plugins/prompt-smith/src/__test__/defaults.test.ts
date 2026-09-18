import { describe, expect, it } from "vitest"
import {
  bytesPerChar,
  lengthLimitsFor,
  MULTIBYTE_LENGTH_LIMITS,
  SINGLEBYTE_LENGTH_LIMITS
} from "../lib/defaults.js"

describe("bytesPerChar", () => {
  it("1バイト文字だけの文字列では1を返す", () => {
    expect(bytesPerChar("abc")).toBe(1)
  })

  it("多バイト文字を含む文字列では1より大きい値を返す", () => {
    expect(bytesPerChar("あいう")).toBeGreaterThan(1)
  })

  it("空文字では1を返す", () => {
    expect(bytesPerChar("")).toBe(1)
  })
})

describe("lengthLimitsFor", () => {
  it("1バイト文字だけの説明文には単一バイト用の上限を返す", () => {
    expect(lengthLimitsFor("description")).toBe(SINGLEBYTE_LENGTH_LIMITS)
  })

  it("多バイト文字を主とする説明文には多バイト用の上限を返す", () => {
    expect(lengthLimitsFor("説明文です")).toBe(MULTIBYTE_LENGTH_LIMITS)
  })
})
