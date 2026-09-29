import { describe, expect, it } from "vitest"
import { makeArtifact, makeCtx } from "../../testHelpers.js"
import { protectedPathsRule } from "../protectedPaths.js"

const RULE_ID = "code/protected-paths"

function check(changedPaths: string[], ctx = makeCtx()) {
  return protectedPathsRule.check(makeArtifact({ changedPaths }), ctx)
}

describe("protectedPathsRule", () => {
  it(".github 配下の変更で stop 発火する", () => {
    const findings = check([".github/workflows/ci.yml"])
    expect(findings).toHaveLength(1)
    expect(findings[0].severity).toBe("stop")
    expect(findings[0].evidence?.path).toBe(".github/workflows/ci.yml")
  })

  it("infra 配下と .env ファイルの変更で発火する", () => {
    expect(
      check(["infra/prod/main.tf", "packages/api/.env.production"])
    ).toHaveLength(2)
  })

  it("無関係なパスでは発火しない", () => {
    expect(check(["src/index.ts", "README.md"])).toEqual([])
  })

  it("設定の globs(loader が和集合を取った値)を使う", () => {
    const ctx = makeCtx({
      rules: { [RULE_ID]: { globs: [".github/**", "secrets/**"] } }
    })
    expect(check(["secrets/prod.yaml", "infra/main.tf"], ctx)).toHaveLength(1)
  })

  it("excludeDefaults で外した既定の glob は当たらない(loader が外した値を読む。R20)", () => {
    const ctx = makeCtx({
      rules: {
        [RULE_ID]: {
          globs: ["infra/**", "**/*.env*"],
          excludeDefaults: [".github/**"]
        }
      }
    })
    expect(check([".github/workflows/ci.yml"], ctx)).toEqual([])
  })

  it("generated に当たるパスは保護パスでも当てない(R20)", () => {
    const ctx = makeCtx({
      rules: {
        [RULE_ID]: {
          globs: [
            ".github/**",
            "infra/**",
            "**/*.env*",
            "plugins/*/scripts/**"
          ],
          generated: ["plugins/*/scripts/**"]
        }
      }
    })
    expect(
      check(["plugins/codiel/scripts/cli.mjs", "infra/a.tf"], ctx)
    ).toEqual([
      expect.objectContaining({
        evidence: { location: "infra/a.tf", path: "infra/a.tf" }
      })
    ])
  })

  it("E2E のレポートのパスは保護パスでも当てない(R24)", () => {
    const ctx = makeCtx(
      { rules: { [RULE_ID]: { globs: ["docs/**"] } } },
      [],
      "docs/codiel/tests"
    )
    expect(check(["docs/codiel/tests/u1/reports/run.md"], ctx)).toEqual([])
    expect(check(["docs/reports/x.md"], ctx)).toHaveLength(1)
  })
})
