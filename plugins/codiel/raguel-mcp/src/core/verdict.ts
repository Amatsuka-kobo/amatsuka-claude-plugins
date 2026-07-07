/**
 * 判定の合成規則(DESIGN.md §2)。完全に決定論的な純関数。
 *
 * 優先順位は常に STOP > ASK > PROCEED。
 * - STOP はルール層の専権(judge.canStop での明示緩和のみ例外)
 * - steelman の反駁が降格できるのはパネル発(adversarial)の所見のみ
 * - 自由記述(rationale)は入力にしない。動かせるのは構造化フィールドのみ
 */

import type {
  Finding,
  MetaReport,
  PanelReport,
  RaguelConfig,
  Verdict,
  WeightTier
} from "./types.js"

/**
 * judge.canStop 有効時に meta 軸スコアがこの値未満なら STOP を許す。
 * 設定项目にはしない(緩和方向の事故を防ぐための固定床)。
 */
const CAN_STOP_SCORE_FLOOR = 20

export interface SteelmanVerdict {
  /** adversarial findings 配列内のインデックス */
  findingIndex: number
  outcome: "rebutted" | "conceded"
  rebuttal: string
}

export interface SynthesisInput {
  weightTier: WeightTier
  /** ルール層の findings(severity info/ask/stop) */
  ruleFindings: Finding[]
  /** パネルを実行したか(trivial ティアや STOP 即決では false) */
  panelRan: boolean
  panelReports: PanelReport[]
  /** steelman による adversarial 所見への個別反駁 */
  steelmanVerdicts?: SteelmanVerdict[]
  /** パネリスト失敗のフェイルクローズド所見(常に採用) */
  panelErrorFindings: Finding[]
  meta?: MetaReport
  /** standard 以上なのにパネルを実行できなかった(provider none 等) */
  panelUnavailable?: boolean
  config: RaguelConfig
}

export interface SynthesisResult {
  verdict: Verdict
  /** 合成後に生き残った findings(ルール + 採用/降格済みパネル所見) */
  findings: Finding[]
  /** どの規則がどう効いたか(説明可能性・証拠ファイル用) */
  reasons: string[]
}

/** パネル間(meta 含む)の同名軸スコアの最大乖離 */
export function maxScoreVariance(
  reports: PanelReport[],
  meta?: MetaReport
): number {
  const byAxis = new Map<string, number[]>()
  const all: Array<Record<string, number>> = [
    ...reports.map((r) => r.scores),
    ...(meta ? [meta.scores] : [])
  ]
  for (const scores of all) {
    for (const [axis, value] of Object.entries(scores)) {
      const list = byAxis.get(axis) ?? []
      list.push(value)
      byAxis.set(axis, list)
    }
  }
  let worst = 0
  for (const values of byAxis.values()) {
    if (values.length < 2) continue
    const spread = Math.max(...values) - Math.min(...values)
    if (spread > worst) worst = spread
  }
  return worst
}

function asInfo(finding: Finding, note: string): Finding {
  return {
    ...finding,
    severity: "info",
    message: `${finding.message}(${note})`
  }
}

export function synthesize(input: SynthesisInput): SynthesisResult {
  const { config } = input
  const reasons: string[] = []
  const findings: Finding[] = [...input.ruleFindings]

  const ruleStop = input.ruleFindings.some((f) => f.severity === "stop")
  const ruleAsk = input.ruleFindings.some((f) => f.severity === "ask")

  // 規則 1: ルール層の stop は即時確定。パネル・meta では覆せない
  if (ruleStop) {
    reasons.push("rule-stop: ルール層の stop 所見により STOP(覆せない)")
    return { verdict: "STOP", findings, reasons }
  }

  // パネル所見の合成(規則 3)
  const confidenceMin = config.judge.thresholds.confidence
  let adoptedAsk = false

  for (const report of input.panelReports) {
    report.findings.forEach((finding, index) => {
      const confidence = finding.confidence ?? 0
      if (report.panelist === "adversarial") {
        const rebutted = input.steelmanVerdicts?.some(
          (v) => v.findingIndex === index && v.outcome === "rebutted"
        )
        if (rebutted) {
          // 降格できるのはパネル発の所見のみ(不変条件 2)。ここがその唯一の適用点
          findings.push(asInfo(finding, "steelman により反駁済み"))
          return
        }
      }
      if (finding.severity === "info") {
        findings.push(finding)
        return
      }
      if (confidence >= confidenceMin) {
        findings.push({ ...finding, severity: "ask" })
        adoptedAsk = true
      } else {
        findings.push(
          asInfo(finding, `confidence ${confidence} < ${confidenceMin}`)
        )
      }
    })
  }

  // パネリスト失敗はフェイルクローズドで常に採用
  if (input.panelErrorFindings.length > 0) {
    findings.push(...input.panelErrorFindings)
    adoptedAsk = true
    reasons.push("panel-error: パネリスト失敗によりフェイルクローズド")
  }

  if (input.panelUnavailable) {
    adoptedAsk = true
    reasons.push("panel-unavailable: パネル必要ティアで実行不能のため ASK")
  }

  // 規則 6(canStop 緩和): meta 軸スコアが固定床未満なら STOP を許す
  if (config.judge.canStop && input.meta) {
    const minScore = Math.min(...Object.values(input.meta.scores))
    if (
      Object.keys(input.meta.scores).length > 0 &&
      minScore < CAN_STOP_SCORE_FLOOR
    ) {
      reasons.push(
        `can-stop: meta 軸スコア最小値 ${minScore} < ${CAN_STOP_SCORE_FLOOR}`
      )
      return { verdict: "STOP", findings, reasons }
    }
  }

  // 規則 2: ルール層の ask はパネルで下げられない(ASK 床)
  if (ruleAsk) {
    reasons.push("rule-ask: ルール層の ask 所見により ASK 床(降格不可)")
    return { verdict: "ASK", findings, reasons }
  }

  if (adoptedAsk) {
    reasons.push("panel-ask: 採用されたパネル所見により ASK")
    return { verdict: "ASK", findings, reasons }
  }

  // パネル未実施(trivial)はルール全通過なら PROCEED(§3 [3])
  if (!input.panelRan) {
    reasons.push("trivial-pass: ルール全通過・パネル不要のため PROCEED")
    return { verdict: "PROCEED", findings, reasons }
  }

  // 規則 5: 分散は ASK に倒す
  const variance = maxScoreVariance(input.panelReports, input.meta)
  if (variance > config.judge.thresholds.maxVariance) {
    reasons.push(
      `variance: パネル間スコア乖離 ${variance} > ${config.judge.thresholds.maxVariance} のため ASK`
    )
    return { verdict: "ASK", findings, reasons }
  }

  // 規則 4: meta 評価の閾値写像。meta 不在はフェイルクローズドで ASK
  if (!input.meta) {
    reasons.push("meta-missing: meta 評価がないため ASK(フェイルクローズド)")
    return { verdict: "ASK", findings, reasons }
  }
  const axes = Object.entries(input.meta.scores)
  if (axes.length === 0) {
    reasons.push("meta-empty: meta スコアが空のため ASK(フェイルクローズド)")
    return { verdict: "ASK", findings, reasons }
  }
  const below = axes.filter(([, v]) => v < config.judge.thresholds.proceed)
  if (below.length > 0) {
    reasons.push(
      `meta-below: 軸 ${below.map(([k]) => k).join(", ")} が閾値 ${config.judge.thresholds.proceed} 未満のため ASK`
    )
    return { verdict: "ASK", findings, reasons }
  }

  reasons.push("meta-pass: meta 全軸が閾値以上のため PROCEED")
  return { verdict: "PROCEED", findings, reasons }
}
