import { describe, expect, it } from "vitest"
import { orchestrationState, subagentPolicyApplies } from "../state"

function stateOf(env: NodeJS.ProcessEnv) {
  return orchestrationState(env).kind
}

describe("orchestrationState", () => {
  it("未設定・空・0・false・off は off", () => {
    expect(stateOf({})).toBe("off")
    for (const value of ["", "0", " FALSE ", "off"]) {
      expect(stateOf({ AMATSUKA_AGENT_ENABLE_ORCHESTRATION: value })).toBe(
        "off"
      )
    }
  })

  it("1・true・on 以外の値は unknown-value", () => {
    expect(
      orchestrationState({ AMATSUKA_AGENT_ENABLE_ORCHESTRATION: "yes" })
    ).toEqual({ kind: "unknown-value", value: "yes" })
  })

  it("AUTO_INJECTION が空でも none でもなければ conflict-injection", () => {
    expect(
      stateOf({
        AMATSUKA_AGENT_ENABLE_ORCHESTRATION: "1",
        AMATSUKA_AGENT_AUTO_INJECTION: "claude",
        TYPESAFE_API_KEY: "k"
      })
    ).toBe("conflict-injection")
    for (const injection of ["none", ""]) {
      expect(
        stateOf({
          AMATSUKA_AGENT_ENABLE_ORCHESTRATION: "1",
          AMATSUKA_AGENT_AUTO_INJECTION: injection,
          TYPESAFE_API_KEY: "k"
        })
      ).toBe("inject")
    }
  })

  it("DELEGATION_GATE が有効なら conflict-gate", () => {
    expect(
      stateOf({
        AMATSUKA_AGENT_ENABLE_ORCHESTRATION: "on",
        AMATSUKA_AGENT_DELEGATION_GATE: "true",
        TYPESAFE_API_KEY: "k"
      })
    ).toBe("conflict-gate")
  })

  it("キーが空白だけなら no-api-key、あれば inject", () => {
    expect(
      stateOf({
        AMATSUKA_AGENT_ENABLE_ORCHESTRATION: "true",
        TYPESAFE_API_KEY: "   "
      })
    ).toBe("no-api-key")
    expect(
      stateOf({
        AMATSUKA_AGENT_ENABLE_ORCHESTRATION: "true",
        TYPESAFE_API_KEY: "k"
      })
    ).toBe("inject")
  })

  it("上の行が先に当たる", () => {
    expect(
      stateOf({
        AMATSUKA_AGENT_ENABLE_ORCHESTRATION: "yes",
        AMATSUKA_AGENT_AUTO_INJECTION: "claude"
      })
    ).toBe("unknown-value")
  })
})

describe("subagentPolicyApplies", () => {
  it("inject と no-api-key のときだけ真", () => {
    expect(subagentPolicyApplies({ kind: "inject" })).toBe(true)
    expect(subagentPolicyApplies({ kind: "no-api-key" })).toBe(true)
    for (const kind of [
      "off",
      "conflict-injection",
      "conflict-gate"
    ] as const) {
      expect(subagentPolicyApplies({ kind })).toBe(false)
    }
    expect(subagentPolicyApplies({ kind: "unknown-value", value: "x" })).toBe(
      false
    )
  })
})
