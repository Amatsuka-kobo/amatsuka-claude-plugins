import { describe, expect, it } from "vitest"
import type { Definition } from "../agents"
import type { JevAsk, JevRequest } from "../jev"
import { type PickDeps, parseInput, pickDelegate } from "../pick"

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
  return {
    definitions,
    config: { kind: "absent" },
    apiKey: apiKey ?? undefined,
    createAsk: () => ask,
    forkEnabled: true,
    standardCriteria: (roleId) => `- standard ${roleId}`,
    preambles: {
      standard: (roleId, lang) => `standard:${roleId}:${lang}`,
      fork: (roleId, lang) => `fork:${roleId}:${lang}`
    }
  }
}

describe("入力", () => {
  const review = { reason: "review", task: { summary: "x", artifacts: [] } }

  it("parentModel・lang・excludeRoles を省くと既定値になる", () => {
    expect(parseInput(JSON.stringify(review))).toMatchObject({
      parentModel: undefined,
      lang: "en",
      excludeRoles: []
    })
  })

  it("値を渡せばそのまま読む", () => {
    expect(
      parseInput(
        JSON.stringify({
          ...review,
          parentModel: "sonnet",
          lang: "ja",
          excludeRoles: ["code-review"]
        })
      )
    ).toMatchObject({
      parentModel: "sonnet",
      lang: "ja",
      excludeRoles: ["code-review"]
    })
  })

  it("split の needsContext は省くと false になる", () => {
    const input = parseInput(
      JSON.stringify({
        reason: "split",
        tasks: [
          { id: "a", summary: "x" },
          { id: "b", summary: "y", needsContext: true }
        ]
      })
    )
    expect(input.reason === "split" && input.tasks).toEqual([
      { id: "a", summary: "x", needsContext: false },
      { id: "b", summary: "y", needsContext: true }
    ])
  })

  it("excludeRoles: [] は省いたのと同じになる", () => {
    expect(parseInput(JSON.stringify({ ...review, excludeRoles: [] }))).toEqual(
      parseInput(JSON.stringify(review))
    )
  })

  it.each([
    ["parentModel が別名でない", { ...review, parentModel: "gpt" }],
    ["lang がパスを含む", { ...review, lang: "../x" }],
    [
      "excludeRoles に役割表に無い ID",
      { ...review, excludeRoles: ["no-such-role"] }
    ],
    ["excludeRoles が配列でない", { ...review, excludeRoles: "escalation" }],
    [
      "needsContext が真偽値でない",
      {
        reason: "split",
        tasks: [{ id: "a", summary: "x", needsContext: "yes" }]
      }
    ]
  ])("%s は invalid-input", async (_label, value) => {
    expect(
      await pickDelegate(JSON.stringify(value), deps([], fakeJev({}).ask))
    ).toMatchObject({ ok: false, error: "invalid-input" })
  })
})

const REVIEW_ROLES = [
  "design-review",
  "knowledge-elicitation",
  "code-review",
  "complex-review",
  "adversarial-review"
]
const SPLIT_ROLES = [
  "complex-impl",
  "normal-impl",
  "light-impl",
  "general",
  "explore",
  "realtime-research",
  "e2e-verify"
]
const REVIEW_INPUT = JSON.stringify({
  reason: "review",
  task: { summary: "Review the design doc", artifacts: ["docs/x.md"] }
})
const STUCK_INPUT = JSON.stringify({ reason: "stuck", task: { summary: "x" } })

function noul(value: number) {
  return { type: "noul", noul: value }
}

function reviewAnswers(values: number[]) {
  return Object.fromEntries(
    values.map((value, index) => [`candidate_${index}`, noul(value)])
  )
}

function chose(role: string, p: number) {
  return {
    type: "choice",
    choice: role,
    confidence: p,
    probabilities: { [role]: p }
  }
}

function disabled(...roles: string[]): Partial<PickDeps> {
  return { config: { kind: "ok", config: { disabledRoles: roles as never } } }
}

describe("候補", () => {
  it("定義が 0 件の review では 5 役割すべてを候補にし、同梱の基準で問う", async () => {
    const jev = fakeJev(reviewAnswers([0.9, 0.9, 0.9, 0.9, 0.9]))
    await pickDelegate(REVIEW_INPUT, deps([], jev.ask))
    const questions = jev.requests[0]?.questions ?? {}
    expect(Object.keys(questions)).toHaveLength(5)
    REVIEW_ROLES.forEach((role, index) => {
      const text = JSON.stringify(questions[`candidate_${index}`])
      expect(text).toContain(`Reviewer: ${role}`)
      expect(text).toContain(`- standard ${role}`)
    })
  })

  it("定義のある役割は定義の基準を、無い役割は同梱の基準を使う", async () => {
    const jev = fakeJev(reviewAnswers([0.9, 0.9, 0.9, 0.9, 0.9]))
    await pickDelegate(
      REVIEW_INPUT,
      deps([def("my-reviewer", "code-review")], jev.ask)
    )
    const questions = jev.requests[0]?.questions ?? {}
    expect(JSON.stringify(questions.candidate_2)).toContain("- my-reviewer")
    expect(JSON.stringify(questions.candidate_2)).not.toContain("standard")
    expect(JSON.stringify(questions.candidate_0)).toContain(
      "- standard design-review"
    )
  })

  it("split の choice の選択肢の鍵は役割 ID になる", async () => {
    const jev = fakeJev({ task_0: chose("explore", 0.9) })
    await pickDelegate(
      JSON.stringify({ reason: "split", tasks: [{ id: "a", summary: "x" }] }),
      deps(
        [def("implementer", "normal-impl"), def("e", "explore", "")],
        jev.ask
      )
    )
    const question = jev.requests[0]?.questions.task_0 as unknown as {
      criteria: Record<string, string | null>
    }
    expect(Object.keys(question.criteria)).toEqual(SPLIT_ROLES)
    expect(question.criteria["normal-impl"]).toBe("- implementer")
    expect(question.criteria.explore).toBeNull()
    expect(question.criteria.general).toBe("- standard general")
  })

  it("設定と excludeRoles で外した役割は候補にならない", async () => {
    const jev = fakeJev(reviewAnswers([0.9, 0.9, 0.9]))
    await pickDelegate(
      JSON.stringify({
        ...JSON.parse(REVIEW_INPUT),
        excludeRoles: ["adversarial-review"]
      }),
      { ...deps([], jev.ask), ...disabled("complex-review") }
    )
    const text = JSON.stringify(jev.requests[0]?.questions)
    expect(Object.keys(jev.requests[0]?.questions ?? {})).toHaveLength(3)
    expect(text).not.toContain("Reviewer: complex-review")
    expect(text).not.toContain("Reviewer: adversarial-review")
  })

  it("外した結果 review の候補が 1 つなら Jev を呼ばずに返す。キーが無くてもよい", async () => {
    const jev = fakeJev({})
    expect(
      await pickDelegate(REVIEW_INPUT, {
        ...deps([def("code-reviewer", "code-review")], jev.ask, null),
        ...disabled(
          "design-review",
          "knowledge-elicitation",
          "complex-review",
          "adversarial-review"
        )
      })
    ).toEqual({
      ok: true,
      reason: "review",
      agents: [
        { role: "code-review", mode: "custom", agentType: "code-reviewer" }
      ]
    })
    expect(jev.requests).toHaveLength(0)
  })

  it("外した結果 0 なら no-candidates を返し、尽きた理由を書き分ける", async () => {
    const byConfig = await pickDelegate(STUCK_INPUT, {
      ...deps([], failingJev()),
      ...disabled("escalation")
    })
    expect(byConfig).toMatchObject({ ok: false, error: "no-candidates" })
    expect(byConfig.ok === false && byConfig.message).toContain("config.json")

    const byExclude = await pickDelegate(
      JSON.stringify({
        ...JSON.parse(STUCK_INPUT),
        excludeRoles: ["escalation"]
      }),
      deps([], failingJev())
    )
    expect(byExclude).toMatchObject({ ok: false, error: "no-candidates" })
    expect(byExclude.ok === false && byExclude.message).toContain(
      "excludeRoles"
    )
  })

  it("stuck は Jev を呼ばず escalation を返す", async () => {
    const jev = fakeJev({})
    expect(await pickDelegate(STUCK_INPUT, deps([], jev.ask, null))).toEqual({
      ok: true,
      reason: "stuck",
      agents: [
        {
          role: "escalation",
          mode: "standard",
          agentType: "general-purpose",
          model: "fable",
          effort: "high",
          preamble: "standard:escalation:en"
        }
      ]
    })
    expect(
      await pickDelegate(
        STUCK_INPUT,
        deps([def("lead", "escalation")], jev.ask, null)
      )
    ).toEqual({
      ok: true,
      reason: "stuck",
      agents: [{ role: "escalation", mode: "custom", agentType: "lead" }]
    })
    expect(jev.requests).toHaveLength(0)
  })

  it.each([
    "review",
    "split",
    "stuck"
  ])("設定ファイルが invalid なら %s でも invalid-config を返す", async (reason) => {
    const raw =
      reason === "review"
        ? REVIEW_INPUT
        : reason === "split"
          ? JSON.stringify({ reason, tasks: [{ id: "a", summary: "x" }] })
          : STUCK_INPUT
    const result = await pickDelegate(raw, {
      ...deps([], failingJev()),
      config: {
        kind: "invalid",
        message: ".claude/better-agentics/config.json is not valid JSON",
        raw: "{"
      }
    })
    expect(result).toMatchObject({ ok: false, error: "invalid-config" })
    expect(result.ok === false && result.message).toContain("config.json")
  })

  it("同じ役割を 2 件の定義が持てば duplicate-role。外した役割の重複では止まらない", async () => {
    const twice = [def("a", "code-review"), def("b", "code-review")]
    const error = await pickDelegate(REVIEW_INPUT, deps(twice, failingJev()))
    expect(error).toMatchObject({ ok: false, error: "duplicate-role" })
    expect(error.ok === false && error.message).toContain("a, b")
    expect(error.ok === false && error.message).toContain(
      "better-agentics:setup"
    )

    const jev = fakeJev(reviewAnswers([0.9, 0.9, 0.9, 0.9]))
    const result = await pickDelegate(REVIEW_INPUT, {
      ...deps(twice, jev.ask),
      ...disabled("code-review")
    })
    expect(result.ok).toBe(true)
  })

  it("役割が違い name が同じ定義があれば duplicate-role を返す", async () => {
    const result = await pickDelegate(
      JSON.stringify({ reason: "split", tasks: [{ id: "a", summary: "x" }] }),
      deps(
        [def("worker", "normal-impl"), def("worker", "explore")],
        failingJev()
      )
    )
    expect(result).toMatchObject({ ok: false, error: "duplicate-role" })
    expect(result.ok === false && result.message).toContain("worker")
  })

  it("理由と関係の無い役割を excludeRoles に入れても結果は変わらない", async () => {
    const answers = reviewAnswers([0.9, 0.1, 0.8, 0.1, 0.1])
    const plain = await pickDelegate(
      REVIEW_INPUT,
      deps([], fakeJev(answers).ask)
    )
    const excluded = await pickDelegate(
      JSON.stringify({
        ...JSON.parse(REVIEW_INPUT),
        excludeRoles: ["normal-impl"]
      }),
      deps([], fakeJev(answers).ask)
    )
    expect(excluded).toEqual(plain)
  })

  it("役割表に無い role-id の定義は候補にしない", async () => {
    const result = await pickDelegate(
      REVIEW_INPUT,
      deps(
        [def("old", "final-review")],
        fakeJev(reviewAnswers([0.9, 0.9, 0.9, 0.9, 0.9])).ask
      )
    )
    expect(result.ok).toBe(true)
    expect(JSON.stringify(result)).not.toContain("old")
  })
})

describe("出力", () => {
  it("review は 0.5 以上の候補を走査順に、定義の有無でモードを分けて返す", async () => {
    const jev = fakeJev(reviewAnswers([0.91, 0.2, 0.73, 0.2, 0.2]))
    expect(
      await pickDelegate(
        REVIEW_INPUT,
        deps([def("my-reviewer", "code-review")], jev.ask)
      )
    ).toEqual({
      ok: true,
      reason: "review",
      agents: [
        {
          role: "design-review",
          mode: "standard",
          agentType: "general-purpose",
          model: "opus",
          effort: "high",
          preamble: "standard:design-review:en",
          p: 0.91
        },
        {
          role: "code-review",
          mode: "custom",
          agentType: "my-reviewer",
          p: 0.73
        }
      ]
    })
    expect(jev.requests).toHaveLength(1)
  })

  it("前置きは lang の言語で組み立てる", async () => {
    const result = await pickDelegate(
      JSON.stringify({ ...JSON.parse(STUCK_INPUT), lang: "ja" }),
      deps([], fakeJev({}).ask)
    )
    expect(result).toMatchObject({
      agents: [{ preamble: "standard:escalation:ja" }]
    })
  })

  it("全員が 0.5 未満なら確率が最も高い 1 人に fallback を付けて返す", async () => {
    const jev = fakeJev(reviewAnswers([0.3, 0.45, 0.1, 0.1, 0.1]))
    expect(await pickDelegate(REVIEW_INPUT, deps([], jev.ask))).toEqual({
      ok: true,
      reason: "review",
      agents: [
        {
          role: "knowledge-elicitation",
          mode: "standard",
          agentType: "general-purpose",
          model: "haiku",
          effort: "low",
          preamble: "standard:knowledge-elicitation:en",
          p: 0.45
        }
      ],
      fallback: true
    })
  })

  it("基準は質問の側にだけ置き、state には作業内容だけを入れる", async () => {
    const jev = fakeJev(reviewAnswers([0.9, 0.9, 0.9, 0.9, 0.9]))
    await pickDelegate(
      REVIEW_INPUT,
      deps(
        [
          def("docs-reviewer", "design-review"),
          def("k", "knowledge-elicitation", "")
        ],
        jev.ask
      )
    )
    const request = jev.requests[0]
    expect(request?.state).toEqual({
      summary: "Review the design doc",
      artifacts: ["docs/x.md"]
    })
    expect(JSON.stringify(request?.questions.candidate_0)).toContain(
      "- docs-reviewer"
    )
    expect(JSON.stringify(request?.questions.candidate_1)).toContain(
      "(no criteria)"
    )
    expect(JSON.stringify(request?.state)).not.toContain("- docs-reviewer")
  })

  it("split は作業ごとの choice を 1 回で問い、選んだ役割の確率を p にする", async () => {
    const jev = fakeJev({
      task_0: {
        type: "choice",
        choice: "normal-impl",
        confidence: 0.8,
        probabilities: { "normal-impl": 0.82, explore: 0.18 }
      },
      task_1: chose("explore", 0.95)
    })
    expect(
      await pickDelegate(
        JSON.stringify({
          reason: "split",
          tasks: [
            { id: "a", summary: "Implement the parser" },
            { id: "b", summary: "Find all callers" }
          ]
        }),
        deps([def("implementer", "normal-impl")], jev.ask)
      )
    ).toEqual({
      ok: true,
      reason: "split",
      assignments: [
        {
          id: "a",
          role: "normal-impl",
          mode: "custom",
          agentType: "implementer",
          p: 0.82
        },
        {
          id: "b",
          role: "explore",
          mode: "standard",
          agentType: "general-purpose",
          model: "sonnet",
          effort: "high",
          preamble: "standard:explore:en",
          p: 0.95
        }
      ]
    })
    expect(jev.requests).toHaveLength(1)
    const question = jev.requests[0]?.questions.task_0 as unknown as {
      type: string
      instructions: string
    }
    expect(question.type).toBe("choice")
    expect(question.instructions).toContain('"a"')
    expect(question.instructions).toContain("Implement the parser")
    expect(jev.requests[0]?.state).toEqual({
      tasks: [
        { id: "a", summary: "Implement the parser" },
        { id: "b", summary: "Find all callers" }
      ]
    })
  })

  it("同じ役割が 2 つの作業に選ばれても両方に返す", async () => {
    const both = chose("light-impl", 0.6)
    const result = await pickDelegate(
      JSON.stringify({
        reason: "split",
        tasks: [
          { id: "a", summary: "x" },
          { id: "b", summary: "y" }
        ]
      }),
      deps([], fakeJev({ task_0: both, task_1: both }).ask)
    )
    expect(result).toMatchObject({
      assignments: [{ role: "light-impl" }, { role: "light-impl" }]
    })
  })
})

describe("エラー", () => {
  async function errorOf(
    raw: string,
    definitions: Definition[] = [],
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

  it("no-api-key は Jev が要るときだけ返す", async () => {
    expect((await errorOf(REVIEW_INPUT, [], failingJev(), null))?.error).toBe(
      "no-api-key"
    )
  })

  it("jev-failed は呼び出しの失敗と想定外の応答で返す", async () => {
    const thrown = await errorOf(REVIEW_INPUT)
    expect(thrown?.error).toBe("jev-failed")
    expect(thrown?.message).toContain("HTTP 500")

    const outOfRange = fakeJev(reviewAnswers([1.2, 0.1, 0.1, 0.1, 0.1]))
    expect((await errorOf(REVIEW_INPUT, [], outOfRange.ask))?.error).toBe(
      "jev-failed"
    )

    const missing = fakeJev({ candidate_0: noul(0.9) })
    expect((await errorOf(REVIEW_INPUT, [], missing.ask))?.error).toBe(
      "jev-failed"
    )

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
          [],
          strange.ask
        )
      )?.error
    ).toBe("jev-failed")
  })
})

describe("fork", () => {
  function input(
    tasks: { id: string; summary: string; needsContext?: boolean }[],
    parentModel: string | null = "sonnet"
  ): string {
    return JSON.stringify({
      reason: "split",
      tasks,
      parentModel: parentModel ?? undefined
    })
  }
  const CONTEXT = [{ id: "a", summary: "x", needsContext: true }]

  it("文脈の要る作業で、Jev が親と同じモデルの fork の役割を選べば fork を返す", async () => {
    const result = await pickDelegate(
      input(CONTEXT),
      deps([], fakeJev({ task_0: chose("normal-impl", 0.8) }).ask)
    )
    expect(result).toEqual({
      ok: true,
      reason: "split",
      assignments: [
        {
          id: "a",
          role: "normal-impl",
          mode: "fork",
          agentType: "fork",
          preamble: "fork:normal-impl:en",
          p: 0.8
        }
      ]
    })
  })

  it.each([
    ["fork の対象外の役割", "light-impl"],
    ["モデルが親と違う役割", "complex-impl"]
  ])("%s が選ばれたら self を返す", async (_label, role) => {
    expect(
      await pickDelegate(
        input(CONTEXT),
        deps([], fakeJev({ task_0: chose(role, 0.8) }).ask)
      )
    ).toEqual({
      ok: true,
      reason: "split",
      assignments: [{ id: "a", mode: "self" }]
    })
  })

  it.each([
    ["inherit", "inherit"],
    ["未設定", undefined],
    ["完全なモデル ID", "claude-sonnet-5-5"]
  ])("定義の model が %s なら self を返す", async (_label, model) => {
    const definition = { ...def("impl", "normal-impl"), model }
    expect(
      await pickDelegate(
        input(CONTEXT),
        deps([definition], fakeJev({ task_0: chose("normal-impl", 0.8) }).ask)
      )
    ).toMatchObject({ assignments: [{ id: "a", mode: "self" }] })
  })

  it("定義の model が親と同じ別名なら fork を返す", async () => {
    const definition = { ...def("impl", "normal-impl"), model: "sonnet" }
    expect(
      await pickDelegate(
        input(CONTEXT),
        deps([definition], fakeJev({ task_0: chose("normal-impl", 0.8) }).ask)
      )
    ).toMatchObject({
      assignments: [{ id: "a", mode: "fork", role: "normal-impl" }]
    })
  })

  it.each([
    ["parentModel が無い", null, true],
    ["fork モードが無効", "sonnet", false]
  ])("%s とき、文脈の要る作業は問いから外して self にし、他は通常どおり返す", async (_label, parentModel, forkEnabled) => {
    const jev = fakeJev({ task_0: chose("explore", 0.9) })
    const result = await pickDelegate(
      input(
        [
          { id: "a", summary: "needs context", needsContext: true },
          { id: "b", summary: "find callers" }
        ],
        parentModel
      ),
      { ...deps([], jev.ask), forkEnabled }
    )
    expect(result).toMatchObject({
      assignments: [
        { id: "a", mode: "self" },
        { id: "b", role: "explore", mode: "standard" }
      ]
    })
    expect(jev.requests[0]?.state).toEqual({
      tasks: [{ id: "b", summary: "find callers" }]
    })
    expect(Object.keys(jev.requests[0]?.questions ?? {})).toEqual(["task_0"])
    expect(
      JSON.parse(JSON.stringify(jev.requests[0]?.questions)).task_0.instructions
    ).toContain('"b"')
  })

  it("全作業が self になったときは Jev を呼ばない", async () => {
    const jev = fakeJev({})
    expect(
      await pickDelegate(input(CONTEXT, null), deps([], jev.ask, null))
    ).toEqual({
      ok: true,
      reason: "split",
      assignments: [{ id: "a", mode: "self" }]
    })
    expect(jev.requests).toHaveLength(0)
  })

  it("文脈の要らない作業は fork にしない", async () => {
    expect(
      await pickDelegate(
        input([{ id: "a", summary: "x" }]),
        deps([], fakeJev({ task_0: chose("normal-impl", 0.8) }).ask)
      )
    ).toMatchObject({ assignments: [{ id: "a", mode: "standard" }] })
  })
})
