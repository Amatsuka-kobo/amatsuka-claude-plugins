/**
 * kind 別ルーブリック軸(docs/DESIGN.md §7)。
 * 軸は機械照合するため英語キー + 日本語説明のペアで定義する。
 */

import type { ArtifactKind } from "../core/types.js"

export interface RubricAxis {
  /** スコア合成が機械照合するキー */
  key: string
  /** プロンプト埋め込み・人間可読用の日本語説明 */
  label: string
}

const DECISION_AXES: RubricAxis[] = [
  { key: "objective_alignment", label: "目的整合" },
  { key: "risk_awareness", label: "リスク認識" },
  { key: "reversibility", label: "可逆性" },
  { key: "alternatives_considered", label: "代替案検討" }
]

const PLAN_AXES: RubricAxis[] = [
  { key: "objective_alignment", label: "目的整合" },
  { key: "scope_appropriateness", label: "スコープ妥当性" },
  { key: "procedure_completeness", label: "手順の完全性" },
  { key: "risk", label: "リスク" }
]

const DESIGN_AXES: RubricAxis[] = [
  { key: "requirement_coverage", label: "要件充足" },
  { key: "over_engineering", label: "過剰設計でないか" },
  { key: "consistency", label: "整合性" }
]

const CODE_AXES: RubricAxis[] = [
  { key: "objective_alignment", label: "objective との一致" },
  { key: "unintended_changes", label: "意図しない変更の混入" },
  { key: "breaking_changes", label: "破壊的変更" }
]

/** meta 評価専用の追加軸(§6・§7): 最悪被害と可逆性 */
export const BLAST_RADIUS_AXIS: RubricAxis = {
  key: "blast_radius",
  label: "blast radius(最悪被害と可逆性)"
}

const AXES_BY_KIND: Record<ArtifactKind, RubricAxis[]> = {
  decision: DECISION_AXES,
  plan: PLAN_AXES,
  design: DESIGN_AXES,
  code: CODE_AXES
}

/** kind 別ルーブリック軸を返す */
export function rubricFor(kind: ArtifactKind): RubricAxis[] {
  return AXES_BY_KIND[kind]
}

/** meta 評価用: kind 別軸 + blast_radius(§7 meta 共通軸) */
export function metaRubricFor(kind: ArtifactKind): RubricAxis[] {
  return [...rubricFor(kind), BLAST_RADIUS_AXIS]
}

/** プロンプト埋め込み用にルーブリック軸を箇条書き整形する */
export function formatRubric(axes: RubricAxis[]): string {
  return axes.map((axis) => `- ${axis.key}: ${axis.label}`).join("\n")
}
