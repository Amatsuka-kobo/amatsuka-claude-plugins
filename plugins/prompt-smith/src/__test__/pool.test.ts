import { describe, expect, it } from "vitest"
import { pool } from "../lib/pool.js"

describe("pool", () => {
  it("入力の順序どおりに結果を返す", async () => {
    const out = await pool([10, 20, 30], 2, async (n) => n * 2)
    expect(out).toEqual([20, 40, 60])
  })

  it("同時実行数が上限を超えない", async () => {
    let running = 0
    let peak = 0
    await pool([1, 2, 3, 4, 5, 6], 2, async () => {
      running++
      peak = Math.max(peak, running)
      await new Promise((r) => setTimeout(r, 5))
      running--
      return null
    })
    expect(peak).toBeLessThanOrEqual(2)
  })

  it("空の入力で空を返す", async () => {
    expect(await pool([], 4, async () => 1)).toEqual([])
  })
})
