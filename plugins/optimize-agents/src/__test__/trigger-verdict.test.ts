import { expect, test } from "vitest"
import { isPassingTriggerRate } from "../lib/trigger-verdict.js"

test.each([
  { shouldTrigger: true, rate: 1, expected: true },
  { shouldTrigger: true, rate: 0.5, expected: true },
  { shouldTrigger: true, rate: 0.4, expected: false },
  { shouldTrigger: true, rate: 0, expected: false },
  { shouldTrigger: false, rate: 0, expected: true },
  { shouldTrigger: false, rate: 0.1, expected: false },
  { shouldTrigger: false, rate: 1, expected: false }
])("should_trigger=$shouldTrigger, 発火率=$rate の合否は $expected", ({
  shouldTrigger,
  rate,
  expected
}) => {
  expect(isPassingTriggerRate(shouldTrigger, rate)).toBe(expected)
})
