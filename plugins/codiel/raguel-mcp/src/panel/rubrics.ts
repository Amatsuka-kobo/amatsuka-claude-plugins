/**
 * kind ごとのルーブリックの軸(設計書 §6.6.2)。
 * 軸のキーは機械で照合するので英語にし、どれも「100 = 問題なし」と読める名前にする(所見 C2)。
 */

import type { ArtifactKind } from "../core/types.js"

export interface RubricAxis {
  /** スコアの合成が照合するキー */
  key: string
  /** プロンプトに埋め込む日本語の説明。100 点のときの状態を書く */
  label: string
}

const DECISION_AXES: RubricAxis[] = [
  { key: "objective_alignment", label: "目的に沿っている" },
  { key: "risk_awareness", label: "リスクを認識している" },
  { key: "reversibility", label: "取り消せる" },
  { key: "alternatives_considered", label: "代替案を検討している" }
]

const PLAN_AXES: RubricAxis[] = [
  { key: "objective_alignment", label: "目的に沿っている" },
  { key: "scope_fit", label: "範囲が目的に合っている" },
  { key: "procedure_completeness", label: "手順に抜けが無い" },
  { key: "risk_controlled", label: "リスクが抑えられている" }
]

const DESIGN_AXES: RubricAxis[] = [
  { key: "requirement_coverage", label: "要件を満たしている" },
  { key: "appropriate_complexity", label: "複雑さが要件に見合っている" },
  { key: "consistency", label: "記述どうしと既存の構成に矛盾が無い" }
]

const CODE_AXES: RubricAxis[] = [
  { key: "objective_alignment", label: "objective に沿っている" },
  { key: "no_unintended_changes", label: "意図しない変更が混ざっていない" },
  { key: "no_breaking_changes", label: "既存の振る舞いを壊していない" }
]

/** meta だけが持つ追加の軸 */
export const BLAST_RADIUS_AXIS: RubricAxis = {
  key: "blast_radius_contained",
  label: "誤っていたときの被害が小さく、取り消せる"
}

const AXES_BY_KIND: Record<ArtifactKind, RubricAxis[]> = {
  decision: DECISION_AXES,
  plan: PLAN_AXES,
  design: DESIGN_AXES,
  code: CODE_AXES
}

export function rubricFor(kind: ArtifactKind): RubricAxis[] {
  return AXES_BY_KIND[kind]
}

/** meta 用: kind の軸に blast_radius_contained を足す */
export function metaRubricFor(kind: ArtifactKind): RubricAxis[] {
  return [...rubricFor(kind), BLAST_RADIUS_AXIS]
}

export function formatRubric(axes: RubricAxis[]): string {
  return axes.map((axis) => `- ${axis.key}: ${axis.label}`).join("\n")
}
