import { describe, expect, it } from "vitest"
import { computeDigest, digestSimilarity } from "../../../casefile/digest.js"
import type { Finding, PriorAttempt } from "../../../core/types.js"
import { makeArtifact, makeCtx } from "../../testHelpers.js"
import {
  findAddressedButSimilar,
  resubmissionFindings,
  resubmissionLoopRule
} from "../resubmissionLoop.js"

const CONTENT =
  "デプロイスクリプトを更新してタイムアウトを180秒に延長する変更です"

function prior(overrides: Partial<PriorAttempt> = {}): PriorAttempt {
  return {
    attempt: 1,
    verdict: "ASK",
    judgeStatus: "ok",
    hasRuling: false,
    askRuleIds: [],
    digest: computeDigest(CONTENT),
    ...overrides
  }
}

function askFinding(
  ruleId: string,
  severity: Finding["severity"] = "ask"
): Finding {
  return { ruleId, severity, message: "m" }
}

function run(priors: PriorAttempt[], current: Finding[] | null = []) {
  return resubmissionFindings(
    makeArtifact({ content: CONTENT }),
    makeCtx({}, priors),
    current
  )
}

describe("resubmission-loop 比べる相手", () => {
  it("過去の attempt が無ければ出ない", () => {
    expect(run([])).toEqual([])
  })

  it("同じ本文の再提出は ask で出し、何回続いても stop に上げない", () => {
    const priors = [1, 2, 3, 4].map((attempt) =>
      prior({ attempt, verdict: attempt === 4 ? "STOP" : "ASK" })
    )
    const findings = run(priors)
    expect(findings).toHaveLength(1)
    expect(findings[0].severity).toBe("ask")
    expect(findings[0].message).toContain("試行 1")
    expect(findings[0].message).toContain("試行 4")
  })

  it.each([
    ["PROCEED の attempt", prior({ verdict: "PROCEED" })],
    ["degraded の attempt", prior({ judgeStatus: "degraded" })],
    ["裁定の記録を持つ attempt", prior({ hasRuling: true })],
    ["ダイジェストの読めない attempt", prior({ digest: null })]
  ])("%s とは比べない(所見 D5)", (_name, p) => {
    expect(run([p])).toEqual([])
  })

  it("似ていない本文とは比べても出ない", () => {
    const p = prior({
      digest: computeDigest("料金プランのドキュメントを書き直した")
    })
    expect(run([p])).toEqual([])
  })

  it("ダイジェストの版が違う attempt は比べない", () => {
    const p = prior({
      digest: { ...computeDigest(CONTENT), schemaVersion: 99 }
    })
    expect(run([p])).toEqual([])
  })
})

describe("resubmission-loop 修正ありの判定(所見 D5)", () => {
  const p = prior({ askRuleIds: ["code/max-diff-lines"] })

  it("前回の ruleId が今回出ていなければ、修正ありとみなして比べない", () => {
    expect(run([p], [])).toEqual([])
  })

  it("前回の ruleId が今回 info で出ているだけなら、修正ありとみなす", () => {
    expect(run([p], [askFinding("code/max-diff-lines", "info")])).toEqual([])
  })

  it("前回の ruleId が今回も ask 以上で出ていれば比べる", () => {
    expect(run([p], [askFinding("code/max-diff-lines")])).toHaveLength(1)
  })

  it("前回の ask 以上の ruleId が空なら比べる", () => {
    expect(run([prior({ askRuleIds: [] })], [])).toHaveLength(1)
  })

  it("前回このルールだけが出ていた attempt は、修正ありとみなさない", () => {
    expect(
      run([prior({ askRuleIds: ["common/resubmission-loop"] })], [])
    ).toHaveLength(1)
  })

  it("前回の ask が judge/* だけなら、決定論の所見を持たない前回と同じく比べる", () => {
    expect(
      run([prior({ askRuleIds: ["judge/code-security"] })], [])
    ).toHaveLength(1)
  })

  it("前回の ask に judge/* と決定論の ruleId があれば、決定論のほうだけで修正ありを判定する", () => {
    const p = prior({
      askRuleIds: ["judge/code-security", "code/max-diff-lines"]
    })
    expect(run([p], [])).toEqual([])
    expect(run([p], [askFinding("code/max-diff-lines")])).toHaveLength(1)
  })

  it("今回の所見を渡さない Rule.check は、比べられる相手をすべて比べる", () => {
    const findings = resubmissionLoopRule.check(
      makeArtifact({ content: CONTENT }),
      makeCtx({}, [p])
    )
    expect(findings).toHaveLength(1)
  })
})

describe("findAddressedButSimilar", () => {
  it("修正ありとみなした相手のうち、閾値以上に似たものを attempt と類似度で返す", () => {
    const priors = [
      prior({ attempt: 1, askRuleIds: ["code/max-diff-lines"] }),
      prior({ attempt: 2, askRuleIds: ["code/test-deletion"] }),
      prior({
        attempt: 3,
        askRuleIds: ["code/max-diff-lines"],
        digest: computeDigest("まったく別の内容の成果物を出した")
      }),
      prior({ attempt: 4, askRuleIds: [] }),
      prior({
        attempt: 5,
        askRuleIds: ["code/max-diff-lines"],
        hasRuling: true
      })
    ]
    expect(
      findAddressedButSimilar(
        CONTENT,
        priors,
        [askFinding("code/test-deletion")],
        0.85
      )
    ).toEqual([{ attempt: 1, similarity: 1 }])
  })

  it("閾値は 0.95 を超えて緩められない", () => {
    // 20 行の本文の末尾の 1 語だけを直した再提出。類似度は 0.95 以上 0.999 未満になる
    const body = Array.from(
      { length: 20 },
      (_, i) => `手順 ${i}: 設定 ${i} を確かめる`
    ).join("\n")
    const content = `${body}\n末尾を直した`
    const priorContent = `${body}\n末尾を変えた`
    const sim = digestSimilarity(
      computeDigest(content),
      computeDigest(priorContent)
    )
    expect(sim).not.toBeNull()
    expect(sim).toBeGreaterThanOrEqual(0.95)
    expect(sim).toBeLessThan(0.999)

    const p = prior({
      digest: computeDigest(priorContent),
      askRuleIds: ["x/y"]
    })
    expect(findAddressedButSimilar(content, [p], [], 0.999)).toHaveLength(1)
    const findings = resubmissionFindings(
      makeArtifact({ content }),
      makeCtx(
        {
          rules: { "common/resubmission-loop": { similarityThreshold: 0.999 } }
        },
        [{ ...p, askRuleIds: [] }]
      ),
      []
    )
    expect(findings).toHaveLength(1)
  })
})
