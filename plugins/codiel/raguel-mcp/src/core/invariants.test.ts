import { describe, expect, it } from "vitest"
import { defaultConfig } from "../config/defaults"
import { assertInvariants, SEALED_RULES } from "./invariants"
import type { RaguelConfig } from "./types"

function baseConfig(): RaguelConfig {
  return structuredClone(defaultConfig)
}

describe("SEALED_RULES", () => {
  it("docs/DESIGN.md §10 不変条件 3 の一覧と一致する", () => {
    expect([...SEALED_RULES].sort()).toEqual(
      [
        "common/secrets",
        "common/injection-marker",
        "common/resubmission-loop",
        "code/protected-paths",
        "code/dangerous-patterns"
      ].sort()
    )
  })
})

describe("assertInvariants", () => {
  it("内蔵デフォルト設定は違反しない", () => {
    expect(() => assertInvariants(baseConfig())).not.toThrow()
  })

  describe("不変条件 1: steelman は adversarial なしで有効化できない", () => {
    it("standard で steelman のみ指定すると拒否する", () => {
      const config = baseConfig()
      config.panel.standard = ["steelman"]
      expect(() => assertInvariants(config)).toThrow(/steelman/)
    })

    it("critical で adversarial を外し steelman だけ残すと拒否する", () => {
      const config = baseConfig()
      config.panel.critical = ["steelman", "crosscheck"]
      expect(() => assertInvariants(config)).toThrow(/adversarial/)
    })

    it("adversarial と steelman が両方揃っていれば許容する", () => {
      const config = baseConfig()
      config.panel.standard = ["adversarial", "steelman"]
      expect(() => assertInvariants(config)).not.toThrow()
    })
  })

  describe("不変条件 3: sealed ルールは無効化できない", () => {
    for (const ruleId of SEALED_RULES) {
      it(`${ruleId} に enabled: false を指定すると拒否する`, () => {
        const config = baseConfig()
        config.rules[ruleId] = { enabled: false }
        expect(() => assertInvariants(config)).toThrow(
          new RegExp(ruleId.replace("/", "\\/"))
        )
      })
    }

    it("sealed でないルールの enabled: false は許容する", () => {
      const config = baseConfig()
      config.rules["code/max-diff-lines"] = { enabled: false }
      expect(() => assertInvariants(config)).not.toThrow()
    })
  })

  describe("sealed ルールの緩和限度: common/resubmission-loop.stopAfter", () => {
    it("5 は許容する(境界値)", () => {
      const config = baseConfig()
      config.rules["common/resubmission-loop"] = { stopAfter: 5 }
      expect(() => assertInvariants(config)).not.toThrow()
    })

    it("6 は拒否する", () => {
      const config = baseConfig()
      config.rules["common/resubmission-loop"] = { stopAfter: 6 }
      expect(() => assertInvariants(config)).toThrow(/stopAfter/)
    })

    it("未指定なら許容する", () => {
      const config = baseConfig()
      delete config.rules["common/resubmission-loop"]
      expect(() => assertInvariants(config)).not.toThrow()
    })
  })
})
