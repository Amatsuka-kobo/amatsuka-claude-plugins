import { describe, expect, it } from "vitest"
import { makeArtifact, makeCtx } from "../testHelpers.js"
import { protectedPathsRule } from "./protectedPaths.js"

describe("protectedPathsRule", () => {
  it(".github 配下の変更で stop 発火する", () => {
    const findings = protectedPathsRule.check(
      makeArtifact({ changedPaths: [".github/workflows/ci.yml"] }),
      makeCtx()
    )
    expect(findings).toHaveLength(1)
    expect(findings[0].severity).toBe("stop")
  })

  it("infra 配下の変更で発火する", () => {
    const findings = protectedPathsRule.check(
      makeArtifact({ changedPaths: ["infra/prod/main.tf"] }),
      makeCtx()
    )
    expect(findings).toHaveLength(1)
  })

  it(".env ファイルへの変更で発火する", () => {
    const findings = protectedPathsRule.check(
      makeArtifact({ changedPaths: ["packages/api/.env.production"] }),
      makeCtx()
    )
    expect(findings).toHaveLength(1)
  })

  it("無関係なパスでは発火しない", () => {
    const findings = protectedPathsRule.check(
      makeArtifact({ changedPaths: ["src/index.ts", "README.md"] }),
      makeCtx()
    )
    expect(findings).toEqual([])
  })

  it("設定で globs を追加できる", () => {
    const findings = protectedPathsRule.check(
      makeArtifact({ changedPaths: ["secrets/prod.yaml"] }),
      makeCtx({
        rules: { "code/protected-paths": { globs: ["secrets/**"] } }
      })
    )
    expect(findings).toHaveLength(1)
  })
})
