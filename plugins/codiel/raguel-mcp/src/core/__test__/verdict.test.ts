import { describe, expect, it } from "vitest"
import { makeConfig } from "../../rules/testHelpers.js"
import type { Finding, MetaReport, PanelReport } from "../types.js"
import {
  type PanelResult,
  type SteelmanVerdict,
  type SynthesisInput,
  stanceVariance,
  synthesize
} from "../verdict.js"

const config = makeConfig()

function finding(
  ruleId: string,
  severity: Finding["severity"],
  confidence?: number
): Finding {
  return { ruleId, severity, confidence, message: `test ${ruleId}` }
}

function report(
  panelist: PanelReport["panelist"],
  findings: Finding[] = [],
  scores: Record<string, number> = { objective_alignment: 90 }
): PanelReport {
  return { panelist, model: "haiku", findings, scores }
}

const goodMeta: MetaReport = {
  model: "haiku",
  scores: { objective_alignment: 90, blast_radius_contained: 85 },
  rationale: "問題なし"
}

function panel(overrides: Partial<PanelResult> = {}): PanelResult {
  return {
    reports: [report("adversarial"), report("steelman")],
    steelmanVerdicts: [],
    errorFindings: [],
    degradedReasons: [],
    ...overrides
  }
}

function input(overrides: Partial<SynthesisInput>): SynthesisInput {
  return {
    weightTier: "standard",
    ruleFindings: [],
    panel: panel(),
    config,
    ...overrides
  }
}

function rebut(
  panelist: SteelmanVerdict["panelist"],
  findingIndex: number
): SteelmanVerdict {
  return { panelist, findingIndex, outcome: "rebutted", rebuttal: "反駁" }
}

describe("ステップ 1: ルール層の stop", () => {
  it("stop があれば STOP。障害があっても judgeStatus は ok", () => {
    const r = synthesize(
      input({
        ruleFindings: [finding("code/destructive-ops", "stop")],
        panel: undefined,
        degradedReasons: [{ source: "kernel", reason: "internal-error" }]
      })
    )
    expect(r.verdict).toBe("STOP")
    expect(r.judgeStatus).toBe("ok")
    expect(r.degradedReasons).toEqual([])
    expect(r.reasons[0]).toMatch(/^rule-stop:/)
    expect(r.decisionPoint).toContain("code/destructive-ops")
  })
})

describe("ステップ 2: パネルの所見の分類", () => {
  it("confidence が閾値(既定 70)以上で反駁されていない ask だけを採用する(C2)", () => {
    const r = synthesize(
      input({
        panel: panel({
          reports: [
            report("adversarial", [
              finding("panel/adversarial", "ask", 70),
              finding("panel/adversarial", "ask", 65)
            ])
          ]
        })
      })
    )
    expect(config.judge.thresholds.confidence).toBe(70)
    const panelFindings = r.findings.filter(
      (f) => f.ruleId === "panel/adversarial"
    )
    expect(panelFindings.map((f) => f.severity)).toEqual(["ask", "info"])
    expect(r.verdict).toBe("ASK")
  })

  it("steelman に反駁された adversarial の所見は info に下がる", () => {
    const r = synthesize(
      input({
        panel: panel({
          reports: [
            report("adversarial", [finding("panel/adversarial", "ask", 95)])
          ],
          steelmanVerdicts: [rebut("adversarial", 0)]
        })
      })
    )
    expect(r.findings[0].severity).toBe("info")
    expect(r.findings[0].message).toContain("steelman が反駁した")
    expect(r.verdict).toBe("PROCEED")
  })

  it("文書の standard で crosscheck の所見も steelman の反駁で下がる(R15)", () => {
    const r = synthesize(
      input({
        panel: panel({
          reports: [
            report("adversarial", [finding("panel/adversarial", "ask", 90)]),
            report("crosscheck", [finding("panel/crosscheck", "ask", 90)])
          ],
          steelmanVerdicts: [rebut("adversarial", 0), rebut("crosscheck", 0)]
        })
      })
    )
    expect(r.findings.map((f) => f.severity)).toEqual(["info", "info"])
    expect(r.verdict).toBe("PROCEED")
  })

  it("反駁は panelist と添字の組で照合する(別のパネリストの同じ添字を下げない)", () => {
    const r = synthesize(
      input({
        panel: panel({
          reports: [
            report("adversarial", [finding("panel/adversarial", "ask", 90)]),
            report("crosscheck", [finding("panel/crosscheck", "ask", 90)])
          ],
          steelmanVerdicts: [rebut("adversarial", 0)]
        })
      })
    )
    const cross = r.findings.find((f) => f.ruleId === "panel/crosscheck")
    expect(cross?.severity).toBe("ask")
    expect(r.verdict).toBe("ASK")
  })

  it("steelman 自身の所見は info として残り、判定を動かさない", () => {
    const r = synthesize(
      input({
        panel: panel({
          reports: [
            report("adversarial"),
            report("steelman", [finding("panel/steelman", "ask", 99)])
          ]
        })
      })
    )
    expect(r.findings[0].severity).toBe("info")
    expect(r.verdict).toBe("PROCEED")
  })
})

describe("ステップ 3: 基盤の障害(D2)", () => {
  it("パネルの障害は degraded の ASK で、理由と所見 0 件でも decisionPoint を返す(D6)", () => {
    const r = synthesize(
      input({
        panel: panel({
          reports: [],
          errorFindings: [finding("panel/adversarial-error", "ask")],
          degradedReasons: [{ source: "adversarial", reason: "timeout" }]
        })
      })
    )
    expect(r.verdict).toBe("ASK")
    expect(r.judgeStatus).toBe("degraded")
    expect(r.degradedReasons).toEqual([
      { source: "adversarial", reason: "timeout" }
    ])
    expect(r.decisionPoint).toContain("adversarial")
    expect(r.reasons.some((s) => s.startsWith("degraded:"))).toBe(true)
  })

  it("パネルの外の障害(kernel・config)も degraded にする", () => {
    const r = synthesize(
      input({
        weightTier: "trivial",
        panel: undefined,
        degradedReasons: [{ source: "config", reason: "config-error" }]
      })
    )
    expect(r.verdict).toBe("ASK")
    expect(r.judgeStatus).toBe("degraded")
    expect(r.findings).toEqual([])
    expect(r.decisionPoint).toBeDefined()
  })

  it("パネルが要る重さでパネルの結果が無ければ degraded の ASK にする(黙って PROCEED にしない)", () => {
    const r = synthesize(input({ weightTier: "critical", panel: undefined }))
    expect(r.verdict).toBe("ASK")
    expect(r.degradedReasons).toEqual([
      { source: "kernel", reason: "panel-not-run" }
    ])
  })

  it("障害はルール層の ask より先に当たる", () => {
    const r = synthesize(
      input({
        ruleFindings: [finding("code/unsafe-exec", "ask")],
        degradedReasons: [{ source: "kernel", reason: "internal-error" }]
      })
    )
    expect(r.judgeStatus).toBe("degraded")
  })
})

describe("ステップ 4〜5: ルール層の ask と採用された所見", () => {
  it("ルール層の ask は ASK で、judgeStatus は ok", () => {
    const r = synthesize(
      input({ ruleFindings: [finding("code/unsafe-exec", "ask")] })
    )
    expect(r.verdict).toBe("ASK")
    expect(r.judgeStatus).toBe("ok")
    expect(r.reasons.at(-1)).toMatch(/^rule-ask:/)
    expect(r.decisionPoint).toContain("code/unsafe-exec")
  })

  it("採用された所見があれば ASK", () => {
    const r = synthesize(
      input({
        panel: panel({
          reports: [
            report("adversarial", [finding("panel/adversarial", "ask", 80)])
          ]
        })
      })
    )
    expect(r.verdict).toBe("ASK")
    expect(r.reasons.at(-1)).toMatch(/^panel-ask:/)
    expect(r.decisionPoint).toContain("1 件")
  })
})

describe("ステップ 6〜7: trivial と standard", () => {
  it("trivial でルール層に ask 以上が無ければ PROCEED(decisionPoint なし)", () => {
    const r = synthesize(
      input({
        weightTier: "trivial",
        panel: undefined,
        ruleFindings: [finding("plan/scope-keywords", "info")]
      })
    )
    expect(r.verdict).toBe("PROCEED")
    expect(r.decisionPoint).toBeUndefined()
  })

  it("standard ではスコアが低くても乖離が大きくても PROCEED で、乖離度は記録する(C2・R15)", () => {
    const r = synthesize(
      input({
        panel: panel({
          reports: [
            report("adversarial", [], { consistency: 5 }),
            report("crosscheck", [], { consistency: 95 }),
            report("steelman", [], { consistency: 100 })
          ]
        })
      })
    )
    expect(r.verdict).toBe("PROCEED")
    expect(r.variance).toBe(90)
    expect(r.reasons.at(-1)).toMatch(/^standard-pass:/)
  })
})

describe("ステップ 8〜10: critical", () => {
  function critical(overrides: Partial<PanelResult>): SynthesisInput {
    return input({
      weightTier: "critical",
      panel: panel({
        reports: [
          report("adversarial", [], { consistency: 80 }),
          report("crosscheck", [], { consistency: 90 }),
          report("steelman", [], { consistency: 10 })
        ],
        meta: goodMeta,
        ...overrides
      })
    })
  }

  it("meta の全軸が閾値以上で乖離が閾値以下なら PROCEED", () => {
    const r = synthesize(critical({}))
    expect(r.verdict).toBe("PROCEED")
    expect(r.reasons.at(-1)).toMatch(/^meta-pass:/)
  })

  it("adversarial と crosscheck の共通の軸の差が maxVariance を超えたら ASK(steelman は数えない)", () => {
    const r = synthesize(
      critical({
        reports: [
          report("adversarial", [], { consistency: 40, extra: 0 }),
          report("crosscheck", [], { consistency: 90 }),
          report("steelman", [], { consistency: 90 })
        ]
      })
    )
    expect(r.verdict).toBe("ASK")
    expect(r.reasons.at(-1)).toMatch(/^variance:/)
    expect(r.decisionPoint).toContain("consistency")
  })

  it("meta のいずれかの軸が proceed 未満なら ASK", () => {
    const r = synthesize(
      critical({
        meta: {
          ...goodMeta,
          scores: { ...goodMeta.scores, blast_radius_contained: 79 }
        }
      })
    )
    expect(r.verdict).toBe("ASK")
    expect(r.decisionPoint).toContain("blast_radius_contained")
  })

  it("meta が無ければ ASK に倒す", () => {
    const r = synthesize(critical({ meta: undefined }))
    expect(r.verdict).toBe("ASK")
    expect(r.reasons.at(-1)).toMatch(/^meta-missing:/)
  })
})

describe("stanceVariance", () => {
  it("adversarial と crosscheck の共通の軸だけを比べる", () => {
    expect(
      stanceVariance([
        report("adversarial", [], { a: 10, b: 50 }),
        report("crosscheck", [], { a: 30, c: 0 }),
        report("steelman", [], { a: 100 })
      ])
    ).toEqual({ max: 20, byAxis: { a: 20 } })
  })

  it("どちらかが無ければ null", () => {
    expect(stanceVariance([report("adversarial")])).toBeNull()
  })
})
