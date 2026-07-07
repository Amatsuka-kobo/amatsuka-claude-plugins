import { describe, expect, it } from "vitest"
import { makeArtifact, makeCtx } from "../testHelpers.js"
import { irreversibleOpsRule } from "./irreversibleOps.js"

describe("irreversibleOpsRule", () => {
  it("plan/design に適用される", () => {
    expect(irreversibleOpsRule.appliesTo).toEqual(["plan", "design"])
  })

  it("本番デプロイへの言及で発火する", () => {
    const findings = irreversibleOpsRule.check(
      makeArtifact({
        kind: "plan",
        content: "本番環境にデプロイしてリリースする"
      }),
      makeCtx()
    )
    expect(findings).toHaveLength(1)
    expect(findings[0].severity).toBe("ask")
  })

  it("英語キーワード force push で単語境界を考慮して発火する", () => {
    const findings = irreversibleOpsRule.check(
      makeArtifact({
        kind: "plan",
        content: "We will force push to fix history."
      }),
      makeCtx()
    )
    expect(findings).toHaveLength(1)
  })

  it("キーワードの部分文字列(単語境界の外)では誤検知しない", () => {
    // "deploy" が含まれない単語(deployment という単語自体は含むため別途確認)
    const findings = irreversibleOpsRule.check(
      makeArtifact({ kind: "plan", content: "predeployment checklist" }),
      makeCtx()
    )
    // "deploy" は "predeployment" の内部に現れるが単語境界では区切られない
    expect(findings).toEqual([])
  })

  it("無関係な計画では発火しない", () => {
    const findings = irreversibleOpsRule.check(
      makeArtifact({ kind: "plan", content: "READMEのタイポを直す" }),
      makeCtx()
    )
    expect(findings).toEqual([])
  })

  it("設定でキーワードを差し替えられる", () => {
    const findings = irreversibleOpsRule.check(
      makeArtifact({ kind: "plan", content: "課金情報を更新する" }),
      makeCtx({
        rules: { "plan/irreversible-ops": { keywords: ["課金"] } }
      })
    )
    expect(findings).toHaveLength(1)
  })
})
