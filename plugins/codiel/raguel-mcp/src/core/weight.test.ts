import { describe, expect, it } from "vitest"
import { makeArtifact, makeConfig } from "../rules/testHelpers.js"
import type { Finding } from "./types.js"
import { computeWeight } from "./weight.js"

function diffWithNAdditions(n: number, files = 1): string {
  const perFile = Math.ceil(n / files)
  const blocks: string[] = []
  let remaining = n
  for (let i = 0; i < files; i++) {
    const count = Math.min(perFile, remaining)
    remaining -= count
    const lines = Array.from({ length: count }, (_, j) => `+line${j}`)
    blocks.push(
      [
        `diff --git a/file${i}.ts b/file${i}.ts`,
        `--- a/file${i}.ts`,
        `+++ b/file${i}.ts`,
        "@@ -1,1 +1,1 @@",
        ...lines
      ].join("\n")
    )
  }
  return blocks.join("\n")
}

describe("computeWeight テーブル駆動(特徴 → 期待ティア)", () => {
  const cases: Array<{
    name: string
    build: () => {
      artifact: ReturnType<typeof makeArtifact>
      findings: Finding[]
    }
    expectedTier: "trivial" | "standard" | "critical"
  }> = [
    {
      name: "小さな decision は trivial",
      build: () => ({
        artifact: makeArtifact({
          kind: "decision",
          content: "READMEのタイポを直す",
          changedPaths: []
        }),
        findings: []
      }),
      expectedTier: "trivial"
    },
    {
      name: "diff 100行 + code kind-base で standard (score=30)",
      build: () => ({
        artifact: makeArtifact({
          kind: "code",
          content: diffWithNAdditions(100),
          changedPaths: ["file0.ts"]
        }),
        findings: []
      }),
      expectedTier: "standard"
    },
    {
      name: "diff 500行 + 多数ファイル + 不可逆キーワードで critical (score>=70)",
      build: () => ({
        artifact: makeArtifact({
          kind: "code",
          content: `${diffWithNAdditions(500, 10)}\n// production migration 用のスクリプト`,
          changedPaths: Array.from({ length: 10 }, (_, i) => `file${i}.ts`)
        }),
        findings: []
      }),
      expectedTier: "critical"
    }
  ]

  for (const { name, build, expectedTier } of cases) {
    it(name, () => {
      const { artifact, findings } = build()
      const result = computeWeight(artifact, findings, makeConfig())
      expect(result.tier).toBe(expectedTier)
    })
  }
})

describe("computeWeight 昇格のみ原則", () => {
  it("severity ask のルール findings があれば最低 standard に昇格する", () => {
    const artifact = makeArtifact({
      kind: "decision",
      content: "READMEのタイポを直す",
      changedPaths: []
    })
    const findings: Finding[] = [
      { ruleId: "common/max-size", severity: "ask", message: "サイズ超過" }
    ]
    const result = computeWeight(artifact, findings, makeConfig())
    expect(result.tier).toBe("standard")
    expect(result.floors).toContain("rule-ask-floor:standard")
  })

  it("3行diff + code/protected-paths 発火は score が小さくても critical に昇格する", () => {
    const artifact = makeArtifact({
      kind: "code",
      content: [
        "diff --git a/.github/workflows/ci.yml b/.github/workflows/ci.yml",
        "--- a/.github/workflows/ci.yml",
        "+++ b/.github/workflows/ci.yml",
        "@@ -1,1 +1,3 @@",
        "+a",
        "+b",
        "+c"
      ].join("\n"),
      changedPaths: [".github/workflows/ci.yml"]
    })
    const findings: Finding[] = [
      {
        ruleId: "code/protected-paths",
        severity: "stop",
        message: "保護パスへの変更"
      }
    ]
    const result = computeWeight(artifact, findings, makeConfig())
    // スコア単独では critical(70)に届かないことを確認したうえで、床により critical になることを確認
    expect(result.score).toBeLessThan(makeConfig().weight.tiers.critical)
    expect(result.tier).toBe("critical")
    expect(result.floors).toContain("rule-fire-floor:critical")
  })

  it("plan/irreversible-ops 発火(severity 問わず)でも critical に昇格する", () => {
    const artifact = makeArtifact({
      kind: "plan",
      content: "小さな計画",
      steps: ["a"]
    })
    const findings: Finding[] = [
      {
        ruleId: "plan/irreversible-ops",
        severity: "ask",
        message: "不可逆操作の兆候"
      }
    ]
    const result = computeWeight(artifact, findings, makeConfig())
    expect(result.tier).toBe("critical")
  })

  it("床が不要な場合(既にそのティア以上)は floors に記録しない", () => {
    const artifact = makeArtifact({
      kind: "code",
      content: diffWithNAdditions(500, 10),
      changedPaths: Array.from({ length: 10 }, (_, i) => `file${i}.ts`)
    })
    const findings: Finding[] = [
      { ruleId: "common/max-size", severity: "ask", message: "サイズ超過" }
    ]
    const result = computeWeight(artifact, findings, makeConfig())
    expect(result.tier).toBe("critical")
    expect(result.floors).not.toContain("rule-ask-floor:standard")
  })

  it("床は既存スコアより下げない(昇格のみ)", () => {
    const artifact = makeArtifact({
      kind: "code",
      content: diffWithNAdditions(500, 10),
      changedPaths: Array.from({ length: 10 }, (_, i) => `file${i}.ts`)
    })
    const result = computeWeight(artifact, [], makeConfig())
    expect(result.tier).toBe("critical") // findings なしでも score だけで critical のまま
  })
})

describe("computeWeight factors の内訳", () => {
  it("factors に内訳が記録される", () => {
    const artifact = makeArtifact({
      kind: "code",
      content: diffWithNAdditions(100),
      changedPaths: ["file0.ts"]
    })
    const result = computeWeight(artifact, [], makeConfig())
    expect(result.factors["kind-base"]).toBe(20)
    expect(result.factors["diff-lines"]).toBeGreaterThan(0)
  })
})
