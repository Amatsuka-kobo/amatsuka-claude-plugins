/**
 * codiel のゲート付きフェーズの表(設計書 §6.1)。
 * codiel の `STAGES`・`GATED`(`plugins/codiel/src/codiel-state.ts`)と同じ値を持つ。
 * 両者の一致は `__test__/phases.test.ts` が確かめる。codiel の src は import しない。
 */

export type GatedPhase =
  | "intent"
  | "carry-over"
  | "design"
  | "test-spec"
  | "dev-plan"
  | "test-code"
  | "implement"
  | "test-loop"
  | "intent-sync"
  | "fix-loop"

export type PhaseKind = "decision" | "design" | "plan" | "code"

export type EvaluateTool =
  | "evaluate_decision"
  | "evaluate_design"
  | "evaluate_plan"
  | "evaluate_code"

export interface PhaseEntry {
  phase: GatedPhase
  /** codiel の `STAGES` の添字。ゲートの無いステージも数える。 */
  stage: number
  kind: PhaseKind
  tool: EvaluateTool
}

export const GATED_PHASES: readonly PhaseEntry[] = [
  { phase: "intent", stage: 0, kind: "decision", tool: "evaluate_decision" },
  { phase: "carry-over", stage: 1, kind: "code", tool: "evaluate_code" },
  { phase: "design", stage: 3, kind: "design", tool: "evaluate_design" },
  { phase: "test-spec", stage: 4, kind: "plan", tool: "evaluate_plan" },
  { phase: "dev-plan", stage: 4, kind: "plan", tool: "evaluate_plan" },
  { phase: "test-code", stage: 5, kind: "code", tool: "evaluate_code" },
  { phase: "implement", stage: 6, kind: "code", tool: "evaluate_code" },
  { phase: "test-loop", stage: 7, kind: "code", tool: "evaluate_code" },
  { phase: "intent-sync", stage: 8, kind: "design", tool: "evaluate_design" },
  { phase: "fix-loop", stage: 11, kind: "code", tool: "evaluate_code" }
]

/** 表にあるフェーズの表引き。表に無ければ undefined。 */
export function findPhase(phase: string): PhaseEntry | undefined {
  return GATED_PHASES.find((e) => e.phase === phase)
}

/**
 * 前フェーズ = ステージ番号がそれより小さいゲート付きフェーズすべて。
 * 同じステージの test-spec と dev-plan は、互いに前フェーズにならない。
 * 表に無いフェーズには空配列を返す。
 */
export function priorPhasesOf(phase: string): GatedPhase[] {
  const entry = findPhase(phase)
  if (!entry) return []
  return GATED_PHASES.filter((e) => e.stage < entry.stage).map((e) => e.phase)
}
