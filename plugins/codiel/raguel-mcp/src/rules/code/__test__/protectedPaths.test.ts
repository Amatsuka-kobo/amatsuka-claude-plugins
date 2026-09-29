import { describe, expect, it } from "vitest"
import { makeArtifact, makeCtx } from "../../testHelpers.js"
import { protectedPathsRule } from "../protectedPaths.js"
import { renameDiff } from "./helpers/diff.js"

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

  describe("名前の変更は移動元と移動先の両方で判定する(W4R1-01)", () => {
    const GENERATED_CTX = () =>
      makeCtx({
        rules: {
          [RULE_ID]: {
            globs: [".github/**", "plugins/*/scripts/**"],
            generated: ["plugins/*/scripts/**"]
          }
        }
      })
    // パイプラインと同じく、changedPaths には移動先だけを載せる
    const checkRename = (from: string, to: string, ctx = makeCtx()) =>
      protectedPathsRule.check(
        makeArtifact({ content: renameDiff(from, to), changedPaths: [to] }),
        ctx
      )

    it("保護パスから通常のパスへ移すと、移動元で stop を出す", () => {
      expect(checkRename(".github/workflows/ci.yml", "ci/ci.yml")).toEqual([
        expect.objectContaining({
          severity: "stop",
          evidence: {
            location: ".github/workflows/ci.yml",
            path: ".github/workflows/ci.yml"
          }
        })
      ])
    })

    it("保護パスから生成物のパスへ移しても、移動元で stop を出す", () => {
      const findings = checkRename(
        ".github/workflows/ci.yml",
        "plugins/codiel/scripts/ci.yml",
        GENERATED_CTX()
      )
      expect(findings.map((f) => f.evidence?.path)).toEqual([
        ".github/workflows/ci.yml"
      ])
    })

    it("通常のパスから保護パスへ移すと、移動先で stop を出す", () => {
      expect(
        checkRename("ci/ci.yml", ".github/workflows/ci.yml").map(
          (f) => f.evidence?.path
        )
      ).toEqual([".github/workflows/ci.yml"])
    })

    it("移動元と移動先がどちらも生成物なら出さない", () => {
      expect(
        checkRename(
          "plugins/a/scripts/old.mjs",
          "plugins/a/scripts/new.mjs",
          GENERATED_CTX()
        )
      ).toEqual([])
    })
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
