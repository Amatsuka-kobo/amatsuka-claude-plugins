import { expect, test } from "vitest"
import { computeStats } from "../lib/stats.js"

test("母標準偏差を計算する", () => {
  expect(computeStats([2, 4, 4, 4, 5, 5, 7, 9])).toEqual({
    mean: 5,
    stddev: 2,
    min: 2,
    max: 9
  })
})

test("1 要素の標準偏差は 0", () => {
  expect(computeStats([3])).toEqual({
    mean: 3,
    stddev: 0,
    min: 3,
    max: 3
  })
})

test("空配列は NaN を含まないゼロ統計を返す", () => {
  expect(computeStats([])).toEqual({
    mean: 0,
    stddev: 0,
    min: 0,
    max: 0
  })
})
