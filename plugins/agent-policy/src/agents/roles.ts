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
    tools: ["Read", "Grep", "Glob", "Write", "Edit", "Bash", "Skill"]
  },
  {
    id: "normal-impl",
    label: "通常の実装",
    kind: "impl",
    tools: ["Read", "Grep", "Glob", "Write", "Edit", "Bash", "Skill"]
  },
  {
    id: "light-impl",
    label: "軽量な実装",
    kind: "impl",
    tools: ["Read", "Grep", "Glob", "Write", "Edit", "Bash"]
  },
  {
    id: "general",
    label: "その他のタスク",
    kind: "impl",
    tools: ["Read", "Grep", "Glob", "Write", "Edit", "Bash", "Skill"]
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

export function hasMixedKinds(kinds: RoleKind[]): boolean {
  const unique = new Set(kinds)
  return unique.has("impl") && unique.has("readonly")
}
