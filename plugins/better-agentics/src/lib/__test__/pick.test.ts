import { describe, expect, it } from "vitest"
import type { Definition } from "../agents"
import type { JevAsk, JevRequest } from "../jev"
import { type PickDeps, pickDelegate } from "../pick"

function def(
  name: string,
  role: string,
  whenToInvoke = `- ${name}`
): Definition {
  return {
    file: name,
    name,
    role,
    model: undefined,
    effort: undefined,
    tools: undefined,
    toolsFormat: "none",
    whenToInvoke
  }
}

interface Fake {
  requests: JevRequest[]
  ask: JevAsk
}

function fakeJev(answers: Record<string, unknown>): Fake {
  const requests: JevRequest[] = []
  return {
    requests,
    ask: async (request) => {
      requests.push(request)
      return {
        model: "jev",
        answers,
        usage: { input_tokens: 1, output_tokens: 1 }
      } as never
    }
  }
}

function failingJev(): JevAsk {
  return async () => {
    throw new Error("HTTP 500")
  }
}

function deps(
  definitions: Definition[],
  ask: JevAsk,
  apiKey: string | null = "k"
): PickDeps {
  return { definitions, apiKey: apiKey ?? undefined, createAsk: () => ask }
}

const REVIEWERS = [
  def("docs-reviewer", "design-review"),
  def("knowledge-elicitor", "knowledge-elicitation", ""),
  def("code-reviewer", "code-review")
]
const REVIEW_INPUT = JSON.stringify({
  reason: "review",
  task: { summary: "Review the design doc", artifacts: ["docs/x.md"] }
})

function noul(value: number) {
  return { type: "noul", noul: value }
}

describe("review", () => {
  it("0.5 以上の候補を走査順で返し、候補ごとの noul を 1 回で問う", async () => {
    const jev = fakeJev({
      candidate_0: noul(0.91),
      candidate_1: noul(0.73),
      candidate_2: noul(0.2)
    })
    expect(await pickDelegate(REVIEW_INPUT, deps(REVIEWERS, jev.ask))).toEqual({
      ok: true,
      reason: "review",
      agents: [
        { agent: "docs-reviewer", role: "design-review", p: 0.91 },
        { agent: "knowledge-elicitor", role: "knowledge-elicitation", p: 0.73 }
      ]
    })
    expect(jev.requests).toHaveLength(1)
    const questions = jev.requests[0]?.questions ?? {}
    expect(Object.keys(questions)).toHaveLength(3)
    expect(Object.values(questions).every((q) => q.type === "noul")).toBe(true)
  })

  it("全員が 0.5 未満なら確率が最も高い 1 人に fallback を付けて返す", async () => {
    const jev = fakeJev({
      candidate_0: noul(0.3),
      candidate_1: noul(0.45),
      candidate_2: noul(0.1)
    })
    expect(await pickDelegate(REVIEW_INPUT, deps(REVIEWERS, jev.ask))).toEqual({
      ok: true,
      reason: "review",
      agents: [
        { agent: "knowledge-elicitor", role: "knowledge-elicitation", p: 0.45 }
      ],
      fallback: true
    })
  })

  it("基準は質問の側にだけ置き、state には作業内容だけを入れる", async () => {
    const jev = fakeJev({
      candidate_0: noul(0.9),
      candidate_1: noul(0.9),
      candidate_2: noul(0.9)
    })
    await pickDelegate(REVIEW_INPUT, deps(REVIEWERS, jev.ask))
    const request = jev.requests[0]
    expect(request?.state).toEqual({
      summary: "Review the design doc",
      artifacts: ["docs/x.md"]
    })
    const first = JSON.stringify(request?.questions.candidate_0)
    expect(first).toContain("docs-reviewer")
    expect(first).toContain("- docs-reviewer")
    expect(JSON.stringify(request?.questions.candidate_1)).toContain(
      "(no criteria)"
    )
    expect(JSON.stringify(request?.state)).not.toContain("- docs-reviewer")
  })
})

describe("split", () => {
  const WORKERS = [
    def("implementer", "normal-impl"),
    def("explorer", "explore", "")
  ]
  const SPLIT_INPUT = JSON.stringify({
    reason: "split",
    tasks: [
      { id: "a", summary: "Implement the parser" },
      { id: "b", summary: "Find all callers" }
    ]
  })

  it("作業ごとの choice を 1 回で問い、選んだ選択肢の確率を p にする", async () => {
    const jev = fakeJev({
      task_0: {
        type: "choice",
        choice: "implementer",
        confidence: 0.8,
        probabilities: { implementer: 0.82, explorer: 0.18 }
      },
      task_1: {
        type: "choice",
        choice: "explorer",
        confidence: 0.9,
        probabilities: { implementer: 0.05, explorer: 0.95 }
      }
    })
    expect(await pickDelegate(SPLIT_INPUT, deps(WORKERS, jev.ask))).toEqual({
      ok: true,
      reason: "split",
      assignments: [
        { id: "a", agent: "implementer", role: "normal-impl", p: 0.82 },
        { id: "b", agent: "explorer", role: "explore", p: 0.95 }
      ]
    })
    expect(jev.requests).toHaveLength(1)
    const question = jev.requests[0]?.questions.task_0 as unknown as {
      type: string
      instructions: string
      criteria: Record<string, string | null>
    }
    expect(question.type).toBe("choice")
    expect(question.instructions).toContain('"a"')
    expect(question.instructions).toContain("Implement the parser")
    expect(question.criteria).toEqual({
      implementer: "- implementer",
      explorer: null
    })
  })

  it("同じ定義が 2 つの作業に選ばれても両方に返す", async () => {
    const both = {
      type: "choice",
      choice: "implementer",
      confidence: 0.6,
      probabilities: { implementer: 0.6, explorer: 0.4 }
    }
    const result = await pickDelegate(
      SPLIT_INPUT,
      deps(WORKERS, fakeJev({ task_0: both, task_1: both }).ask)
    )
    expect(result).toMatchObject({
      assignments: [{ agent: "implementer" }, { agent: "implementer" }]
    })
  })

  it("役割が違い name が同じ候補があれば duplicate-role を返す", async () => {
    const result = await pickDelegate(
      SPLIT_INPUT,
      deps(
        [def("worker", "normal-impl"), def("worker", "explore")],
        failingJev()
      )
    )
    expect(result).toMatchObject({ ok: false, error: "duplicate-role" })
    expect(result.ok === false && result.message).toContain("worker")
  })
})

describe("Jev を呼ばない場面", () => {
  it("候補が 1 つなら Jev を呼ばず p を付けない。キーが無くてもよい", async () => {
    const jev = fakeJev({})
    expect(
      await pickDelegate(
        REVIEW_INPUT,
        deps([def("code-reviewer", "code-review")], jev.ask, null)
      )
    ).toEqual({
      ok: true,
      reason: "review",
      agents: [{ agent: "code-reviewer", role: "code-review" }]
    })
    expect(
      await pickDelegate(
        JSON.stringify({ reason: "split", tasks: [{ id: "a", summary: "x" }] }),
        deps([def("implementer", "normal-impl")], jev.ask, null)
      )
    ).toEqual({
      ok: true,
      reason: "split",
      assignments: [{ id: "a", agent: "implementer", role: "normal-impl" }]
    })
    expect(jev.requests).toHaveLength(0)
  })

  it("stuck は escalation の定義を返す", async () => {
    const jev = fakeJev({})
    expect(
      await pickDelegate(
        JSON.stringify({ reason: "stuck", task: { summary: "x" } }),
        deps([def("lead", "escalation"), ...REVIEWERS], jev.ask, null)
      )
    ).toEqual({
      ok: true,
      reason: "stuck",
      agents: [{ agent: "lead", role: "escalation" }]
    })
    expect(jev.requests).toHaveLength(0)
  })
})

describe("エラー", () => {
  async function errorOf(
    raw: string,
    definitions = REVIEWERS,
    ask: JevAsk = failingJev(),
    apiKey: string | null = "k"
  ) {
    const result = await pickDelegate(raw, deps(definitions, ask, apiKey))
    return result.ok ? undefined : result
  }

  it("invalid-input", async () => {
    for (const raw of [
      "not json",
      JSON.stringify({ reason: "other" }),
      JSON.stringify({
        reason: "review",
        task: { summary: "", artifacts: [] }
      }),
      JSON.stringify({
        reason: "review",
        task: { summary: "x", artifacts: "a" }
      }),
      JSON.stringify({ reason: "split", tasks: [] }),
      JSON.stringify({
        reason: "split",
        tasks: [
          { id: "a", summary: "x" },
          { id: "a", summary: "y" }
        ]
      }),
      JSON.stringify({ reason: "stuck", task: {} })
    ]) {
      expect((await errorOf(raw))?.error, raw).toBe("invalid-input")
    }
  })

  it("no-candidates は setup を案内する", async () => {
    const error = await errorOf(REVIEW_INPUT, [
      def("implementer", "normal-impl")
    ])
    expect(error?.error).toBe("no-candidates")
    expect(error?.message).toContain("better-agentics:setup")
  })

  it("duplicate-role は定義名を並べ、理由に対応しない役割の重複では止まらない", async () => {
    const error = await errorOf(REVIEW_INPUT, [
      ...REVIEWERS,
      def("code-reviewer-2", "code-review")
    ])
    expect(error?.error).toBe("duplicate-role")
    expect(error?.message).toContain("code-reviewer, code-reviewer-2")
    expect(error?.message).toContain("better-agentics:setup")

    const jev = fakeJev({
      candidate_0: noul(0.9),
      candidate_1: noul(0.9),
      candidate_2: noul(0.9)
    })
    const result = await pickDelegate(
      REVIEW_INPUT,
      deps(
        [...REVIEWERS, def("i1", "normal-impl"), def("i2", "normal-impl")],
        jev.ask
      )
    )
    expect(result.ok).toBe(true)
  })

  it("no-api-key は Jev が要るときだけ返す", async () => {
    expect(
      (await errorOf(REVIEW_INPUT, REVIEWERS, failingJev(), null))?.error
    ).toBe("no-api-key")
  })

  it("jev-failed は呼び出しの失敗と想定外の応答で返す", async () => {
    const thrown = await errorOf(REVIEW_INPUT)
    expect(thrown?.error).toBe("jev-failed")
    expect(thrown?.message).toContain("HTTP 500")

    const outOfRange = fakeJev({
      candidate_0: noul(1.2),
      candidate_1: noul(0.1),
      candidate_2: noul(0.1)
    })
    expect(
      (await errorOf(REVIEW_INPUT, REVIEWERS, outOfRange.ask))?.error
    ).toBe("jev-failed")

    const missing = fakeJev({ candidate_0: noul(0.9) })
    expect((await errorOf(REVIEW_INPUT, REVIEWERS, missing.ask))?.error).toBe(
      "jev-failed"
    )

    const workers = [
      def("implementer", "normal-impl"),
      def("explorer", "explore")
    ]
    const strange = fakeJev({
      task_0: {
        type: "choice",
        choice: "nobody",
        confidence: 1,
        probabilities: { nobody: 1 }
      }
    })
    expect(
      (
        await errorOf(
          JSON.stringify({
            reason: "split",
            tasks: [{ id: "a", summary: "x" }]
          }),
          workers,
          strange.ask
        )
      )?.error
    ).toBe("jev-failed")
  })

  it("役割表に無い role-id の定義は候補にしない", async () => {
    const error = await errorOf(REVIEW_INPUT, [def("old", "final-review")])
    expect(error?.error).toBe("no-candidates")
  })
})
