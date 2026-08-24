export type RoleKind = "impl" | "readonly"

export type RoleId =
  | "complex-impl"
  | "normal-impl"
  | "light-impl"
  | "general"
  | "explore"
  | "realtime-research"
  | "independent-review"
  | "doc-review"
  | "code-review"
  | "advisor"

export interface Role {
  id: RoleId
  label: string
  kind: RoleKind
  tools: string[]
}

// 並び順は設計書 §4 の表順であり、agent-policy-role の CSV の並びにも使う。
export const ROLES: readonly Role[] = [
  {
    id: "complex-impl",
    label: "複雑または重要な実装",
    kind: "impl",
    tools: ["Read", "Grep", "Glob", "Write", "Edit", "Bash", "Skill", "LSP"]
  },
  {
    id: "normal-impl",
    label: "通常の実装",
    kind: "impl",
    tools: ["Read", "Grep", "Glob", "Write", "Edit", "Bash", "Skill", "LSP"]
  },
  {
    id: "light-impl",
    label: "軽量な実装",
    kind: "impl",
    tools: ["Read", "Grep", "Glob", "Write", "Edit", "Bash", "LSP"]
  },
  {
    id: "general",
    label: "その他のタスク",
    kind: "impl",
    tools: ["Read", "Grep", "Glob", "Write", "Edit", "Bash", "Skill", "LSP"]
  },
  {
    id: "explore",
    label: "コードベース探索実働",
    kind: "readonly",
    tools: ["Read", "Grep", "Glob", "Bash"]
  },
  {
    id: "realtime-research",
    label: "リアルタイム情報調査",
    kind: "readonly",
    tools: ["Read", "Grep", "Glob", "Bash", "WebSearch", "WebFetch"]
  },
  {
    id: "independent-review",
    label: "設計書・実装計画書の独立レビュー",
    kind: "readonly",
    tools: ["Read", "Grep", "Glob", "Bash"]
  },
  {
    id: "doc-review",
    label: "設計書・実装計画書のレビュー",
    kind: "readonly",
    tools: ["Read", "Grep", "Glob"]
  },
  {
    id: "code-review",
    label: "コードレビュー",
    kind: "readonly",
    tools: ["Read", "Grep", "Glob", "Bash"]
  },
  {
    id: "advisor",
    label: "設計・計画・実装のアドバイザー",
    kind: "readonly",
    tools: ["Read", "Grep", "Glob"]
  }
]

// Agent tool を許可する実装役割。orchestration-discipline の
// 「軽量な実装の帯に Agent Tool を許可しない」に従い light-impl を除く。
const AGENT_CAPABLE: readonly RoleId[] = [
  "complex-impl",
  "normal-impl",
  "general"
]

export function roleById(id: string): Role | undefined {
  return ROLES.find((role) => role.id === id)
}

export function roleOrder(id: string): number {
  const index = ROLES.findIndex((role) => role.id === id)
  return index === -1 ? ROLES.length : index
}

export function sortRoleIds<T extends string>(ids: T[]): T[] {
  return [...ids].sort(
    (left, right) =>
      roleOrder(left) - roleOrder(right) || left.localeCompare(right)
  )
}

export function allowsAgentTool(ids: RoleId[]): boolean {
  return ids.some((id) => AGENT_CAPABLE.includes(id))
}

export function hasMixedKinds(kinds: RoleKind[]): boolean {
  const unique = new Set(kinds)
  return unique.has("impl") && unique.has("readonly")
}

// tools の並びは ROLES の定義順に現れた順とし、Agent を末尾へ置く。
export function resolveTools(ids: RoleId[]): string[] {
  const tools: string[] = []
  for (const id of sortRoleIds(ids)) {
    for (const tool of roleById(id)?.tools ?? []) {
      if (!tools.includes(tool)) tools.push(tool)
    }
  }
  if (allowsAgentTool(ids)) tools.push("Agent")
  return tools
}

export type PolicyName =
  | "claude-model-policy"
  | "with-codex-policy"
  | "with-grok-policy"
  | "codex-grok-policy"

// 各方針の担当表で、その役割をどのプリセットが担うか。
// Claude 帯(model 上書きで済む帯)は載せない。
export const PRESET_ASSIGNMENTS: Record<
  PolicyName,
  Partial<Record<RoleId, string>>
> = {
  "claude-model-policy": {},
  "with-codex-policy": {
    "complex-impl": "gpt-sol",
    "normal-impl": "gpt-terra",
    "light-impl": "gpt-luna",
    general: "gpt-terra",
    explore: "gpt-terra",
    "realtime-research": "gpt-terra",
    "independent-review": "gpt-terra"
  },
  "codex-grok-policy": {
    "complex-impl": "gpt-sol",
    "normal-impl": "gpt-terra",
    "light-impl": "gpt-luna",
    general: "gpt-terra",
    explore: "grok",
    "realtime-research": "grok",
    "independent-review": "grok"
  },
  "with-grok-policy": {
    "normal-impl": "grok",
    "light-impl": "grok",
    general: "grok",
    explore: "grok",
    "realtime-research": "grok",
    "independent-review": "grok"
  }
}
