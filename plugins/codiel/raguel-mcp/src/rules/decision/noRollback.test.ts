import { describe, expect, it } from "vitest"
import { makeArtifact, makeCtx } from "../testHelpers.js"
import { noRollbackRule } from "./noRollback.js"

describe("noRollbackRule", () => {
  it("不可逆操作 + rollback 記載なしで ask 発火する", () => {
    const findings = noRollbackRule.check(
      makeArtifact({
        kind: "decision",
        content: "本番環境のデータベースを migration して削除する"
      }),
      makeCtx()
    )
    expect(findings).toHaveLength(1)
    expect(findings[0].severity).toBe("ask")
  })

  it("context.rollbackPlan があれば発火しない", () => {
    const findings = noRollbackRule.check(
      makeArtifact({
        kind: "decision",
        content: "本番環境にdeployする",
        context: { rollbackPlan: "問題発生時は前バージョンにロールバックする" }
      }),
      makeCtx()
    )
    expect(findings).toEqual([])
  })

  it("本文に rollback/切り戻しの言及があれば発火しない", () => {
    const findings = noRollbackRule.check(
      makeArtifact({
        kind: "decision",
        content: "本番環境にdeployする。問題があれば即座に切り戻しを行う。"
      }),
      makeCtx()
    )
    expect(findings).toEqual([])
  })

  it("不可逆操作への言及がなければ発火しない", () => {
    const findings = noRollbackRule.check(
      makeArtifact({ kind: "decision", content: "READMEのタイポを直す" }),
      makeCtx()
    )
    expect(findings).toEqual([])
  })
})
