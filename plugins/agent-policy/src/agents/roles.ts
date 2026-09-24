export type RoleKind = "impl" | "readonly"

export type RoleId =
  | "complex-impl"
  | "normal-impl"
  | "light-impl"
  | "escalation"
  | "general"
  | "design-plan"
  | "explore"
  | "realtime-research"
  | "e2e-verify"
  | "independent-review"
  | "doc-review"
  | "code-review"
  | "final-review"
  | "gate-review"
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
    id: "escalation",
    label: "行き詰まり時のエスカレーション",
    kind: "impl",
    tools: ["Read", "Grep", "Glob", "Write", "Edit", "Bash", "Skill"]
  },
  {
    id: "general",
    label: "その他のタスク",
    kind: "impl",
    tools: ["Read", "Grep", "Glob", "Write", "Edit", "Bash", "Skill"]
  },
  {
    id: "design-plan",
    label: "設計書・実装計画書(WBS)の作成",
    kind: "impl",
    tools: ["Read", "Grep", "Glob", "Write", "Edit", "Bash", "Skill"]
  },
  {
    id: "explore",
    label: "コードベース探索",
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
    id: "e2e-verify",
    label: "E2E 動作検証・ブラウザ/GUI 操作",
    kind: "impl",
    tools: ["Read", "Grep", "Glob", "Write", "Edit", "Bash", "Skill"]
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
    id: "final-review",
    label: "重要な実装の最終レビュー",
    kind: "readonly",
    tools: ["Read", "Grep", "Glob", "Bash"]
  },
  {
    id: "gate-review",
    label: "設計書の最終ゲートレビュー",
    kind: "readonly",
    tools: ["Read", "Grep", "Glob"]
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
