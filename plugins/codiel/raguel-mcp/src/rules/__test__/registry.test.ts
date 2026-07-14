import { describe, expect, it, vi } from "vitest"
import { allRules, rulesFor, runRules } from "../registry.js"
import { makeArtifact, makeCtx } from "../testHelpers.js"

describe("rulesFor", () => {
  it("kind に応じてルールをフィルタする", () => {
    const config = makeCtx().config
    const codeRules = rulesFor("code", config)
    const decisionRules = rulesFor("decision", config)

    expect(codeRules.some((r) => r.id === "code/protected-paths")).toBe(true)
    expect(decisionRules.some((r) => r.id === "code/protected-paths")).toBe(
      false
    )
    expect(decisionRules.some((r) => r.id === "decision/no-alternatives")).toBe(
      true
    )
  })

  it("appliesTo: all のルールは全 kind に含まれる", () => {
    const config = makeCtx().config
    for (const kind of ["decision", "plan", "design", "code"] as const) {
      const rules = rulesFor(kind, config)
      expect(rules.some((r) => r.id === "common/secrets")).toBe(true)
    }
  })

  it("enabled: false のルールを除外する", () => {
    const config = makeCtx({
      rules: { "common/max-size": { enabled: false } }
    }).config
    const rules = rulesFor("code", config)
    expect(rules.some((r) => r.id === "common/max-size")).toBe(false)
  })

  it("allRules に登録した全ルールがいずれかの kind から到達可能", () => {
    const config = makeCtx().config
    const reachable = new Set<string>()
    for (const kind of ["decision", "plan", "design", "code"] as const) {
      for (const rule of rulesFor(kind, config)) reachable.add(rule.id)
    }
    for (const rule of allRules) {
      expect(reachable.has(rule.id)).toBe(true)
    }
  })
})

describe("runRules", () => {
  it("該当ルールの findings を集約する", () => {
    const artifact = makeArtifact({
      kind: "code",
      changedPaths: [".github/workflows/ci.yml"]
    })
    const findings = runRules(artifact, makeCtx())
    expect(findings.some((f) => f.ruleId === "code/protected-paths")).toBe(true)
  })

  it("発火なしなら空配列", () => {
    const artifact = makeArtifact({
      kind: "decision",
      content: "READMEのタイポを直す。他の選択肢は検討不要。",
      objective: "READMEの修正",
      context: { optionsConsidered: ["修正する", "放置する"] }
    })
    const findings = runRules(artifact, makeCtx())
    expect(findings).toEqual([])
  })
})

describe("runRules フェイルクローズド", () => {
  it("1ルールの例外は rule-error finding に変換し、他ルールの実行を継続する", async () => {
    vi.resetModules()
    vi.doMock("../common/maxSize.js", () => ({
      maxSizeRule: {
        id: "common/max-size",
        appliesTo: "all",
        sealed: false,
        defaultSeverity: "ask",
        check: () => {
          throw new Error("boom")
        }
      }
    }))

    const { runRules: runRulesWithMock } = await import("../registry.js")

    const artifact = makeArtifact({
      kind: "code",
      changedPaths: [".github/workflows/ci.yml"]
    })
    const findings = runRulesWithMock(artifact, makeCtx())

    const errorFinding = findings.find((f) => f.ruleId === "rule-error")
    expect(errorFinding).toBeDefined()
    expect(errorFinding?.severity).toBe("ask")
    expect(errorFinding?.message).toContain("common/max-size")

    // 他のルール(protected-paths)は継続して実行され発火している
    expect(findings.some((f) => f.ruleId === "code/protected-paths")).toBe(true)

    vi.doUnmock("../common/maxSize.js")
    vi.resetModules()
  })
})
