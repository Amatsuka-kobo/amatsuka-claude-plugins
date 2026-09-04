import { describe, expect, it } from "vitest"
import {
  ASSIGNMENTS,
  allowsAgentTool,
  isCustomInjection,
  MODELS,
  type ModelId,
  modelsFor,
  POLICIES,
  policyForInjection,
  RECOMMENDED,
  rolesFor
} from "../policies"
import { ROLES, type RoleId } from "../roles"

const EXPECTED_CLAUDE_ASSIGNMENTS: Record<RoleId, ModelId[]> = {
  "complex-impl": ["opus"],
  "normal-impl": ["sonnet"],
  "light-impl": ["haiku"],
  general: ["sonnet"],
  explore: ["sonnet"],
  "realtime-research": ["sonnet"],
  "independent-review": ["sonnet"],
  "doc-review": ["haiku"],
  "code-review": ["sonnet"],
  advisor: ["fable", "opus"]
}

const EXPECTED_RECOMMENDED: Record<RoleId, ModelId[]> = {
  "complex-impl": ["gpt-sol"],
  "normal-impl": ["gpt-terra"],
  "light-impl": ["gpt-luna"],
  general: ["gpt-terra"],
  explore: ["grok"],
  "realtime-research": ["grok"],
  "independent-review": ["grok"],
  "doc-review": ["haiku"],
  "code-review": ["sonnet"],
  advisor: ["fable", "opus"]
}

const EXPECTED_AGENT_TOOL: Record<RoleId, boolean> = {
  "complex-impl": true,
  "normal-impl": true,
  "light-impl": false,
  general: true,
  explore: true,
  "realtime-research": true,
  "independent-review": true,
  "doc-review": false,
  "code-review": true,
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
        label: "Claude のみ(レガシー)",
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
  it("claude-model-policy だけに現行の全 10 役割を保持する", () => {
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
  it("custom プロファイル向け推奨が全 10 役割と固定値を持つ", () => {
    expect(sortedRoleIds(RECOMMENDED)).toEqual(ALL_ROLE_IDS)
    expect(RECOMMENDED).toEqual(EXPECTED_RECOMMENDED)
  })
})

describe("MODELS", () => {
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

  it("color が重複しない", () => {
    const colors = MODELS.map((model) => model.color)
    expect(new Set(colors).size).toBe(colors.length)
  })

  it("どのモデルも aliasEnv を持たない", () => {
    for (const model of MODELS) {
      expect("aliasEnv" in model, model.id).toBe(false)
    }
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
  it("sonnet が claude-model-policy で担う 6 役割を返す", () => {
    expect(rolesFor("sonnet")).toEqual([
      "normal-impl",
      "general",
      "explore",
      "realtime-research",
      "independent-review",
      "code-review"
    ])
  })

  it("fable は advisor だけを返す", () => {
    expect(rolesFor("fable")).toEqual(["advisor"])
  })

  it("claude-model-policy に登場しないモデルには空配列を返す", () => {
    expect(rolesFor("grok")).toEqual([])
  })
})

describe("allowsAgentTool", () => {
  it("claude-model-policy の全 10 役割で現行規定を保つ", () => {
    for (const role of ROLES) {
      for (const model of ASSIGNMENTS["claude-model-policy"][role.id]) {
        expect(allowsAgentTool([role.id], model), `${role.id}/${model}`).toBe(
          EXPECTED_AGENT_TOOL[role.id]
        )
      }
    }
  })

  it("単独の除外役割だけを拒否し、他役割との混成を許可する", () => {
    expect(allowsAgentTool(["light-impl"], "grok")).toBe(false)
    expect(allowsAgentTool(["light-impl", "complex-impl"], "grok")).toBe(true)
    expect(allowsAgentTool(["advisor"], "opus")).toBe(false)
    expect(allowsAgentTool(["complex-impl", "advisor"], "opus")).toBe(true)
  })

  it("モデル側の除外を適用する", () => {
    expect(allowsAgentTool(["explore"], "grok")).toBe(true)
    expect(allowsAgentTool(["explore"], "haiku")).toBe(false)
    expect(allowsAgentTool(["explore"], "gpt-luna")).toBe(false)
  })

  it("モデル未指定時は役割側の規定だけを適用する", () => {
    expect(allowsAgentTool(["explore"])).toBe(true)
    expect(allowsAgentTool(["light-impl"])).toBe(false)
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
