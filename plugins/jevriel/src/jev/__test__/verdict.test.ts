import { describe, expect, it } from "vitest"
import {
  judge,
  scoreLevel,
  type Thresholds,
  validateThresholds
} from "../verdict.js"

const thresholds: Thresholds = { satisfied: 0.8, unsatisfied: 0.2 }

describe("judge", () => {
  it("uses inclusive satisfied and unsatisfied boundaries", () => {
    expect(judge(0.8, thresholds)).toEqual({
      probability: 0.8,
      verdict: "satisfied"
    })
    expect(judge(0.2, thresholds)).toEqual({
      probability: 0.2,
      verdict: "unsatisfied"
    })
    expect(judge(0.5, thresholds)).toEqual({
      probability: 0.5,
      verdict: "uncertain"
    })
  })
})

describe("validateThresholds", () => {
  it("returns a reason when unsatisfied is not below satisfied", () => {
    expect(validateThresholds({ satisfied: 0.5, unsatisfied: 0.5 })).toEqual(
      expect.any(String)
    )
    expect(validateThresholds({ satisfied: 0.4, unsatisfied: 0.6 })).toEqual(
      expect.any(String)
    )
    expect(validateThresholds(thresholds)).toBeNull()
  })
})

describe("scoreLevel", () => {
  it("rounds scores to the nearest level", () => {
    const levels = ["zero", "one", "two", "three", "four"]
    expect(scoreLevel(2.4, levels)).toEqual({ level: 2, label: "two" })
    expect(scoreLevel(2.5, levels)).toEqual({ level: 3, label: "three" })
  })
})
