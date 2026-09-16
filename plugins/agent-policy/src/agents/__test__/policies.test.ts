import { describe, expect, it } from "vitest"
import {
  ASSIGNMENTS,
  allowsAgentTool,
  CLAUDE_ENUM_MODELS,
  candidateScopeFor,
  isCustomInjection,
  MODELS,
  type ModelId,
  modelById,
  modelsFor,
  POLICIES,
  policyForInjection,
  RECOMMENDED,
  rolesFor,
  runsOnClaude
} from "../policies"
import { ROLES, type RoleId } from "../roles"

const EXPECTED_CLAUDE_ASSIGNMENTS: Record<RoleId, ModelId[]> = {
  "complex-impl": ["opus"],
  "normal-impl": ["sonnet"],
  "light-impl": ["haiku"],
  escalation: ["fable"],
  general: ["sonnet"],
  "design-plan": ["opus"],
  "doc-writing": ["sonnet"],
  "explore-lead": ["opus"],
  explore: ["sonnet"],
  "realtime-research": ["sonnet"],
  "e2e-verify": ["sonnet"],
  "independent-review": ["sonnet"],
  "doc-review": ["haiku"],
  "code-review": ["sonnet"],
  "final-review": ["fable"],
  "gate-review": ["fable"],
  advisor: ["fable"]
}

const EXPECTED_RECOMMENDED: Record<RoleId, ModelId[]> = {
  "complex-impl": ["opus", "gpt-sol"],
  "normal-impl": ["sonnet", "gpt-luna", "grok"],
  "light-impl": ["haiku", "gpt-luna", "grok"],
  escalation: ["fable", "gpt-astra"],
  general: ["sonnet", "gpt-luna"],
  "design-plan": ["opus"],
  "doc-writing": ["sonnet", "gemini-flash", "gpt-terra"],
  "explore-lead": ["opus"],
  explore: ["sonnet", "grok", "gpt-terra"],
  "realtime-research": ["sonnet", "grok"],
  "e2e-verify": ["sonnet", "gpt-astra"],
  "independent-review": ["sonnet", "grok"],
  "doc-review": ["haiku"],
  "code-review": ["sonnet"],
  "final-review": ["fable", "gpt-astra"],
  "gate-review": ["fable", "gpt-astra"],
  advisor: ["fable", "gpt-astra"]
}

const EXPECTED_AGENT_TOOL: Record<RoleId, boolean> = {
  "complex-impl": true,
  "normal-impl": true,
  "light-impl": true,
  escalation: true,
  general: true,
  "design-plan": true,
  "doc-writing": false,
  "explore-lead": true,
  explore: true,
  "realtime-research": true,
  "e2e-verify": true,
  "independent-review": true,
  "doc-review": false,
  "code-review": false,
  "final-review": false,
  "gate-review": false,
  advisor: false
}

function sortedRoleIds(value: Record<RoleId, ModelId[]>): RoleId[] {
  return (Object.keys(value) as RoleId[]).sort()
}

const ALL_ROLE_IDS = ROLES.map((role) => role.id).sort()

describe("POLICIES", () => {
  it("claude と custom の 2 プロファイルだけを公開する", () => {
    expect(POLICIES).toEqual([
      {
        id: "claude-model-policy",
        label: "Claude のみ",
        injection: "claude"
      },
      {
        id: "custom-policy",
        label: "カスタム(role-id)",
        injection: "custom"
      }
    ])
  })
})

describe("ASSIGNMENTS", () => {
  it("claude-model-policy だけに現行の全 17 役割を保持する", () => {
    expect(Object.keys(ASSIGNMENTS)).toEqual(["claude-model-policy"])
    expect(sortedRoleIds(ASSIGNMENTS["claude-model-policy"])).toEqual(
      ALL_ROLE_IDS
    )
    expect(ASSIGNMENTS["claude-model-policy"]).toEqual(
      EXPECTED_CLAUDE_ASSIGNMENTS
    )
  })
})

describe("RECOMMENDED", () => {
  it("custom プロファイル向け推奨が全 17 役割と固定値を持つ", () => {
    expect(sortedRoleIds(RECOMMENDED)).toEqual(ALL_ROLE_IDS)
    expect(RECOMMENDED).toEqual(EXPECTED_RECOMMENDED)
  })
})

describe("MODELS", () => {
  it("10 モデルを定義する", () => {
    expect(MODELS).toHaveLength(10)
  })

  it("color が公式の 8 色から選ばれている", () => {
    const allowed = [
      "red",
      "blue",
      "green",
      "yellow",
      "purple",
      "orange",
      "pink",
      "cyan"
    ]
    for (const model of MODELS) {
      expect(allowed, model.id).toContain(model.color)
    }
  })

  it("gpt-astra が GPT 系の末尾に指定値で定義される", () => {
    expect(MODELS.at(7)).toEqual({
      id: "gpt-astra",
      vendor: "gpt",
      label: "GPT Astra",
      defaultName: "gpt-astra",
      model: "claude-gpt-6-astra",
      color: "yellow"
    })
    expect(MODELS.at(8)?.id).toBe("grok")
  })

  it("MODELS の ID が定義順で全件一致する", () => {
    expect(MODELS.map((model) => model.id)).toEqual([
      "opus",
      "sonnet",
      "haiku",
      "fable",
      "gpt-sol",
      "gpt-terra",
      "gpt-luna",
      "gpt-astra",
      "grok",
      "gemini-flash"
    ])
  })

  it("gemini-flash が指定値で定義される", () => {
    expect(modelById("gemini-flash")).toEqual({
      id: "gemini-flash",
      vendor: "gemini",
      label: "Gemini Flash",
      defaultName: "gemini-flash",
      model: "claude-gemini-3-8-flash",
      color: "green"
    })
  })

  it("どのモデルも aliasEnv を持たない", () => {
    for (const model of MODELS) {
      expect("aliasEnv" in model, model.id).toBe(false)
    }
  })
})

describe("CLAUDE_ENUM_MODELS", () => {
  it("ウィザードの提示順を保ち、MODELS の Claude ベンダーと集合一致する", () => {
    expect(CLAUDE_ENUM_MODELS).toEqual(["sonnet", "opus", "haiku", "fable"])
    const claudeModelIds = MODELS.filter(
      (model) => model.vendor === "claude"
    ).map((model) => model.id)
    expect([...CLAUDE_ENUM_MODELS].sort()).toEqual([...claudeModelIds].sort())
  })
})

describe("modelsFor", () => {
  it("claude-model-policy の担当モデルだけを MODELS の定義順で返す", () => {
    expect(modelsFor().map((model) => model.id)).toEqual([
      "opus",
      "sonnet",
      "haiku",
      "fable"
    ])
  })
})

describe("rolesFor", () => {
  it("sonnet が claude-model-policy で担う 8 役割を返す", () => {
    expect(rolesFor("sonnet")).toEqual([
      "normal-impl",
      "general",
      "doc-writing",
      "explore",
      "realtime-research",
      "e2e-verify",
      "independent-review",
      "code-review"
    ])
  })

  it("fable が escalation・final-review・gate-review・advisor を返す", () => {
    expect(rolesFor("fable")).toEqual([
      "escalation",
      "final-review",
      "gate-review",
      "advisor"
    ])
  })

  it("claude-model-policy に登場しないモデルには空配列を返す", () => {
    expect(rolesFor("gpt-astra")).toEqual([])
  })
})

describe("allowsAgentTool", () => {
  it("claude-model-policy の全 17 役割で現行規定を保つ", () => {
    for (const role of ROLES) {
      expect(allowsAgentTool([role.id]), role.id).toBe(
        EXPECTED_AGENT_TOOL[role.id]
      )
    }
  })

  it("役割の組み合わせに応じて Agent Tool を判定する", () => {
    expect(allowsAgentTool(["light-impl"])).toBe(true)
    expect(allowsAgentTool(["light-impl", "complex-impl"])).toBe(true)
    expect(allowsAgentTool(["advisor"])).toBe(false)
    expect(allowsAgentTool(["code-review"])).toBe(false)
    expect(allowsAgentTool(["final-review"])).toBe(false)
    expect(allowsAgentTool(["gate-review"])).toBe(false)
    expect(allowsAgentTool(["complex-impl", "advisor"])).toBe(true)
  })

  it("Agent Tool を許可する新規役割を通す", () => {
    expect(allowsAgentTool(["escalation"])).toBe(true)
    expect(allowsAgentTool(["e2e-verify"])).toBe(true)
  })

  it("モデル未指定時は役割側の規定だけを適用する", () => {
    expect(allowsAgentTool(["explore"])).toBe(true)
    expect(allowsAgentTool(["light-impl"])).toBe(true)
    expect(allowsAgentTool(["final-review"])).toBe(false)
  })
})

describe("policyForInjection", () => {
  it("新しい 2 つの injection 値をポリシー ID へ写す", () => {
    expect(policyForInjection("claude")).toBe("claude-model-policy")
    expect(policyForInjection("custom")).toBe("custom-policy")
  })

  it("旧 3 値と none と未知値と未設定には undefined を返す", () => {
    expect(policyForInjection("with-codex")).toBeUndefined()
    expect(policyForInjection("with-grok")).toBeUndefined()
    expect(policyForInjection("with-codex-grok")).toBeUndefined()
    expect(policyForInjection("none")).toBeUndefined()
    expect(policyForInjection("nope")).toBeUndefined()
    expect(policyForInjection(undefined)).toBeUndefined()
  })
})

describe("isCustomInjection", () => {
  it.each([
    "custom",
    "with-codex",
    "with-grok",
    "with-codex-grok"
  ])("%s を custom 系として扱う", (value) => {
    expect(isCustomInjection(value)).toBe(true)
  })

  it("前後の空白と大文字小文字を正規化する", () => {
    expect(isCustomInjection("  CuStOm  ")).toBe(true)
    expect(isCustomInjection("  WITH-CODEX-GROK  ")).toBe(true)
  })

  it.each([
    undefined,
    "",
    "   ",
    "none",
    "claude",
    "unknown"
  ])("%s は custom 系として扱わない", (value) => {
    expect(isCustomInjection(value)).toBe(false)
  })
})

describe("runsOnClaude", () => {
  it.each([
    undefined,
    "inherit",
    ...CLAUDE_ENUM_MODELS
  ])("%s は Claude 上で実行される", (model) => {
    expect(runsOnClaude(model)).toBe(true)
  })

  it.each([
    "claude-gpt-5-6-luna",
    "claude-grok-4-6"
  ])("%s は Claude enum ではない", (model) => {
    expect(runsOnClaude(model)).toBe(false)
  })
})

describe("candidateScopeFor", () => {
  it.each([
    "custom",
    "with-codex",
    "with-grok",
    "with-codex-grok",
    "CuStOm",
    " custom "
  ])("%s は外部ベンダーを候補に含める", (value) => {
    expect(candidateScopeFor(value)).toBe("with-external")
  })

  it("claude は Claude のみを候補にする", () => {
    expect(candidateScopeFor("claude")).toBe("claude-only")
  })

  it.each([
    undefined,
    "",
    "   ",
    "none",
    "unknown"
  ])("%s は候補範囲を決めない", (value) => {
    expect(candidateScopeFor(value)).toBeUndefined()
  })
})
