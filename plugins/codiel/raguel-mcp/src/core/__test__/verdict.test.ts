import { describe, expect, it } from "vitest"
import type {
  Finding,
  MetaReport,
  PanelReport,
  RaguelConfig
} from "../types.js"
import {
  maxScoreVariance,
  type SynthesisInput,
  synthesize
} from "../verdict.js"

const config: RaguelConfig = {
  version: 1,
  onError: "ASK",
  storage: {
    casesDir: "/tmp/raguel-test",
    retention: { maxRuns: 200, maxDays: 90 }
  },
  judge: {
    provider: "none",
    model: "haiku",
    timeoutMs: 60000,
    canStop: false,
    maxConcurrency: 4,
    thresholds: { proceed: 80, confidence: 60, maxVariance: 30 }
  },
  weight: { tiers: { standard: 30, critical: 70 } },
  panel: {
    trivial: [],
    standard: ["adversarial"],
    critical: [
      "adversarial",
      "steelman",
      "crosscheck",
      "assumption",
      "precedent"
    ],
    perPanelist: {}
  },
  precedent: { seedCatalog: true, topN: 5 },
  rules: {}
}

function finding(
  ruleId: string,
  severity: Finding["severity"],
  confidence?: number
): Finding {
  return { ruleId, severity, confidence, message: `test ${ruleId}` }
}

function report(
  panelist: PanelReport["panelist"],
  findings: Finding[],
  scores: Record<string, number> = { objective_alignment: 90 }
): PanelReport {
  return { panelist, model: "haiku", findings, scores }
}

const goodMeta: MetaReport = {
  model: "haiku",
  scores: { objective_alignment: 90, blast_radius: 85 },
  rationale: "問題なし"
}

function base(overrides: Partial<SynthesisInput>): SynthesisInput {
  return {
    weightTier: "standard",
    ruleFindings: [],
    panelRan: true,
    panelReports: [],
    panelErrorFindings: [],
    meta: goodMeta,
    config,
    ...overrides
  }
}

describe("synthesize: ルール層の専権(規則 1・2)", () => {
  it("ルール stop は即時 STOP", () => {
    const r = synthesize(
      base({ ruleFindings: [finding("code/protected-paths", "stop")] })
    )
    expect(r.verdict).toBe("STOP")
  })

  it("ルール stop は meta 満点でも覆らない", () => {
    const r = synthesize(
      base({
        ruleFindings: [finding("common/secrets", "stop")],
        panelReports: [report("adversarial", [])],
        meta: {
          model: "haiku",
          scores: { objective_alignment: 100 },
          rationale: ""
        }
      })
    )
    expect(r.verdict).toBe("STOP")
  })

  it("ルール ask は ASK 床(パネルが下げられない)", () => {
    const r = synthesize(
      base({
        ruleFindings: [finding("code/max-diff-lines", "ask")],
        panelReports: [report("adversarial", [])],
        meta: goodMeta
      })
    )
    expect(r.verdict).toBe("ASK")
  })

  it("steelman の反駁はルール層の所見を降格できない", () => {
    // steelmanVerdicts は adversarial の所見にしか作用しない構造だが、
    // 万一 index が重なってもルール finding は input.ruleFindings 側なので不変
    const r = synthesize(
      base({
        ruleFindings: [finding("plan/irreversible-ops", "ask")],
        panelReports: [report("adversarial", [])],
        steelmanVerdicts: [
          { findingIndex: 0, outcome: "rebutted", rebuttal: "反駁" }
        ]
      })
    )
    expect(r.verdict).toBe("ASK")
    expect(
      r.findings.find((f) => f.ruleId === "plan/irreversible-ops")?.severity
    ).toBe("ask")
  })
})

describe("synthesize: パネル所見の合成(規則 3)", () => {
  it("反駁されなかった adversarial 所見(confidence 閾値以上)は ask 採用", () => {
    const r = synthesize(
      base({
        panelReports: [
          report("adversarial", [finding("panel/adversarial", "ask", 80)])
        ],
        steelmanVerdicts: [
          { findingIndex: 0, outcome: "conceded", rebuttal: "" }
        ]
      })
    )
    expect(r.verdict).toBe("ASK")
  })

  it("steelman が反駁した adversarial 所見は info に降格され PROCEED", () => {
    const r = synthesize(
      base({
        panelReports: [
          report("adversarial", [finding("panel/adversarial", "ask", 80)])
        ],
        steelmanVerdicts: [
          { findingIndex: 0, outcome: "rebutted", rebuttal: "反駁成功" }
        ]
      })
    )
    expect(r.verdict).toBe("PROCEED")
    const demoted = r.findings.find((f) => f.ruleId === "panel/adversarial")
    expect(demoted?.severity).toBe("info")
  })

  it("confidence 閾値未満のパネル所見は info 降格で判定に効かない", () => {
    const r = synthesize(
      base({
        panelReports: [
          report("adversarial", [finding("panel/adversarial", "ask", 40)])
        ]
      })
    )
    expect(r.verdict).toBe("PROCEED")
  })

  it("crosscheck / precedent の所見は steelman に降格されない", () => {
    const r = synthesize(
      base({
        panelReports: [
          report("adversarial", []),
          report("crosscheck", [finding("panel/crosscheck", "ask", 90)])
        ],
        steelmanVerdicts: [
          { findingIndex: 0, outcome: "rebutted", rebuttal: "" }
        ]
      })
    )
    expect(r.verdict).toBe("ASK")
  })

  it("パネリスト失敗の errorFindings は常に ASK(フェイルクローズド)", () => {
    const r = synthesize(
      base({
        panelErrorFindings: [finding("panel/adversarial-error", "ask")]
      })
    )
    expect(r.verdict).toBe("ASK")
  })

  it("panelUnavailable は ASK", () => {
    const r = synthesize(base({ panelUnavailable: true }))
    expect(r.verdict).toBe("ASK")
  })
})

describe("synthesize: meta 閾値写像(規則 4)", () => {
  it("全軸が proceed 閾値以上なら PROCEED", () => {
    expect(synthesize(base({})).verdict).toBe("PROCEED")
  })

  it("1 軸でも閾値未満なら ASK", () => {
    const r = synthesize(
      base({
        meta: {
          model: "haiku",
          scores: { objective_alignment: 90, blast_radius: 79 },
          rationale: ""
        }
      })
    )
    expect(r.verdict).toBe("ASK")
  })

  it("パネル実施なのに meta 不在なら ASK(フェイルクローズド)", () => {
    expect(synthesize(base({ meta: undefined })).verdict).toBe("ASK")
  })

  it("meta スコアが空なら ASK", () => {
    const r = synthesize(
      base({ meta: { model: "haiku", scores: {}, rationale: "" } })
    )
    expect(r.verdict).toBe("ASK")
  })
})

describe("synthesize: 分散(規則 5)", () => {
  it("同名軸の乖離が maxVariance 超過なら ASK", () => {
    const r = synthesize(
      base({
        panelReports: [
          report("adversarial", [], { risk: 90 }),
          report("crosscheck", [], { risk: 50 })
        ]
      })
    )
    expect(r.verdict).toBe("ASK")
    expect(r.reasons.some((s) => s.startsWith("variance"))).toBe(true)
  })

  it("乖離が閾値以内なら PROCEED", () => {
    const r = synthesize(
      base({
        panelReports: [
          report("adversarial", [], { risk: 90 }),
          report("crosscheck", [], { risk: 70 })
        ]
      })
    )
    expect(r.verdict).toBe("PROCEED")
  })

  it("maxScoreVariance は meta のスコアも含める", () => {
    expect(
      maxScoreVariance(
        [report("adversarial", [], { objective_alignment: 40 })],
        goodMeta
      )
    ).toBe(50)
  })
})

describe("synthesize: canStop(規則 6)", () => {
  const canStopConfig: RaguelConfig = {
    ...config,
    judge: { ...config.judge, canStop: true }
  }

  it("既定(canStop: false)では meta が最低でも STOP しない", () => {
    const r = synthesize(
      base({
        meta: {
          model: "haiku",
          scores: { objective_alignment: 5 },
          rationale: ""
        }
      })
    )
    expect(r.verdict).toBe("ASK")
  })

  it("canStop: true で meta 軸が固定床未満なら STOP", () => {
    const r = synthesize(
      base({
        config: canStopConfig,
        meta: {
          model: "haiku",
          scores: { objective_alignment: 5 },
          rationale: ""
        }
      })
    )
    expect(r.verdict).toBe("STOP")
  })
})

describe("synthesize: trivial(パネル未実施)", () => {
  it("ルール全通過なら PROCEED", () => {
    const r = synthesize(
      base({ panelRan: false, meta: undefined, weightTier: "trivial" })
    )
    expect(r.verdict).toBe("PROCEED")
  })

  it("info のみのルール所見では PROCEED のまま", () => {
    const r = synthesize(
      base({
        panelRan: false,
        meta: undefined,
        weightTier: "trivial",
        ruleFindings: [finding("decision/no-alternatives", "info")]
      })
    )
    expect(r.verdict).toBe("PROCEED")
  })
})
