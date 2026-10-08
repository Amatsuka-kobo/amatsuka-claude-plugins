// 2 変数の判定(`harness-docs/design/2026-10-08-metatron-adr-gotchas-opt-in-design.md` §2)。
// 値を trim して小文字にし、1 / true / on のどれかなら有効。未設定・空・それ以外は無効。

import { expect, test } from "vitest"
import { ADR_ENV, GOTCHAS_ENV, readFeatures } from "../features.js"

const TRUTHY = ["1", "true", "on", "TRUE", "On", " 1 ", "\ttrue\n"]
const FALSY = [undefined, "", " ", "0", "false", "off", "yes", "2", "enabled"]

test("F1: 1 / true / on は大文字小文字と前後の空白を問わず有効", () => {
  for (const value of TRUTHY) {
    expect(readFeatures({ [ADR_ENV]: value }).adr, JSON.stringify(value)).toBe(
      true
    )
    expect(
      readFeatures({ [GOTCHAS_ENV]: value }).gotchas,
      JSON.stringify(value)
    ).toBe(true)
  }
})

test("F2: 未設定・空・それ以外の値は無効", () => {
  for (const value of FALSY) {
    expect(
      readFeatures({ [ADR_ENV]: value, [GOTCHAS_ENV]: value }),
      JSON.stringify(value)
    ).toEqual({ adr: false, gotchas: false })
  }
})

test("F3: 2 変数は互いに独立に判定する", () => {
  expect(readFeatures({ [ADR_ENV]: "1" })).toEqual({
    adr: true,
    gotchas: false
  })
  expect(readFeatures({ [GOTCHAS_ENV]: "on" })).toEqual({
    adr: false,
    gotchas: true
  })
  expect(readFeatures({})).toEqual({ adr: false, gotchas: false })
})
