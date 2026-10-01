export type RoleKind = "impl" | "readonly"

export type RoleId =
  | "complex-impl"
  | "normal-impl"
  | "light-impl"
  | "escalation"
  | "general"
  | "explore"
  | "realtime-research"
  | "e2e-verify"
  | "design-review"
  | "knowledge-elicitation"
  | "code-review"
  | "complex-review"
  | "adversarial-review"

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
    id: "design-review",
    label: "設計書・実装計画書のレビュー",
    kind: "readonly",
    tools: ["Read", "Grep", "Glob", "Bash"]
  },
  {
    id: "knowledge-elicitation",
    label: "暗黙知の抽出・理解レビュー",
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
    id: "complex-review",
    label: "重要な実装・高リスク設計書の最終レビュー",
    kind: "readonly",
    tools: ["Read", "Grep", "Glob", "Bash"]
  },
  {
    id: "adversarial-review",
    label: "敵対的レビュー",
    kind: "readonly",
    tools: ["Read", "Grep", "Glob", "Bash"]
  }
]

// 廃止済みの役割 ID と書き換え先。null は後継が無いことを表す。
// プロジェクトに同名の断片が残っていても、これらは役割として解決しない。
export const RETIRED_ROLE_REPLACEMENTS: Readonly<
  Record<string, RoleId | null>
> = {
  "final-review": "complex-review",
  "gate-review": "complex-review",
  "design-plan": null,
  advisor: null
}

export function isRetiredRole(id: string): boolean {
  return Object.hasOwn(RETIRED_ROLE_REPLACEMENTS, id)
}

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
