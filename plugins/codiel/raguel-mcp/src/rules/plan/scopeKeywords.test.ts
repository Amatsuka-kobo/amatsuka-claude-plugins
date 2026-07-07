import { describe, expect, it } from "vitest"
import { makeArtifact, makeCtx } from "../testHelpers.js"
import { scopeKeywordsRule } from "./scopeKeywords.js"

describe("scopeKeywordsRule", () => {
  it("objective に現れない領域が2つ以上あれば発火する", () => {
    const findings = scopeKeywordsRule.check(
      makeArtifact({
        kind: "plan",
        objective: "ログイン画面のUIを修正する",
        content:
          "auth の実装に加えて terraform で infra を更新し、billing のドキュメントも書く"
      }),
      makeCtx()
    )
    expect(findings).toHaveLength(1)
    expect(findings[0].severity).toBe("ask")
  })

  it("領域ワードが objective に含まれていれば発火しない", () => {
    const findings = scopeKeywordsRule.check(
      makeArtifact({
        kind: "plan",
        objective: "認証(auth)とデプロイ(deploy)まわりの改善",
        content: "auth の実装を見直し、deploy 手順を整理する"
      }),
      makeCtx()
    )
    expect(findings).toEqual([])
  })

  it("該当する領域が1つだけなら発火しない(過検知抑制)", () => {
    const findings = scopeKeywordsRule.check(
      makeArtifact({
        kind: "plan",
        objective: "READMEの更新",
        content: "auth のドキュメントを追記する"
      }),
      makeCtx()
    )
    expect(findings).toEqual([])
  })

  it("無関係な計画では発火しない", () => {
    const findings = scopeKeywordsRule.check(
      makeArtifact({
        kind: "plan",
        objective: "READMEのタイポ修正",
        content: "READMEの誤字を直す"
      }),
      makeCtx()
    )
    expect(findings).toEqual([])
  })

  it("設定で domains を追加できる", () => {
    const findings = scopeKeywordsRule.check(
      makeArtifact({
        kind: "plan",
        objective: "READMEの更新",
        content: "billing と shipping の両方を更新する"
      }),
      makeCtx({
        rules: { "plan/scope-keywords": { domains: ["shipping"] } }
      })
    )
    expect(findings).toHaveLength(1)
  })
})
