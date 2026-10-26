export type RoleId =
  | "complex-impl"
  | "normal-impl"
  | "light-impl"
  | "general"
  | "explore"
  | "realtime-research"
  | "e2e-verify"
  | "escalation"
  | "design-review"
  | "knowledge-elicitation"
  | "code-review"
  | "complex-review"
  | "adversarial-review"

export type RoleKind = "impl" | "readonly"
export type Reason = "review" | "split" | "stuck"
export type ClaudeModel = "sonnet" | "opus" | "haiku" | "fable"
export type Effort = "low" | "medium" | "high" | "xhigh" | "max"

export interface Role {
  id: RoleId
  label: string
  kind: RoleKind
  /** 推奨モデル */
  model: ClaudeModel
  /** 推奨モデルを選んだときの effort */
  effort: Effort
  /** どの委譲理由で候補になるか */
  reason: Reason
}

// 役割表の正本。並びは設計書 §4-1 の表の順で、setup の提示と委譲先の候補の順に使う。
export const ROLES: readonly Role[] = [
  {
    id: "complex-impl",
    label: "複雑または重要な実装",
    kind: "impl",
    model: "opus",
    effort: "medium",
    reason: "split"
  },
  {
    id: "normal-impl",
    label: "通常の実装",
    kind: "impl",
    model: "sonnet",
    effort: "medium",
    reason: "split"
  },
  {
    id: "light-impl",
    label: "軽量な実装",
    kind: "impl",
    model: "haiku",
    effort: "medium",
    reason: "split"
  },
  {
    id: "general",
    label: "その他のタスク",
    kind: "impl",
    model: "sonnet",
    effort: "high",
    reason: "split"
  },
  {
    id: "explore",
    label: "コードベース探索",
    kind: "readonly",
    model: "sonnet",
    effort: "high",
    reason: "split"
  },
  {
    id: "realtime-research",
    label: "リアルタイム情報調査",
    kind: "readonly",
    model: "sonnet",
    effort: "high",
    reason: "split"
  },
  {
    id: "e2e-verify",
    label: "E2E 動作検証・ブラウザ/GUI 操作",
    kind: "impl",
    model: "sonnet",
    effort: "high",
    reason: "split"
  },
  {
    id: "escalation",
    label: "行き詰まり時のエスカレーション",
    kind: "impl",
    model: "fable",
    effort: "high",
    reason: "stuck"
  },
  {
    id: "design-review",
    label: "設計書・実装計画書のレビュー",
    kind: "readonly",
    model: "opus",
    effort: "high",
    reason: "review"
  },
  {
    id: "knowledge-elicitation",
    label: "暗黙知の抽出・理解レビュー",
    kind: "readonly",
    model: "haiku",
    effort: "low",
    reason: "review"
  },
  {
    id: "code-review",
    label: "コードレビュー",
    kind: "readonly",
    model: "sonnet",
    effort: "high",
    reason: "review"
  },
  {
    id: "complex-review",
    label: "重要な実装・高リスク設計書の最終レビュー",
    kind: "readonly",
    model: "fable",
    effort: "high",
    reason: "review"
  },
  {
    id: "adversarial-review",
    label: "敵対的レビュー",
    kind: "readonly",
    model: "opus",
    effort: "high",
    reason: "review"
  }
]

export const CLAUDE_MODELS: readonly ClaudeModel[] = [
  "sonnet",
  "opus",
  "haiku",
  "fable"
]

export const EFFORTS: readonly Effort[] = [
  "low",
  "medium",
  "high",
  "xhigh",
  "max"
]

export function roleById(id: string): Role | undefined {
  return ROLES.find((role) => role.id === id)
}

export function rolesFor(reason: Reason): Role[] {
  return ROLES.filter((role) => role.reason === reason)
}

export function isClaudeModel(value: string): value is ClaudeModel {
  return (CLAUDE_MODELS as readonly string[]).includes(value)
}

export function isEffort(value: string): value is Effort {
  return (EFFORTS as readonly string[]).includes(value)
}
