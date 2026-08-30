import type { Vendor } from "./fragments"
import { type RoleId, sortRoleIds } from "./roles"

export type ModelId =
  | "opus"
  | "sonnet"
  | "haiku"
  | "fable"
  | "gpt-sol"
  | "gpt-terra"
  | "gpt-luna"
  | "grok"

// ja / en は同梱断片を持つ。それ以外は翻訳断片を要する任意のコード。
export type Lang = string

export type PolicyName =
  | "claude-model-policy"
  | "with-codex-policy"
  | "with-grok-policy"
  | "codex-grok-policy"

export interface Policy {
  id: PolicyName
  label: string
  // AMATSUKA_AGENT_AUTO_INJECTION が取る値。フックと README の表と同じ。
  injection: string
}

export interface ModelSpec {
  id: ModelId
  vendor: Vendor
  label: string
  defaultName: string
  model: string
  aliasEnv?: string
  color: string
}

export const POLICIES: readonly Policy[] = [
  { id: "claude-model-policy", label: "Claude のみ", injection: "claude" },
  {
    id: "with-codex-policy",
    label: "Claude + Codex 併用",
    injection: "with-codex"
  },
  {
    id: "with-grok-policy",
    label: "Claude + Grok 併用",
    injection: "with-grok"
  },
  {
    id: "codex-grok-policy",
    label: "Claude + Codex + Grok 併用",
    injection: "with-codex-grok"
  }
]

// color は公式が受け付ける 8 色。ちょうど 8 モデルなので重複させない。
export const MODELS: readonly ModelSpec[] = [
  {
    id: "opus",
    vendor: "claude",
    label: "Opus",
    defaultName: "claude-opus",
    model: "opus",
    color: "blue"
  },
  {
    id: "sonnet",
    vendor: "claude",
    label: "Sonnet",
    defaultName: "claude-sonnet",
    model: "sonnet",
    color: "purple"
  },
  {
    id: "haiku",
    vendor: "claude",
    label: "Haiku",
    defaultName: "claude-haiku",
    model: "haiku",
    color: "pink"
  },
  {
    id: "fable",
    vendor: "claude",
    label: "Fable",
    defaultName: "claude-fable",
    model: "fable",
    color: "orange"
  },
  {
    id: "gpt-sol",
    vendor: "gpt",
    label: "GPT Sol",
    defaultName: "gpt-sol",
    model: "claude-gpt-5-6-sol",
    aliasEnv: "AMATSUKA_AGENT_GPT_SOL_ALIAS",
    color: "yellow"
  },
  {
    id: "gpt-terra",
    vendor: "gpt",
    label: "GPT Terra",
    defaultName: "gpt-terra",
    model: "claude-gpt-5-6-terra",
    aliasEnv: "AMATSUKA_AGENT_GPT_TERRA_ALIAS",
    color: "green"
  },
  {
    id: "gpt-luna",
    vendor: "gpt",
    label: "GPT Luna",
    defaultName: "gpt-luna",
    model: "claude-gpt-5-6-luna",
    aliasEnv: "AMATSUKA_AGENT_GPT_LUNA_ALIAS",
    color: "cyan"
  },
  {
    id: "grok",
    vendor: "grok",
    label: "Grok",
    defaultName: "grok",
    model: "claude-grok-4-6",
    aliasEnv: "AMATSUKA_AGENT_GROK_ALIAS",
    color: "red"
  }
]

// 方針スキルの担当表(モデル別役割)をそのまま写したもの。
// advisor だけが 2 モデルを持つ。担当表が変わったらここも変える。
export const ASSIGNMENTS: Record<PolicyName, Record<RoleId, ModelId[]>> = {
  "claude-model-policy": {
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
  },
  "with-codex-policy": {
    "complex-impl": ["gpt-sol"],
    "normal-impl": ["gpt-terra"],
    "light-impl": ["gpt-luna"],
    general: ["gpt-terra"],
    explore: ["gpt-terra"],
    "realtime-research": ["gpt-terra"],
    "independent-review": ["gpt-terra"],
    "doc-review": ["haiku"],
    "code-review": ["sonnet"],
    advisor: ["fable", "opus"]
  },
  "with-grok-policy": {
    "complex-impl": ["opus"],
    "normal-impl": ["grok"],
    "light-impl": ["grok"],
    general: ["grok"],
    explore: ["grok"],
    "realtime-research": ["grok"],
    "independent-review": ["grok"],
    "doc-review": ["haiku"],
    "code-review": ["sonnet"],
    advisor: ["fable", "opus"]
  },
  "codex-grok-policy": {
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
}

// 4 方針スキルの「Haiku には Agent Tool を許可しない」「軽量な実装の帯として
// 扱うのは GPT Luna と Haiku」に対応する。with-grok-policy が軽量帯の規定を
// Grok に適用しないことは、grok をここに入れないことで満たす。
const AGENT_DENIED_MODELS: readonly ModelId[] = ["haiku", "gpt-luna"]

// 単一役割の定義はその帯そのものなので、共通規律の除外がそのまま効く。
// 複数役割を兼ねる定義は帯そのものではないため効かない（設計 §5.2）。
const SOLO_DENIED_ROLES: readonly RoleId[] = ["light-impl", "advisor"]

export function allowsAgentTool(ids: RoleId[], model: ModelId): boolean {
  if (AGENT_DENIED_MODELS.includes(model)) return false
  return ids.some((id) => !SOLO_DENIED_ROLES.includes(id))
}

export function modelById(id: string): ModelSpec | undefined {
  return MODELS.find((model) => model.id === id)
}

export function policyById(id: string): Policy | undefined {
  return POLICIES.find((policy) => policy.id === id)
}

// AMATSUKA_AGENT_AUTO_INJECTION の値はポリシー ID と別体系である。
// 対話の第一候補を決めるときと、非対話モードでポリシーを解決するときに使う。
export function policyForInjection(
  value: string | undefined
): PolicyName | undefined {
  if (value === undefined) return undefined
  return POLICIES.find((policy) => policy.injection === value.trim())?.id
}

// 並びは MODELS の定義順。担当表に一度でも現れるモデルだけを返す。
export function modelsFor(policy: PolicyName): ModelSpec[] {
  const used = new Set<ModelId>()
  for (const models of Object.values(ASSIGNMENTS[policy])) {
    for (const id of models) used.add(id)
  }
  return MODELS.filter((model) => used.has(model.id))
}

// 並びは ROLES の定義順。ウィザードの選択肢と CLI の検証の双方で使う。
export function rolesFor(policy: PolicyName, model: ModelId): RoleId[] {
  const assignments = ASSIGNMENTS[policy]
  const roles = (Object.keys(assignments) as RoleId[]).filter((role) =>
    assignments[role].includes(model)
  )
  return sortRoleIds(roles)
}

// 全方針でそのモデルが担う役割の和集合。同梱プリセットの役割集合に使う。
export function rolesAcrossPolicies(model: ModelId): RoleId[] {
  const roles = new Set<RoleId>()
  for (const policy of POLICIES) {
    for (const role of rolesFor(policy.id, model)) roles.add(role)
  }
  return sortRoleIds([...roles])
}

export function resolveModelValue(
  spec: ModelSpec,
  env: NodeJS.ProcessEnv
): string {
  if (spec.aliasEnv === undefined) return spec.model
  const value = env[spec.aliasEnv]?.trim()
  return value === undefined || value === "" ? spec.model : value
}
