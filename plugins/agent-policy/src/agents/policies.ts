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

export type PolicyName = "claude-model-policy" | "custom-policy"

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
  color: string
}

export const POLICIES: readonly Policy[] = [
  {
    id: "claude-model-policy",
    label: "Claude のみ(レガシー)",
    injection: "claude"
  },
  { id: "custom-policy", label: "カスタム(role-id)", injection: "custom" }
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
    color: "yellow"
  },
  {
    id: "gpt-terra",
    vendor: "gpt",
    label: "GPT Terra",
    defaultName: "gpt-terra",
    model: "claude-gpt-5-6-terra",
    color: "green"
  },
  {
    id: "gpt-luna",
    vendor: "gpt",
    label: "GPT Luna",
    defaultName: "gpt-luna",
    model: "claude-gpt-5-6-luna",
    color: "cyan"
  },
  {
    id: "grok",
    vendor: "grok",
    label: "Grok",
    defaultName: "grok",
    model: "claude-grok-4-6",
    color: "red"
  }
]

// claude-model-policy 専用の担当表。フォールバック先と外部モデルの読み替え先を兼ねる。
// advisor だけが 2 モデルを持つ。担当表が変わったらここも変える。
export const ASSIGNMENTS: Record<
  "claude-model-policy",
  Record<RoleId, ModelId[]>
> = {
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
  }
}

// custom プロファイルの推奨。現行 codex-grok-policy の値を継承する。
export const RECOMMENDED: Record<RoleId, ModelId[]> = {
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

// 4 方針スキルの「Haiku には Agent Tool を許可しない」「軽量な実装の帯として
// 扱うのは GPT Luna と Haiku」に対応する。with-grok-policy が軽量帯の規定を
// Grok に適用しないことは、grok をここに入れないことで満たす。
const AGENT_DENIED_MODELS: readonly ModelId[] = ["haiku", "gpt-luna"]

// 単一役割の定義はその帯そのものなので、共通規律の除外がそのまま効く。
// 複数役割を兼ねる定義は帯そのものではないため効かない（設計 §5.2）。
const SOLO_DENIED_ROLES: readonly RoleId[] = ["light-impl", "advisor"]

export function allowsAgentTool(ids: RoleId[], model?: ModelId): boolean {
  if (model !== undefined && AGENT_DENIED_MODELS.includes(model)) return false
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

// with-* は旧世代の AMATSUKA_AGENT_AUTO_INJECTION 互換値。
// 移行期間中は custom プロファイルとして扱う。
const CUSTOM_INJECTION_VALUES: readonly string[] = [
  "custom",
  "with-codex",
  "with-grok",
  "with-codex-grok"
]

export function isCustomInjection(value: string | undefined): boolean {
  if (value === undefined) return false
  return CUSTOM_INJECTION_VALUES.includes(value.trim().toLowerCase())
}

// claude-model-policy 専用。並びは MODELS の定義順。担当表に現れるモデルだけを返す。
export function modelsFor(): ModelSpec[] {
  const used = new Set<ModelId>()
  for (const models of Object.values(ASSIGNMENTS["claude-model-policy"])) {
    for (const id of models) used.add(id)
  }
  return MODELS.filter((model) => used.has(model.id))
}

// claude-model-policy 専用。並びは ROLES の定義順。
export function rolesFor(model: ModelId): RoleId[] {
  const assignments = ASSIGNMENTS["claude-model-policy"]
  const roles = (Object.keys(assignments) as RoleId[]).filter((role) =>
    assignments[role].includes(model)
  )
  return sortRoleIds(roles)
}
