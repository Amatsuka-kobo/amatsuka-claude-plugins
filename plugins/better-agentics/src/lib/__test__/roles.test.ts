import { describe, expect, it } from "vitest"
import {
  CLAUDE_MODELS,
  EFFORTS,
  isClaudeModel,
  isEffort,
  ROLES,
  roleById,
  rolesFor
} from "../roles"

describe("ROLES", () => {
  it("設計書 §4-1 の 13 役割を表の順に持つ", () => {
    expect(ROLES.map((role) => role.id)).toEqual([
      "complex-impl",
      "normal-impl",
      "light-impl",
      "general",
      "explore",
      "realtime-research",
      "e2e-verify",
      "escalation",
      "design-review",
      "knowledge-elicitation",
      "code-review",
      "complex-review",
      "adversarial-review"
    ])
  })

  it("model・effort・reason・kind が表の値と一致する", () => {
    expect(roleById("knowledge-elicitation")).toMatchObject({
      kind: "readonly",
      model: "haiku",
      effort: "low",
      reason: "review"
    })
    expect(roleById("escalation")).toMatchObject({
      kind: "impl",
      model: "fable",
      effort: "high",
      reason: "stuck"
    })
    expect(roleById("e2e-verify")).toMatchObject({
      kind: "impl",
      model: "sonnet",
      effort: "high",
      reason: "split"
    })
    expect(roleById("complex-impl")).toMatchObject({
      model: "opus",
      effort: "medium"
    })
  })

  it("理由ごとの役割を表の順に返す", () => {
    expect(rolesFor("review").map((role) => role.id)).toEqual([
      "design-review",
      "knowledge-elicitation",
      "code-review",
      "complex-review",
      "adversarial-review"
    ])
    expect(rolesFor("stuck").map((role) => role.id)).toEqual(["escalation"])
    expect(rolesFor("split")).toHaveLength(7)
  })

  it("未知の ID は undefined を返す", () => {
    expect(roleById("final-review")).toBeUndefined()
  })

  it("モデルと effort の候補を判定する", () => {
    expect(CLAUDE_MODELS).toEqual(["sonnet", "opus", "haiku", "fable"])
    expect(EFFORTS).toEqual(["low", "medium", "high", "xhigh", "max"])
    expect(isClaudeModel("opus")).toBe(true)
    expect(isClaudeModel("inherit")).toBe(false)
    expect(isEffort("xhigh")).toBe(true)
    expect(isEffort("extreme")).toBe(false)
  })
})
