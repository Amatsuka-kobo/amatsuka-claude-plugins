import { expect, test } from "vitest"
import { labelWidth } from "../geometry.js"

test("labelWidth は全角を 12、それ以外を 7 として数える", () => {
  expect(labelWidth("HTTPS")).toBe(5 * 7 + 16)
  expect(labelWidth("権限の確認と実行の依頼")).toBe(11 * 12 + 16)
  expect(labelWidth("専用DBの読み書き")).toBe(7 * 12 + 2 * 7 + 16)
})

test("labelWidth は下限より狭くならない", () => {
  expect(labelWidth("")).toBe(48)
  expect(labelWidth("1:N", 56)).toBe(56)
})
