import { describe, expect, it } from "vitest"
import { makeArtifact, makeCtx } from "../../testHelpers.js"
import { irreversibleOpsRule, stemMatcher } from "../irreversibleOps.js"

function check(content: string, ctx = makeCtx()) {
  return irreversibleOpsRule.check(makeArtifact({ kind: "plan", content }), ctx)
}

describe("irreversibleOpsRule", () => {
  it("plan と design に当て、既定は info", () => {
    expect(irreversibleOpsRule.appliesTo).toEqual(["plan", "design"])
    expect(irreversibleOpsRule.defaultSeverity).toBe("info")
  })

  it("本番デプロイへの言及で info の所見を出し、最初の行を抜粋する", () => {
    const findings = check("# 計画\n本番環境にデプロイしてリリースする")
    expect(findings).toHaveLength(1)
    expect(findings[0].severity).toBe("info")
    expect(findings[0].evidence).toEqual({
      line: 2,
      excerpt: "本番環境にデプロイしてリリースする"
    })
  })

  it.each([
    ["deployment の手順を書く", "deploy"],
    ["run the migrations", "migration"],
    ["force-push で履歴を直す", "force push"],
    ["We will force push to fix history.", "force push"],
    ["DB マイグレーションを実行する", "マイグレーション"],
    ["古いデータを破棄する", "破棄"],
    ["設定を上書きする", "上書き"]
  ])("語幹と片仮名語で一致する(所見 A8): %s", (content, keyword) => {
    const findings = check(content)
    expect(findings).toHaveLength(1)
    expect(findings[0].message).toContain(keyword)
  })

  it("語の途中から始まる一致は取らない", () => {
    expect(check("predeployment checklist")).toEqual([])
  })

  it("無関係な計画では発火しない", () => {
    expect(check("READMEのタイポを直す")).toEqual([])
  })

  it("設定でキーワードを差し替えられる", () => {
    const ctx = makeCtx({
      rules: { "plan/irreversible-ops": { keywords: ["課金"] } }
    })
    expect(check("課金情報を更新する", ctx)).toHaveLength(1)
    expect(check("本番にデプロイする", ctx)).toEqual([])
  })

  it("空の語は一致させない", () => {
    expect(stemMatcher("  ")).toBeNull()
  })
})
