import { expect, test } from "vitest"
import { pool } from "../lib/pool.js"

test("入力順で結果を返し、同時実行数を limit 以下に保つ", async () => {
  let active = 0
  let maxActive = 0
  const results = await pool([30, 5, 20, 10], 2, async (item, index) => {
    active++
    maxActive = Math.max(maxActive, active)
    await new Promise((resolve) => setTimeout(resolve, item))
    active--
    return `${index}:${item}`
  })

  expect(results).toEqual(["0:30", "1:5", "2:20", "3:10"])
  expect(maxActive).toBe(2)
})

test("空配列では fn を呼ばず空配列を返す", async () => {
  let called = false
  const results = await pool([], 4, async () => {
    called = true
    return true
  })
  expect(results).toEqual([])
  expect(called).toBe(false)
})
