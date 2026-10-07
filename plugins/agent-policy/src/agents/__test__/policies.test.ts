import { describe, expect, it } from "vitest"
import {
  ASSIGNMENTS,
  CLAUDE_ENUM_MODELS,
  candidateScopeFor,
  EFFORT,
  EFFORT_ORDER,
  effortFor,
  isCustomInjection,
  MODELS,
  type ModelId,
  modelById,
  modelIdForAlias,
  modelsFor,
  POLICIES,
  policyForInjection,
  RECOMMENDED,
  rankAliases,
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
  explore: ["sonnet"],
  "realtime-research": ["sonnet"],
  "e2e-verify": ["sonnet"],
  "design-review": ["opus"],
  "knowledge-elicitation": ["haiku"],
  "code-review": ["sonnet"],
  "complex-review": ["fable"],
  "adversarial-review": ["opus"]
}

const EXPECTED_RECOMMENDED: Record<RoleId, ModelId[]> = {
  "complex-impl": ["gpt-sol", "opus"],
  "normal-impl": ["gpt-sol", "sonnet", "grok"],
  "light-impl": ["gpt-luna", "haiku", "grok"],
  escalation: ["gpt-astra", "fable"],
  general: ["gpt-luna", "sonnet"],
  explore: ["gpt-sol", "sonnet"],
  "realtime-research": ["grok", "sonnet"],
  "e2e-verify": ["gpt-sol", "sonnet"],
  "design-review": ["gpt-sol", "opus"],
  "knowledge-elicitation": ["haiku", "gpt-luna"],
  "code-review": ["gpt-sol", "sonnet"],
  "complex-review": ["gpt-astra", "fable"],
  "adversarial-review": ["opus", "gpt-sol"]
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
  it("claude-model-policy だけに現行の全 13 役割を保持する", () => {
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
  it("custom プロファイル向け推奨が全 13 役割と固定値を持つ", () => {
    expect(sortedRoleIds(RECOMMENDED)).toEqual(ALL_ROLE_IDS)
    expect(RECOMMENDED).toEqual(EXPECTED_RECOMMENDED)
  })
})

describe("EFFORT", () => {
  it("役割とモデルごとの effort 表を固定する", () => {
    expect(EFFORT).toEqual({
      escalation: { fable: "high", "gpt-astra": "high" },
      "complex-impl": { opus: "medium", "gpt-sol": "high" },
      "normal-impl": { sonnet: "medium", "gpt-sol": "medium", grok: "high" },
      "light-impl": { haiku: "medium", "gpt-luna": "low", grok: "medium" },
      general: { sonnet: "medium", "gpt-luna": "medium" },
      explore: { sonnet: "high", "gpt-sol": "medium" },
      "realtime-research": { grok: "high", sonnet: "high" },
      "e2e-verify": { sonnet: "high", "gpt-sol": "medium" },
      "design-review": { opus: "high", "gpt-sol": "high" },
      "knowledge-elicitation": { haiku: "low", "gpt-luna": "low" },
      "code-review": { sonnet: "high", "gpt-sol": "high" },
      "complex-review": { "gpt-astra": "high", fable: "high" },
      "adversarial-review": { opus: "high", "gpt-sol": "high" }
    })
    expect(EFFORT_ORDER).toEqual(["low", "medium", "high", "xhigh", "max"])
  })

  it("複数役割では最も高い effort を選び、未定義の組は省く", () => {
    expect(effortFor(["normal-impl"], "gpt-luna")).toBeUndefined()
    expect(effortFor(["light-impl"], "gpt-luna")).toBe("low")
    expect(effortFor(["normal-impl", "light-impl"], "gpt-luna")).toBe("low")
    expect(effortFor(["general", "code-review"], "sonnet")).toBe("high")
    expect(effortFor(["knowledge-elicitation"], "haiku")).toBe("low")
    expect(() =>
      effortFor(["unregistered-role" as RoleId], "sonnet")
    ).not.toThrow()
  })
})

describe("MODELS", () => {
  it("9 モデルを定義する", () => {
    expect(MODELS).toHaveLength(9)
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
      "grok"
    ])
  })

  it("gemini-flash は未定義", () => {
    expect(modelById("gemini-flash")).toBeUndefined()
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
  it("sonnet が claude-model-policy で担う 6 役割を返す", () => {
    expect(rolesFor("sonnet")).toEqual([
      "normal-impl",
      "general",
      "explore",
      "realtime-research",
      "e2e-verify",
      "code-review"
    ])
  })

  it("fable が escalation と complex-review を返す", () => {
    expect(rolesFor("fable")).toEqual(["escalation", "complex-review"])
  })

  it("claude-model-policy に登場しないモデルには空配列を返す", () => {
    expect(rolesFor("gpt-astra")).toEqual([])
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

describe("modelIdForAlias", () => {
  it.each([
    ["claude-gpt6-sol", "gpt-sol"],
    ["claude-gpt-6.1-sol", "gpt-sol"],
    ["claude-GPT-6-1-Sol", "gpt-sol"],
    ["claude-gpt-6.1-sol-pro", "gpt-sol"],
    ["claude-gpt_6_terra", "gpt-terra"],
    ["claude-gpt-6-luna", "gpt-luna"],
    ["claude-gpt-6-astra", "gpt-astra"],
    ["claude-grok-4-7", "grok"],
    ["claude-grok5", "grok"]
  ])("%s は %s に当たる", (alias, modelId) => {
    expect(modelIdForAlias(alias)).toBe(modelId)
  })

  it.each([
    "gpt-6-sol",
    "claude-gpt-6-console",
    "claude-gpt-6",
    "claude-sol",
    "opus",
    "my-model"
  ])("%s はどのモデルにも当たらない", (alias) => {
    expect(modelIdForAlias(alias)).toBeUndefined()
  })
})

describe("rankAliases", () => {
  it("既定エイリアスと完全一致するものを長さより先に置く", () => {
    expect(
      rankAliases("gpt-sol", ["claude-gpt6-sol", "claude-gpt-6-1-sol"])
    ).toEqual(["claude-gpt-6-1-sol", "claude-gpt6-sol"])
  })

  it("既定エイリアスが無ければ短いものを先に置く", () => {
    expect(
      rankAliases("gpt-sol", ["claude-gpt-6.1-sol-pro", "claude-gpt6-sol"])
    ).toEqual(["claude-gpt6-sol", "claude-gpt-6.1-sol-pro"])
  })

  it("同じ長さなら辞書順で先のものを先に置く", () => {
    expect(
      rankAliases("gpt-sol", ["claude-gpt-6.2-sol", "claude-gpt-6.1-sol"])
    ).toEqual(["claude-gpt-6.1-sol", "claude-gpt-6.2-sol"])
  })

  it("モデル ID に当たらないエイリアスを除く", () => {
    expect(
      rankAliases("gpt-sol", ["claude-grok-4-7", "custom", "claude-gpt6-sol"])
    ).toEqual(["claude-gpt6-sol"])
  })
})
