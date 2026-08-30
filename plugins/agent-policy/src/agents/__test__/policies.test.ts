import { describe, expect, it } from "vitest"
import {
  ASSIGNMENTS,
  allowsAgentTool,
  MODELS,
  modelById,
  modelsFor,
  POLICIES,
  type PolicyName,
  policyForInjection,
  resolveModelValue,
  rolesAcrossPolicies,
  rolesFor
} from "../policies"
import { ROLES, type RoleId } from "../roles"

// 各方針スキルの Agent tool 規定を写したもの。SKILL.md を変えたらここも変える。
const EXPECTED: Record<PolicyName, Record<RoleId, boolean>> = {
  "claude-model-policy": {
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
  },
  "with-codex-policy": {
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
  },
  "with-grok-policy": {
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
  },
  "codex-grok-policy": {
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
}

describe("ASSIGNMENTS", () => {
  it("4 方針それぞれが役割 10 種すべてに担当モデルを持つ", () => {
    for (const policy of POLICIES) {
      for (const role of ROLES) {
        const models = ASSIGNMENTS[policy.id][role.id]
        expect(models, `${policy.id}/${role.id}`).toBeDefined()
        expect(models.length, `${policy.id}/${role.id}`).toBeGreaterThan(0)
      }
    }
  })

  it("担当モデルはすべて MODELS に存在する", () => {
    const known = new Set(MODELS.map((model) => model.id))
    for (const assignments of Object.values(ASSIGNMENTS)) {
      for (const models of Object.values(assignments)) {
        for (const id of models) expect(known).toContain(id)
      }
    }
  })

  it("advisor は 4 方針すべてで fable と opus の 2 モデルを持つ", () => {
    for (const policy of POLICIES) {
      expect(ASSIGNMENTS[policy.id].advisor).toEqual(["fable", "opus"])
    }
  })

  it("advisor 以外はすべて単一モデルである", () => {
    for (const assignments of Object.values(ASSIGNMENTS)) {
      for (const [role, models] of Object.entries(assignments)) {
        if (role === "advisor") continue
        expect(models.length, role).toBe(1)
      }
    }
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

  it("Claude 帯は aliasEnv を持たない", () => {
    for (const model of MODELS.filter((m) => m.vendor === "claude")) {
      expect(model.aliasEnv, model.id).toBeUndefined()
    }
  })
})

describe("modelsFor", () => {
  it("claude-model-policy は Claude 4 種のみを返す", () => {
    expect(modelsFor("claude-model-policy").map((m) => m.id)).toEqual([
      "opus",
      "sonnet",
      "haiku",
      "fable"
    ])
  })

  it("codex-grok-policy は 8 種すべてを返す", () => {
    expect(modelsFor("codex-grok-policy").map((m) => m.id)).toEqual([
      "opus",
      "sonnet",
      "haiku",
      "fable",
      "gpt-sol",
      "gpt-terra",
      "gpt-luna",
      "grok"
    ])
  })
})

describe("rolesFor", () => {
  it("claude-model-policy の sonnet は 6 役割を担う", () => {
    expect(rolesFor("claude-model-policy", "sonnet")).toEqual([
      "normal-impl",
      "general",
      "explore",
      "realtime-research",
      "independent-review",
      "code-review"
    ])
  })

  it("codex-grok-policy の gpt-terra は normal-impl と general だけを担う", () => {
    expect(rolesFor("codex-grok-policy", "gpt-terra")).toEqual([
      "normal-impl",
      "general"
    ])
  })

  it("fable は advisor だけを担う", () => {
    expect(rolesFor("with-codex-policy", "fable")).toEqual(["advisor"])
  })

  it("そのポリシーに登場しないモデルには空配列を返す", () => {
    expect(rolesFor("claude-model-policy", "grok")).toEqual([])
  })
})

describe("rolesAcrossPolicies", () => {
  it("gpt-terra は 5 役割の和集合になる", () => {
    expect(rolesAcrossPolicies("gpt-terra")).toEqual([
      "normal-impl",
      "general",
      "explore",
      "realtime-research",
      "independent-review"
    ])
  })

  it("grok は 6 役割の和集合になる", () => {
    expect(rolesAcrossPolicies("grok")).toEqual([
      "normal-impl",
      "light-impl",
      "general",
      "explore",
      "realtime-research",
      "independent-review"
    ])
  })
})

describe("allowsAgentTool", () => {
  it("4 方針 × 10 役割の Agent tool 規定と一致する", () => {
    for (const policy of POLICIES) {
      for (const role of ROLES) {
        for (const model of ASSIGNMENTS[policy.id][role.id]) {
          expect(
            allowsAgentTool([role.id], model),
            `${policy.id}/${role.id}/${model}`
          ).toBe(EXPECTED[policy.id][role.id])
        }
      }
    }
  })

  it("rolesFor が返す読み取り役割だけの混成を許可する", () => {
    const roles = rolesFor("codex-grok-policy", "grok")
    expect(roles).toEqual([
      "explore",
      "realtime-research",
      "independent-review"
    ])
    expect(allowsAgentTool(roles, "grok")).toBe(true)
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
  })
})

describe("policyForInjection", () => {
  it("AMATSUKA_AGENT_AUTO_INJECTION の値をポリシー ID へ写す", () => {
    expect(policyForInjection("claude")).toBe("claude-model-policy")
    expect(policyForInjection("with-codex")).toBe("with-codex-policy")
    expect(policyForInjection("with-grok")).toBe("with-grok-policy")
    expect(policyForInjection("with-codex-grok")).toBe("codex-grok-policy")
  })

  it("none と未知の値と未設定には undefined を返す", () => {
    expect(policyForInjection("none")).toBeUndefined()
    expect(policyForInjection("nope")).toBeUndefined()
    expect(policyForInjection(undefined)).toBeUndefined()
  })
})

describe("resolveModelValue", () => {
  it("環境変数があればそれを使う", () => {
    const spec = modelById("gpt-sol")
    expect(spec).toBeDefined()
    expect(
      resolveModelValue(spec as never, { AMATSUKA_AGENT_GPT_SOL_ALIAS: "mine" })
    ).toBe("mine")
  })

  it("環境変数が無ければ既定値を使う", () => {
    expect(resolveModelValue(modelById("gpt-sol") as never, {})).toBe(
      "claude-gpt-5-6-sol"
    )
  })

  it("Claude 帯は既定値を返す", () => {
    expect(resolveModelValue(modelById("sonnet") as never, {})).toBe("sonnet")
  })
})
