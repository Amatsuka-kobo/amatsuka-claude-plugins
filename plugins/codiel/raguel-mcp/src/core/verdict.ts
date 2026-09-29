/**
 * 判定の合成規則(設計書 §6.6.3)。10 のステップを順に当て、最初に決まったものを採る。決定論の純関数。
 * - STOP はルール層だけが出す。パネルと meta は STOP を出せない
 * - steelman の反駁で下げられるのは adversarial と crosscheck の所見だけ
 * - 自由記述(rationale・rebuttal)は判定の入力にしない
 * - 基盤の障害(§6.8)は内容の懸念と分け、judgeStatus を degraded にして ASK にする
 */

import type {
  DegradedReason,
  Finding,
  JudgeStatus,
  MetaReport,
  PanelReport,
  RaguelConfig,
  Verdict,
  WeightTier
} from "./types.js"

/** steelman の反駁の対象になるパネリスト(攻める立場) */
export type TargetPanelist = "adversarial" | "crosscheck"

export interface SteelmanVerdict {
  panelist: TargetPanelist
  /** そのパネリストの findings の中の添字(0 始まり) */
  findingIndex: number
  outcome: "rebutted" | "conceded"
  rebuttal: string
}

/** パネルの実行結果のうち合成が読む部分(panel/runner.ts の PanelOutcome がこれを満たす) */
export interface PanelResult {
  reports: PanelReport[]
  steelmanVerdicts: SteelmanVerdict[]
  /** critical で meta が成功したときだけ */
  meta?: MetaReport
  /** 失敗したパネリストと meta の panel/<名前>-error(ask) */
  errorFindings: Finding[]
  degradedReasons: DegradedReason[]
}

export interface SynthesisInput {
  weightTier: WeightTier
  /** ルール層の所見(前フェーズの改竄の casefile/tampered を含む) */
  ruleFindings: Finding[]
  /** パネルを起動しなかったときは undefined(ルール層の stop・trivial) */
  panel?: PanelResult
  /** パネルの外の障害(kernel・config など) */
  degradedReasons?: DegradedReason[]
  config: RaguelConfig
}

export interface SynthesisResult {
  verdict: Verdict
  judgeStatus: JudgeStatus
  /** judgeStatus が degraded のときだけ中身がある */
  degradedReasons: DegradedReason[]
  /** ルール層の所見、分類後のパネルの所見、パネルの失敗の所見の順 */
  findings: Finding[]
  /** 当てたステップの記録 */
  reasons: string[]
  /** ASK と STOP のとき、人が判断することを 1 文で(所見 D6) */
  decisionPoint?: string
  /** adversarial と crosscheck の共通の軸のスコアの差の最大。両方がそろわなければ null。記録用 */
  variance: number | null
}

/** adversarial と crosscheck の共通の軸ごとのスコアの差(同じ立場のパネリストの乖離度) */
export function stanceVariance(
  reports: readonly PanelReport[]
): { max: number; byAxis: Record<string, number> } | null {
  const adv = reports.find((r) => r.panelist === "adversarial")
  const cross = reports.find((r) => r.panelist === "crosscheck")
  if (!adv || !cross) return null
  const byAxis: Record<string, number> = {}
  let max = 0
  for (const [axis, a] of Object.entries(adv.scores)) {
    const c = cross.scores[axis]
    if (c === undefined) continue
    const diff = Math.abs(a - c)
    byAxis[axis] = diff
    if (diff > max) max = diff
  }
  return { max, byAxis }
}

function asInfo(finding: Finding, note: string): Finding {
  return {
    ...finding,
    severity: "info",
    message: `${finding.message}(${note})`
  }
}

function uniqueIds(findings: readonly Finding[]): string {
  return [...new Set(findings.map((f) => f.ruleId))].join("、")
}

interface Classified {
  findings: Finding[]
  adopted: Finding[]
  rebuttedCount: number
  belowCount: number
}

/** ステップ 2: パネルの所見を分類する */
function classifyPanelFindings(
  panel: PanelResult,
  confidenceMin: number
): Classified {
  const out: Classified = {
    findings: [],
    adopted: [],
    rebuttedCount: 0,
    belowCount: 0
  }
  for (const report of panel.reports) {
    const isTarget =
      report.panelist === "adversarial" || report.panelist === "crosscheck"
    report.findings.forEach((finding, index) => {
      if (!isTarget) {
        // steelman 自身の所見は判定を動かさない
        out.findings.push(
          finding.severity === "info"
            ? finding
            : asInfo(finding, "steelman の所見は判定に使わない")
        )
        return
      }
      if (finding.severity === "info") {
        out.findings.push(finding)
        return
      }
      const rebutted = panel.steelmanVerdicts.some(
        (v) =>
          v.panelist === report.panelist &&
          v.findingIndex === index &&
          v.outcome === "rebutted"
      )
      if (rebutted) {
        out.rebuttedCount++
        out.findings.push(asInfo(finding, "steelman が反駁した"))
        return
      }
      const confidence = finding.confidence ?? 0
      if (confidence < confidenceMin) {
        out.belowCount++
        out.findings.push(
          asInfo(finding, `confidence ${confidence} < ${confidenceMin}`)
        )
        return
      }
      const adopted: Finding = { ...finding, severity: "ask" }
      out.adopted.push(adopted)
      out.findings.push(adopted)
    })
  }
  return out
}

export function synthesize(input: SynthesisInput): SynthesisResult {
  const { config, panel, weightTier } = input
  const reasons: string[] = []
  const ruleFindings = input.ruleFindings
  const variance = panel ? (stanceVariance(panel.reports)?.max ?? null) : null

  const result = (
    verdict: Verdict,
    findings: Finding[],
    extra: Partial<
      Pick<SynthesisResult, "judgeStatus" | "degradedReasons" | "decisionPoint">
    > = {}
  ): SynthesisResult => ({
    verdict,
    judgeStatus: extra.judgeStatus ?? "ok",
    degradedReasons: extra.degradedReasons ?? [],
    findings,
    reasons,
    ...(extra.decisionPoint ? { decisionPoint: extra.decisionPoint } : {}),
    variance
  })

  // 1. ルール層の stop。パネルは起動しない前提で、judgeStatus は ok のまま
  const stops = ruleFindings.filter((f) => f.severity === "stop")
  if (stops.length > 0) {
    reasons.push(`rule-stop: ルール層の stop(${uniqueIds(stops)})により STOP`)
    return result("STOP", [...ruleFindings], {
      decisionPoint: `ルール層の stop の所見(${uniqueIds(stops)})を解消して再提出するか、誤検知として裁定するかを判断する。`
    })
  }

  // 2. パネルの所見の分類
  const classified = panel
    ? classifyPanelFindings(panel, config.judge.thresholds.confidence)
    : { findings: [], adopted: [], rebuttedCount: 0, belowCount: 0 }
  const findings = [
    ...ruleFindings,
    ...classified.findings,
    ...(panel?.errorFindings ?? [])
  ]
  if (panel) {
    reasons.push(
      `panel-findings: 採用 ${classified.adopted.length} 件、steelman の反駁で info ${classified.rebuttedCount} 件、confidence ${config.judge.thresholds.confidence} 未満で info ${classified.belowCount} 件`
    )
  }

  // 3. 基盤の障害
  const degradedReasons = [
    ...(input.degradedReasons ?? []),
    ...(panel?.degradedReasons ?? [])
  ]
  if (weightTier !== "trivial" && !panel) {
    // パネルが要る重さなのに起動していない。黙って PROCEED にしない
    degradedReasons.push({ source: "kernel", reason: "panel-not-run" })
  }
  if (degradedReasons.length > 0) {
    const sources = [...new Set(degradedReasons.map((r) => r.source))].join(
      "、"
    )
    reasons.push(
      `degraded: 基盤の障害(${degradedReasons.map((r) => `${r.source}: ${r.reason}`).join("、")})により ASK`
    )
    return result("ASK", findings, {
      judgeStatus: "degraded",
      degradedReasons,
      decisionPoint: `判定の基盤に障害があり(${sources})審査が欠けているので、人が成果物を確かめて進めるか、再評価するかを判断する。`
    })
  }

  // 4. ルール層の ask
  const ruleAsks = ruleFindings.filter((f) => f.severity === "ask")
  if (ruleAsks.length > 0) {
    reasons.push(`rule-ask: ルール層の ask(${uniqueIds(ruleAsks)})により ASK`)
    return result("ASK", findings, {
      decisionPoint: `ルール層の ask の所見(${uniqueIds(ruleAsks)})が妥当か、成果物を直すべきかを判断する。`
    })
  }

  // 5. 採用されたパネルの所見
  if (classified.adopted.length > 0) {
    reasons.push(
      `panel-ask: 採用されたパネルの所見 ${classified.adopted.length} 件により ASK`
    )
    return result("ASK", findings, {
      decisionPoint: `パネルが採用した所見 ${classified.adopted.length} 件(${uniqueIds(classified.adopted)})に対処が要るかを判断する。`
    })
  }

  // 6. trivial
  if (weightTier === "trivial") {
    reasons.push(
      "trivial-pass: trivial でルール層に ask 以上が無いため PROCEED"
    )
    return result("PROCEED", findings)
  }

  // 7. standard。スコアと乖離度は記録するが判定に使わない
  if (weightTier === "standard") {
    reasons.push(
      `standard-pass: standard で採用された所見が無いため PROCEED(スコアと乖離度 ${variance ?? "なし"} は判定に使わない)`
    )
    return result("PROCEED", findings)
  }

  // 8. critical の同じ立場のパネリストの乖離
  const stance = panel ? stanceVariance(panel.reports) : null
  const maxVariance = config.judge.thresholds.maxVariance
  if (stance && stance.max > maxVariance) {
    const axes = Object.entries(stance.byAxis)
      .filter(([, d]) => d > maxVariance)
      .map(([k]) => k)
    reasons.push(
      `variance: adversarial と crosscheck のスコアの差 ${stance.max} > ${maxVariance}(軸 ${axes.join("、")})のため ASK`
    )
    return result("ASK", findings, {
      decisionPoint: `adversarial と crosscheck の評価が軸 ${axes.join("、")} で割れているので、どちらの見方を採るかを判断する。`
    })
  }

  // 9. critical の meta
  const meta = panel?.meta
  const axes = meta ? Object.entries(meta.scores) : []
  if (axes.length === 0) {
    // 通常は meta の失敗が 3 で degraded になる。ここに来るのは想定外の形なので ASK に倒す
    reasons.push("meta-missing: critical で meta のスコアが無いため ASK")
    return result("ASK", findings, {
      decisionPoint:
        "critical の評価で meta のスコアが得られなかったので、人が成果物を確かめて進めるかを判断する。"
    })
  }
  const proceed = config.judge.thresholds.proceed
  const below = axes.filter(([, v]) => v < proceed).map(([k]) => k)
  if (below.length > 0) {
    reasons.push(
      `meta-below: meta の軸 ${below.join("、")} が閾値 ${proceed} 未満のため ASK`
    )
    return result("ASK", findings, {
      decisionPoint: `meta が軸 ${below.join("、")} を閾値 ${proceed} 未満と評価したので、その懸念を受け入れて進めるかを判断する。`
    })
  }

  // 10. PROCEED
  reasons.push(`meta-pass: meta の全軸が閾値 ${proceed} 以上のため PROCEED`)
  return result("PROCEED", findings)
}
