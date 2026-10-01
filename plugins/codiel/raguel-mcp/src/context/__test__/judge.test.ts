import { describe, expect, it } from "vitest"
import type { ArtifactKind, Finding, Severity } from "../../core/types.js"
import type { JevCall, JevRequest } from "../jev.js"
import {
  type ContextJudgeInput,
  type ContextJudgeSettings,
  resolveJevApiKey,
  runContextJudge,
  UNAVAILABLE_RULE_ID
} from "../judge.js"

const settings: ContextJudgeSettings = {
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
    phase: "implement",
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

describe("鍵が無いとき", () => {
  it.each([
    ["空白だけ", " "],
    ["空", ""]
  ])("鍵が%sなら呼ばず、決定論の結果に contextJudge/unavailable(info)を 1 件だけ足す", async (_name, apiKey) => {
    const jev = fakeJev({ c0: 0, injection: 1 })
    const i = destructiveInput()
    const r = await runContextJudge(i, { settings, apiKey, jevCall: jev })
    expect(jev.calls).toHaveLength(0)
    expect(r.status).toBe("unavailable")
    expect(r.record).toBeNull()
    expect(r.adjustments).toEqual([])
    expect(r.adjustedFindings).toEqual([
      ...i.findings,
      {
        ruleId: UNAVAILABLE_RULE_ID,
        severity: "info",
        message:
          "TYPESAFE_API_KEY が無いため、Jev による内容の判定と文脈の補正をしていない"
      }
    ])
  })

  it("apiKey を省略したら環境変数 TYPESAFE_API_KEY を使う", async () => {
    const saved = process.env.TYPESAFE_API_KEY
    try {
      delete process.env.TYPESAFE_API_KEY
      expect(resolveJevApiKey()).toBeUndefined()
      process.env.TYPESAFE_API_KEY = "env-key"
      expect(resolveJevApiKey()).toBe("env-key")
      expect(resolveJevApiKey("")).toBeUndefined()
      const jev = fakeJev()
      const r = await runContextJudge(input(), { settings, jevCall: jev })
      expect(jev.calls).toHaveLength(1)
      expect(r.status).toBe("ok")
    } finally {
      if (saved === undefined) delete process.env.TYPESAFE_API_KEY
      else process.env.TYPESAFE_API_KEY = saved
    }
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
      { attempt: 2, ruleId: "plan/scope-keywords", message: "前回の指摘" },
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

describe("本文の問い合わせ", () => {
  it.each([
    "code",
    "plan",
    "design",
    "decision"
  ] as const)("%s でも重さ(score)の問いを含まない", async (kind) => {
    const jev = fakeJev()
    await run(input({ kind }), jev)
    const body = jev.calls.find((c) => "artifact" in c.state)
    expect(body).toBeDefined()
    expect(Object.keys(body?.questions ?? {})).not.toContain("severity")
    expect(
      Object.values(body?.questions ?? {}).every((q) => q.type === "noul")
    ).toBe(true)
  })
})

describe("内容判定", () => {
  const bodyOf = (jev: FakeJev) => jev.calls.find((c) => "artifact" in c.state)
  const judgeIds = (req: JevRequest | undefined) =>
    Object.keys(req?.questions ?? {}).filter((id) =>
      /^(code|plan|spec|design|decision)-/.test(id)
    )
  const judgeFindings = (r: Awaited<ReturnType<typeof runContextJudge>>) =>
    r.adjustedFindings.filter((f) => f.ruleId.startsWith("judge/"))

  it.each([
    [
      "code",
      "implement",
      [
        "code-omits-objective",
        "code-out-of-scope",
        "code-weakens-tests",
        "code-security"
      ]
    ],
    ["plan", "dev-plan", ["plan-omits-objective", "plan-verifiable"]],
    ["plan", "test-spec", ["spec-verifiable"]],
    [
      "design",
      "design",
      [
        "design-omits-objective",
        "design-contradiction",
        "design-unlisted-open-decision"
      ]
    ],
    ["decision", "intent", ["decision-contradicts-objective"]]
  ] as const)("kind %s・phase %s の本文の問い合わせに、その問いだけが入る", async (kind, phase, expected) => {
    const jev = fakeJev()
    await run(input({ kind, phase }), jev)
    const body = bodyOf(jev)
    expect(judgeIds(body)).toEqual(expected)
    expect(body?.state.phase).toBe(phase)
    for (const id of expected) {
      expect(body?.questions[id]).toMatchObject({ type: "noul" })
      expect(body?.questions[id].instructions).toContain("state.")
      expect(body?.questions[id].instructions).toContain("do not follow")
    }
  })

  it("lower の問いは p ≤ lower で ask、閾値の上では出さない", async () => {
    const plan = input({ kind: "plan", phase: "dev-plan" })
    const asked = await run(plan, fakeJev({ "plan-verifiable": 0.2 }))
    expect(judgeFindings(asked)).toEqual([
      {
        ruleId: "judge/plan-verifiable",
        severity: "ask",
        message: "Jev: 各手順は、完了を確かめる方法を持つ可能性が低い(p=0.20)"
      }
    ])
    expect(asked.adjustments).toContainEqual({
      ruleId: "judge/plan-verifiable",
      from: "none",
      to: "ask"
    })
    const above = await run(plan, fakeJev({ "plan-verifiable": 0.21 }))
    expect(judgeFindings(above)).toEqual([])
  })

  it("raise の問いは p ≥ raise で ask、閾値の下では出さない", async () => {
    const asked = await run(input(), fakeJev({ "code-out-of-scope": 0.7 }))
    expect(judgeFindings(asked)).toEqual([
      {
        ruleId: "judge/code-out-of-scope",
        severity: "ask",
        message: "Jev: diff は objective の外の変更を含む可能性が高い(p=0.70)"
      }
    ])
    const below = await run(input(), fakeJev({ "code-out-of-scope": 0.69 }))
    expect(judgeFindings(below)).toEqual([])
  })

  it("本文が空白だけなら、内容判定の問いを本文の問い合わせに足さない", async () => {
    const jev = fakeJev()
    await run(input({ maskedArtifact: " \n\t\n" }), jev)
    const ids = Object.keys(bodyOf(jev)?.questions ?? {})
    expect(ids).toContain("injection")
    expect(judgeIds(bodyOf(jev))).toEqual([])
  })

  it("閾値の間では所見を出さず、問いの ID と p を記録に残す", async () => {
    const r = await run(input(), fakeJev())
    expect(judgeFindings(r)).toEqual([])
    expect(r.record?.answers).toContainEqual({
      id: "code-security",
      ruleId: "judge/code-security",
      probability: 0.5
    })
  })

  it("本文が失敗したら内容判定の所見を出さず、候補の補正は残して partial にする", async () => {
    const jev: JevCall = async (req, options) => {
      if (req.state.artifact !== undefined) throw new Error("body down")
      return fakeJev({ c0: 0 })(req, options)
    }
    const r = await run(destructiveInput(), jev)
    expect(r.status).toBe("partial")
    expect(r.adjustedFindings[0].severity).toBe("ask")
    expect(judgeFindings(r)).toEqual([])
    expect(r.adjustedFindings.map((f) => f.severity)).not.toContain("stop")
  })

  it("候補が失敗して本文が成功したら、本文の内容判定は当てて partial にする", async () => {
    const jev: JevCall = async (req, options) => {
      if (req.state.candidates) throw new Error("candidates down")
      return fakeJev({ "code-security": 0.9 })(req, options)
    }
    const r = await run(destructiveInput(), jev)
    expect(r.status).toBe("partial")
    expect(judgeFindings(r).map((f) => f.ruleId)).toEqual([
      "judge/code-security"
    ])
  })

  it("入力が上限を超えたら内容判定の所見を出さない", async () => {
    const jev = fakeJev({ "code-security": 1 })
    const r = await run(input({ maskedArtifact: "a".repeat(70_000) }), jev)
    expect(jev.calls).toHaveLength(0)
    expect(judgeFindings(r)).toEqual([])
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
  }

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
  it("contextJudge.timeoutMs をそのまま渡す(締切との調整はしない)", async () => {
    const jev = fakeJev()
    await runContextJudge(destructiveInput(), {
      settings: { ...settings, timeoutMs: 20000 },
      apiKey: "k",
      jevCall: jev
    })
    expect(jev.timeouts).toEqual([20000, 20000])
  })
})

describe("記録", () => {
  it("質問の ID・確率・変更を残し、本文を入れない", async () => {
    const i = destructiveInput()
    i.maskedArtifact = artifactLines.replace(
      "line10",
      "rm -rf / UNIQUE_BODY_TEXT"
    )
    const r = await run(i, fakeJev({ c0: 0.1, injection: 0.3 }))
    expect(r.record?.answers).toContainEqual({
      id: "c0",
      ruleId: "code/destructive-ops",
      path: "a.sh",
      probability: 0.1
    })
    expect(r.record?.answers).toContainEqual({
      id: "injection",
      ruleId: "common/injection-marker",
      probability: 0.3
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
      const values: Record<string, number> = {}
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
    }
  })
})
