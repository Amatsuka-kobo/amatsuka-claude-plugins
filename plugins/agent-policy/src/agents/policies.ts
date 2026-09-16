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
  | "gpt-astra"
  | "grok"
  | "gemini-flash"

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
    label: "Claude のみ",
    injection: "claude"
  },
  { id: "custom-policy", label: "カスタム(role-id)", injection: "custom" }
]

// color は公式が受け付ける 8 色から選ぶ。モデル数が 8 を超えるため重複を許す。
// setup-agents が生成時に使う色は ModelSpec.color ではなく VENDOR_COLORS である。
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
    id: "gpt-astra",
    vendor: "gpt",
    label: "GPT Astra",
    defaultName: "gpt-astra",
    model: "claude-gpt-6-astra",
    color: "yellow"
  },
  {
    id: "grok",
    vendor: "grok",
    label: "Grok",
    defaultName: "grok",
    model: "claude-grok-4-6",
    color: "red"
  },
  {
    id: "gemini-flash",
    vendor: "gemini",
    label: "Gemini Flash",
    defaultName: "gemini-flash",
    model: "claude-gemini-3-8-flash",
    color: "green"
  }
]

// 共通規律 §担当表 の「Claude モデル」列の正本。claude プロファイルの役割モデルであり、
// custom プロファイルでは委譲先が決まらない役割の読み替え先を兼ねる。値を変えたら規律の表も変える。
export const ASSIGNMENTS: Record<
  "claude-model-policy",
  Record<RoleId, ModelId[]>
> = {
  "claude-model-policy": {
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
}

// custom プロファイル向けの推奨。setup-agents の提示だけに使う。方針スキルは推奨列を持たない。
export const RECOMMENDED: Record<RoleId, ModelId[]> = {
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

// 単一役割の定義には、共通規律の除外がそのまま効く。
// 複数役割を兼ねる定義は一つの役割に対応しないため効かない（設計 §5.2）。
const SOLO_DENIED_ROLES: readonly RoleId[] = [
  "advisor",
  "doc-review",
  "code-review",
  "final-review",
  "gate-review",
  "doc-writing"
]

// Agent の可否は役割だけで決まる。モデルによる除外は持たない。
export function allowsAgentTool(ids: RoleId[]): boolean {
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

/** 委譲先の候補に含める範囲。claude 構成が基底で、custom 構成は外部ベンダーを足す。 */
export type CandidateScope = "claude-only" | "with-external"

// Claude の enum モデル。並びは setup-agents のウィザードが候補として提示する順である。
export const CLAUDE_ENUM_MODELS: readonly string[] = [
  "sonnet",
  "opus",
  "haiku",
  "fable"
]

// enum に加え、親のモデルで解決される宣言。frontmatter に model が無い場合も同じ扱いにする。
const CLAUDE_RESOLVED = new Set([...CLAUDE_ENUM_MODELS, "inherit"])

/** model 宣言が Claude のモデルで実行されるか。未宣言は継承なので真。 */
export function runsOnClaude(model: string | undefined): boolean {
  return model === undefined || CLAUDE_RESOLVED.has(model)
}

/** 注入プロファイルが決める候補の範囲。対応表を出さない値では undefined を返す。 */
export function candidateScopeFor(
  value: string | undefined
): CandidateScope | undefined {
  if (isCustomInjection(value)) return "with-external"
  if (value?.trim().toLowerCase() === "claude") return "claude-only"
  return undefined
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
