export type Verdict = "satisfied" | "unsatisfied" | "uncertain"
export type Judged = { probability: number; verdict: Verdict }
export type Thresholds = { satisfied: number; unsatisfied: number }

export function validateThresholds(thresholds: Thresholds): string | null {
  if (thresholds.unsatisfied >= thresholds.satisfied) {
    return "unsatisfied must be lower than satisfied"
  }
  return null
}

export function judge(probability: number, thresholds: Thresholds): Judged {
  const verdict: Verdict =
    probability >= thresholds.satisfied
      ? "satisfied"
      : probability <= thresholds.unsatisfied
        ? "unsatisfied"
        : "uncertain"
  return { probability, verdict }
}

export function scoreLevel(
  scoreValue: number,
  levels: readonly string[]
): { level: number; label: string } {
  const level = Math.round(scoreValue)
  return { level, label: levels[level] }
}
