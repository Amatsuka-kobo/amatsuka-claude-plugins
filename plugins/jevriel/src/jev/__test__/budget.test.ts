import { describe, expect, it } from "vitest"
import {
  bodyAllowance,
  estimateQuestion,
  estimateTokens,
  estimateValue,
  exceedsSoloLimit,
  JEV_CONCURRENCY,
  LONGEST_BUDGET,
  MAX_QUESTIONS_PER_BATCH,
  mapWithConcurrency,
  planBatches,
  QUESTION_OVERHEAD,
  TOTAL_BUDGET,
  truncateBody
} from "../budget.js"
import type { QuestionSpec } from "../client.js"

const noulQuestion: QuestionSpec = {
  type: "noul",
  instructions: "Is this true?"
}

describe("estimateTokens", () => {
  it("rounds UTF-8 bytes divided by 2.5 upward", () => {
    expect(estimateTokens("abcde")).toBe(2)
    expect(estimateTokens("日本")).toBe(3)
  })

  it("estimates strings directly and other values through JSON", () => {
    expect(estimateValue("abcde")).toBe(2)
    expect(estimateValue({ value: "日本" })).toBe(
      estimateTokens(JSON.stringify({ value: "日本" }))
    )
  })

  it("adds the fixed question overhead", () => {
    expect(estimateQuestion(noulQuestion)).toBe(
      estimateTokens("Is this true?") + QUESTION_OVERHEAD
    )
    expect(QUESTION_OVERHEAD).toBe(16)
  })
})

describe("planBatches", () => {
  it("starts a new batch when the total budget is exceeded", () => {
    const items = Array.from({ length: 52 }, (_, id) => id)
    const result = planBatches(items, {
      base: 0,
      itemState: () => 0,
      itemQuestion: () => 1000
    })

    expect(result.tooLarge).toEqual([])
    expect(result.batches.map((batch) => batch.length)).toEqual([51, 1])
    expect(TOTAL_BUDGET).toBe(51_200)
  })

  it("starts a new batch when the longest-question budget is exceeded", () => {
    const result = planBatches([1, 2, 3], {
      base: 0,
      itemState: () => 13_000,
      itemQuestion: () => 1
    })

    expect(result.batches).toEqual([[1], [2], [3]])
    expect(LONGEST_BUDGET).toBe(25_600)
  })

  it("starts a new batch at the 101st question", () => {
    const result = planBatches(
      Array.from({ length: 101 }, (_, id) => id),
      {
        base: 0,
        itemState: () => 0,
        itemQuestion: () => 1
      }
    )

    expect(result.batches.map((batch) => batch.length)).toEqual([
      MAX_QUESTIONS_PER_BATCH,
      1
    ])
  })

  it("marks an item that cannot fit an empty batch too large and continues", () => {
    const result = planBatches(["small-a", "large", "small-b"], {
      base: 0,
      itemState: (item) => (item === "large" ? LONGEST_BUDGET + 1 : 5),
      itemQuestion: () => 1
    })

    expect(result.batches).toEqual([["small-a"], ["small-b"]])
    expect(result.tooLarge).toEqual(["large"])
  })
})

describe("exceedsSoloLimit", () => {
  it("allows the exact longest-budget boundary and rejects one token over", () => {
    const questionTokens = estimateQuestion(noulQuestion)
    expect(
      exceedsSoloLimit(LONGEST_BUDGET - questionTokens, questionTokens)
    ).toBe(false)
    expect(
      exceedsSoloLimit(LONGEST_BUDGET - questionTokens + 1, questionTokens)
    ).toBe(true)
  })
})

describe("truncateBody", () => {
  it("preserves a body that fits", () => {
    const body = { message: "short" }
    expect(truncateBody(body, 100)).toEqual({ body, truncated: false })
    expect(truncateBody(body, 100).body).toBe(body)
  })

  it("truncates a long string and appends the omitted byte count", () => {
    const original = "x".repeat(500)
    const result = truncateBody(original, 30)

    expect(result.truncated).toBe(true)
    expect(typeof result.body).toBe("string")
    expect(result.body).toMatch(/\n\.\.\.\[truncated \d+ bytes\]$/)
    expect(estimateTokens(result.body as string)).toBeLessThanOrEqual(30)
  })

  it("serializes a JSON body to a string when truncating it", () => {
    const result = truncateBody({ message: "x".repeat(500) }, 30)

    expect(result.truncated).toBe(true)
    expect(typeof result.body).toBe("string")
    expect(result.body).toMatch(/\n\.\.\.\[truncated \d+ bytes\]$/)
  })

  it("returns a negative allowance when the state without body already exceeds budget", () => {
    const state = { context: "x".repeat(LONGEST_BUDGET * 3) }
    expect(bodyAllowance(state, { decision: noulQuestion })).toBeLessThan(0)
  })
})

describe("mapWithConcurrency", () => {
  it("limits concurrent work to four and returns results in input order", async () => {
    let active = 0
    let maximum = 0
    const items = Array.from({ length: 12 }, (_, index) => index)
    const results = await mapWithConcurrency(
      items,
      JEV_CONCURRENCY,
      async (item, index) => {
        active += 1
        maximum = Math.max(maximum, active)
        await new Promise((resolve) =>
          setTimeout(resolve, (5 - (index % 5)) * 2)
        )
        active -= 1
        return item * 2
      }
    )

    expect(maximum).toBe(4)
    expect(results).toEqual(items.map((item) => item * 2))
  })
})
