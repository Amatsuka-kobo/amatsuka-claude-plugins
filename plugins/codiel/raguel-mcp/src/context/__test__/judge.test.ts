import { describe, expect, it } from "vitest"
import type { ArtifactKind, Finding, Severity } from "../../core/types.js"
import type { JevCall, JevRequest } from "../jev.js"
import {
  type ContextJudgeInput,
  type ContextJudgeSettings,
  runContextJudge,
  UNAVAILABLE_RULE_ID
} from "../judge.js"

const settings: ContextJudgeSettings = {
  enabled: true,
  timeoutMs: 1000,
  thresholds: { lower: 0.2, raise: 0.7 }
}

type FakeJev = JevCall & { calls: JevRequest[]; timeouts: number[] }

/** 質問ごとに固定の値を返す fake。指定の無い noul は 0.5、score は 1 */
function fakeJev(values: Record<string, number> = {}): FakeJev {
  const calls: JevRequest[] = []
  const timeouts: number[] = []
  const fn = (async (req, options) => {
    calls.push(req)
    timeouts.push(options.timeout)
    const answers: Record<string, unknown> = {}
    for (const [id, q] of Object.entries(req.questions)) {
      answers[id] =
        q.type === "noul"
          ? { type: "noul", noul: values[id] ?? 0.5 }
          : { type: "score", score: values[id] ?? 1 }
    }
    return { answers }
  }) as FakeJev
  fn.calls = calls
  fn.timeouts = timeouts
  return fn
}

const artifactLines = Array.from({ length: 20 }, (_, i) => `line${i + 1}`).join(
  "\n"
)

function input(over: Partial<ContextJudgeInput> = {}): ContextJudgeInput {
  return {
    kind: "code",
    objective: "目的",
    maskedArtifact: artifactLines,
    findings: [],
    candidates: [],
    priorFindings: [],
    decisionFields: {},
    resubmissionTargets: [],
    ...over
  }
}

function finding(ruleId: string, severity: Severity): Finding {
  return { ruleId, severity, message: `${ruleId} の所見` }
}

function destructiveInput(severity: Severity = "stop"): ContextJudgeInput {
  return input({
    findings: [finding("code/destructive-ops", severity)],
    candidates: [
      {
        ruleId: "code/destructive-ops",
        findingIndex: 0,
        path: "a.sh",
        line: 10
      }
    ]
  })
}

const run = (i: ContextJudgeInput, jev: JevCall, extra = {}) =>
  runContextJudge(i, { settings, apiKey: "test-key", jevCall: jev, ...extra })

describe("無効のとき", () => {
  it("呼ばずに決定論の結果をそのまま返す", async () => {
    const jev = fakeJev({ c0: 0 })
    const i = destructiveInput()
    const r = await runContextJudge(i, {
      settings: { ...settings, enabled: false },
      apiKey: "test-key",
      jevCall: jev
    })
    expect(r.status).toBe("off")
    expect(r.adjustedFindings).toEqual(i.findings)
    expect(r.record).toBeNull()
    expect(jev.calls).toHaveLength(0)
  })
})

describe("code/destructive-ops", () => {
  it("実行される確率が lower 以下なら stop を ask に下げる", async () => {
    const r = await run(destructiveInput(), fakeJev({ c0: 0.1 }))
    expect(r.status).toBe("ok")
    expect(r.adjustedFindings[0].severity).toBe("ask")
    expect(r.adjustments).toContainEqual({
      ruleId: "code/destructive-ops",
      from: "stop",
      to: "ask"
    })
  })

  it.each([0.5, 0.9])("確率 %s では stop のまま", async (p) => {
    const r = await run(destructiveInput(), fakeJev({ c0: p }))
    expect(r.adjustedFindings[0].severity).toBe("stop")
    expect(r.adjustedFindings[0].message).toContain(p.toFixed(2))
  })

  it("候補の抜粋は前後 5 行で、パスを持つ", async () => {
    const jev = fakeJev()
    await run(destructiveInput(), jev)
    const cand = jev.calls[0].state.candidates as Record<
      string,
      { path: string; excerpt: string }
    >
    expect(cand.c0.path).toBe("a.sh")
    expect(cand.c0.excerpt.split("\n")).toEqual(
      Array.from({ length: 11 }, (_, i) => `line${i + 5}`)
    )
  })

  it("決定論の規則で ask に下がった候補は問わない", async () => {
    const jev = fakeJev({ c0: 0.9 })
    const r = await run(destructiveInput("ask"), jev)
    expect(jev.calls.every((c) => c.state.candidates === undefined)).toBe(true)
    expect(r.adjustedFindings[0].severity).toBe("ask")
  })

  it("同じ所見の候補のどれかが実行されうるなら下げない", async () => {
    const i = destructiveInput()
    i.candidates.push({
      ruleId: "code/destructive-ops",
      findingIndex: 0,
      path: "a.sh",
      line: 12
    })
    const r = await run(i, fakeJev({ c0: 0.1, c1: 0.9 }))
    expect(r.adjustedFindings[0].severity).toBe("stop")
  })

  it("1 回 100 問を超えた候補は決定論の結果のままにし、partial と info を残す", async () => {
    const findings = Array.from({ length: 101 }, () =>
      finding("code/destructive-ops", "stop")
    )
    const candidates = findings.map((_, i) => ({
      ruleId: "code/destructive-ops" as const,
      findingIndex: i,
      path: `f${i}.sh`,
      line: 1
    }))
    const values = Object.fromEntries(candidates.map((_, i) => [`c${i}`, 0]))
    const jev = fakeJev(values)
    const r = await run(input({ findings, candidates }), jev)
    const cand = jev.calls.find((c) => c.state.candidates)
    expect(Object.keys(cand?.questions ?? {})).toHaveLength(100)
    expect(r.adjustedFindings[99].severity).toBe("ask")
    expect(r.adjustedFindings[100].severity).toBe("stop")
    expect(r.status).toBe("partial")
    expect(
      r.adjustedFindings.some((f) => f.ruleId === UNAVAILABLE_RULE_ID)
    ).toBe(true)
  })
})

describe("code/unsafe-exec", () => {
  it.each([
    0.05, 0.95
  ])("確率 %s を message に添え、severity は変えない", async (p) => {
    const i = input({
      findings: [finding("code/unsafe-exec", "ask")],
      candidates: [
        { ruleId: "code/unsafe-exec", findingIndex: 0, path: "a.ts", line: 3 }
      ]
    })
    const r = await run(i, fakeJev({ c0: p }))
    expect(r.adjustedFindings[0].severity).toBe("ask")
    expect(r.adjustedFindings[0].message).toContain(p.toFixed(2))
    expect(r.adjustments).toEqual([])
  })
})

describe("common/injection-marker", () => {
  it("正規表現の ask が無く raise 以上なら ask を足す", async () => {
    const r = await run(input(), fakeJev({ injection: 0.8 }))
    expect(r.adjustedFindings).toContainEqual(
      expect.objectContaining({
        ruleId: "common/injection-marker",
        severity: "ask"
      })
    )
  })

  it("閾値の間では足さない", async () => {
    const r = await run(input(), fakeJev({ injection: 0.5 }))
    expect(r.adjustedFindings).toEqual([])
  })

  it("正規表現の ask は確率が低くても残し、重ねて足さない", async () => {
    for (const p of [0, 0.9]) {
      const r = await run(
        input({ findings: [finding("common/injection-marker", "ask")] }),
        fakeJev({ injection: p })
      )
      expect(r.adjustedFindings).toEqual([
        finding("common/injection-marker", "ask")
      ])
    }
  })
})

const lexical: [string, string, ArtifactKind][] = [
  ["irreversible", "plan/irreversible-ops", "plan"],
  ["scope", "plan/scope-keywords", "design"],
  ["noRollback", "decision/no-rollback", "decision"],
  ["noAlternatives", "decision/no-alternatives", "decision"]
]

describe.each(lexical)("語彙系 %s(%s)", (id, ruleId, kind) => {
  it("info を raise 以上で ask に上げる", async () => {
    const r = await run(
      input({ kind, findings: [finding(ruleId, "info")] }),
      fakeJev({ [id]: 0.8 })
    )
    expect(r.adjustedFindings[0].severity).toBe("ask")
    expect(r.adjustments).toContainEqual({ ruleId, from: "info", to: "ask" })
  })

  it("所見が無ければ ask の所見を作る", async () => {
    const r = await run(input({ kind }), fakeJev({ [id]: 0.8 }))
    expect(r.adjustedFindings).toContainEqual(
      expect.objectContaining({ ruleId, severity: "ask" })
    )
  })

  it.each([0.5, 0])("確率 %s では info のまま", async (p) => {
    const r = await run(
      input({ kind, findings: [finding(ruleId, "info")] }),
      fakeJev({ [id]: p })
    )
    expect(r.adjustedFindings).toEqual([finding(ruleId, "info")])
  })

  it("kind が code なら問わない", async () => {
    const jev = fakeJev()
    await run(input(), jev)
    expect(Object.keys(jev.calls[0].questions)).not.toContain(id)
  })
})

describe("decision の欄", () => {
  it("rollbackPlan と optionsConsidered を state に入れる", async () => {
    const jev = fakeJev()
    await run(
      input({
        kind: "decision",
        decisionFields: { rollbackPlan: "戻す", optionsConsidered: ["A"] }
      }),
      jev
    )
    expect(jev.calls[0].state).toMatchObject({
      rollbackPlan: "戻す",
      optionsConsidered: ["A"]
    })
  })
})

describe("common/resubmission-loop", () => {
  const i = input({
    resubmissionTargets: [{ attempt: 2, similarity: 0.9 }],
    priorFindings: [
      { attempt: 2, ruleId: "panel/adversarial", message: "前回の指摘" },
      { attempt: 1, ruleId: "code/unsafe-exec", message: "古い指摘" }
    ]
  })

  it.each([
    0.2, 0.3
  ])("対処している確率 %s(1 − raise 以下)なら ask を出す", async (p) => {
    const r = await run(i, fakeJev({ resubmission2: p }))
    expect(r.adjustedFindings).toContainEqual(
      expect.objectContaining({
        ruleId: "common/resubmission-loop",
        severity: "ask"
      })
    )
  })

  it.each([0.5, 0.9])("確率 %s では出さない", async (p) => {
    const r = await run(i, fakeJev({ resubmission2: p }))
    expect(r.adjustedFindings).toEqual([])
  })

  it("state には対象の attempt の指摘だけを入れる", async () => {
    const jev = fakeJev()
    await run(i, jev)
    expect(jev.calls[0].state.priorFindings).toEqual([i.priorFindings[0]])
  })
})

describe("重さ", () => {
  it.each([
    [0, undefined],
    [2.4, undefined],
    [2.6, "standard"],
    [3.4, "standard"],
    [3.6, "critical"]
  ])("水準 %s で tier の下限は %s", async (s, floor) => {
    const r = await run(input(), fakeJev({ severity: s }))
    expect(r.tierFloor).toBe(floor)
    expect(r.record?.tierFloor).toBe(floor)
  })
})

describe("呼ばない場面", () => {
  it.each([
    "common/secrets",
    "code/protected-paths",
    "casefile/tampered"
  ])("%s の stop では呼ばない", async (ruleId) => {
    const jev = fakeJev({ c0: 0 })
    const i = destructiveInput()
    i.findings.push(finding(ruleId, "stop"))
    const r = await run(i, jev)
    expect(jev.calls).toHaveLength(0)
    expect(r.status).toBe("skipped")
    expect(r.record?.status).toBe("skipped")
    expect(r.adjustedFindings).toEqual(i.findings)
  })
})

describe("効かなかったとき", () => {
  function expectDeterministic(
    r: Awaited<ReturnType<typeof runContextJudge>>,
    i: ContextJudgeInput,
    cause: RegExp
  ) {
    expect(r.status).toBe("unavailable")
    expect(r.adjustedFindings.slice(0, i.findings.length)).toEqual(i.findings)
    const extra = r.adjustedFindings.slice(i.findings.length)
    expect(extra).toHaveLength(1)
    expect(extra[0]).toMatchObject({
      ruleId: UNAVAILABLE_RULE_ID,
      severity: "info"
    })
    expect(extra[0].message).toMatch(cause)
    expect(r.tierFloor).toBeUndefined()
  }

  it("鍵が無ければ呼ばない", async () => {
    const jev = fakeJev({ c0: 0 })
    const i = destructiveInput()
    const r = await runContextJudge(i, { settings, apiKey: " ", jevCall: jev })
    expect(jev.calls).toHaveLength(0)
    expectDeterministic(r, i, /TYPESAFE_API_KEY/)
  })

  it("例外で決定論の結果のままにし、再試行しない", async () => {
    let count = 0
    const jev: JevCall = async () => {
      count++
      throw new Error("boom")
    }
    const i = destructiveInput()
    const r = await run(i, jev)
    expect(count).toBe(2)
    expectDeterministic(r, i, /boom/)
  })

  it("タイムアウトで決定論の結果のままにする", async () => {
    const jev: JevCall = () => new Promise(() => {})
    const i = destructiveInput()
    const r = await runContextJudge(i, {
      settings: { ...settings, timeoutMs: 30 },
      apiKey: "test-key",
      jevCall: jev
    })
    expectDeterministic(r, i, /時間の上限 30 ms/)
    expect(r.record?.queries.every((q) => q.outcome === "timeout")).toBe(true)
  })

  it("入力が上限を超えたら本文を切らずに送らない", async () => {
    const jev = fakeJev({ injection: 1 })
    const i = input({ maskedArtifact: "a".repeat(70_000) })
    const r = await run(i, jev)
    expect(jev.calls).toHaveLength(0)
    expectDeterministic(r, i, /上限/)
    expect(r.record?.queries[0].outcome).toBe("over-limit")
  })

  it("回答の形が不正なら失敗とみなす", async () => {
    const jev: JevCall = async () => ({
      answers: { injection: { type: "noul", noul: 1.5 } }
    })
    const r = await run(input(), jev)
    expectDeterministic(r, input(), /回答の形が不正/)
  })

  it("締切までの残りが 3000 ms 以下なら呼ばない", async () => {
    const jev = fakeJev()
    const r = await run(input(), jev, { remainingMs: 3000 })
    expect(jev.calls).toHaveLength(0)
    expectDeterministic(r, input(), /締切/)
  })

  it("候補だけが失敗したら partial で、本文の結果は当てる", async () => {
    const jev: JevCall = async (req, options) => {
      if (req.state.candidates) throw new Error("candidates down")
      return fakeJev({ injection: 0.9 })(req, options)
    }
    const i = destructiveInput()
    const r = await run(i, jev)
    expect(r.status).toBe("partial")
    expect(r.adjustedFindings[0].severity).toBe("stop")
    expect(r.adjustedFindings).toContainEqual(
      expect.objectContaining({
        ruleId: "common/injection-marker",
        severity: "ask"
      })
    )
    expect(r.adjustedFindings).toContainEqual(
      expect.objectContaining({ ruleId: UNAVAILABLE_RULE_ID, severity: "info" })
    )
  })
})

describe("時間の上限", () => {
  it("min(timeoutMs, 締切までの残り − 3000) を渡す", async () => {
    const jev = fakeJev()
    await runContextJudge(input(), {
      settings: { ...settings, timeoutMs: 20000 },
      apiKey: "k",
      jevCall: jev,
      remainingMs: 10000
    })
    expect(jev.timeouts).toEqual([7000])
  })
})

describe("記録", () => {
  it("質問の ID・確率・水準・変更を残し、本文を入れない", async () => {
    const i = destructiveInput()
    i.maskedArtifact = artifactLines.replace(
      "line10",
      "rm -rf / UNIQUE_BODY_TEXT"
    )
    const r = await run(i, fakeJev({ c0: 0.1, severity: 3 }))
    expect(r.record?.answers).toContainEqual({
      id: "c0",
      ruleId: "code/destructive-ops",
      path: "a.sh",
      probability: 0.1
    })
    expect(r.record?.answers).toContainEqual({
      id: "severity",
      ruleId: "weight",
      level: 3
    })
    expect(r.record?.adjustments).toEqual(r.adjustments)
    expect(JSON.stringify(r.record)).not.toContain("UNIQUE_BODY_TEXT")
  })
})

describe("Jev は単独で STOP も PROCEED も出さない", () => {
  const cases: ContextJudgeInput[] = (
    ["code", "plan", "design", "decision"] as const
  ).map((kind) =>
    input({
      kind,
      findings: [
        finding("code/destructive-ops", "stop"),
        finding("code/destructive-ops", "ask"),
        finding("code/unsafe-exec", "ask"),
        finding("common/injection-marker", "ask"),
        finding("plan/irreversible-ops", "info"),
        finding("plan/scope-keywords", "ask"),
        finding("decision/no-rollback", "info"),
        finding("decision/no-alternatives", "info"),
        finding("common/max-size", "ask")
      ],
      candidates: [
        { ruleId: "code/destructive-ops", findingIndex: 0, path: "a", line: 1 },
        { ruleId: "code/destructive-ops", findingIndex: 1, path: "a", line: 2 },
        { ruleId: "code/unsafe-exec", findingIndex: 2, path: "a", line: 3 }
      ],
      resubmissionTargets: [{ attempt: 1, similarity: 0.9 }]
    })
  )

  it.each([
    0, 1
  ])("すべての確率が %s でも許された向きの外へ動かさない", async (p) => {
    for (const i of cases) {
      const values: Record<string, number> = { severity: p * 4 }
      for (const id of [
        "c0",
        "c1",
        "c2",
        "injection",
        "irreversible",
        "scope",
        "noRollback",
        "noAlternatives",
        "resubmission1"
      ])
        values[id] = p
      const r = await run(i, fakeJev(values))
      i.findings.forEach((before, idx) => {
        const after = r.adjustedFindings[idx]
        expect(after.ruleId).toBe(before.ruleId)
        if (after.severity === before.severity) return
        const lowered =
          before.ruleId === "code/destructive-ops" &&
          before.severity === "stop" &&
          after.severity === "ask"
        const raised = before.severity === "info" && after.severity === "ask"
        expect(lowered || raised).toBe(true)
      })
      for (const added of r.adjustedFindings.slice(i.findings.length))
        expect(added.severity).not.toBe("stop")
      for (const a of r.adjustments) {
        expect(a.to).not.toBe("stop")
        if (a.from === "stop")
          expect(a).toEqual({
            ruleId: "code/destructive-ops",
            from: "stop",
            to: "ask"
          })
        if (a.from === "info") expect(a.to).toBe("ask")
      }
      expect(r.tierFloor === undefined || r.tierFloor !== "trivial").toBe(true)
    }
  })
})
