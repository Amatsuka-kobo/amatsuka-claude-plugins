import { describe, expect, it } from "vitest"
import { defaultConfig } from "../../config/defaults"
import { assertInvariants, MAX_DEADLINE_MS, SEALED_RULES } from "../invariants"
import type { RaguelConfig, RuleSettings } from "../types"

function baseConfig(): RaguelConfig {
  return structuredClone(defaultConfig)
}

function withRule(ruleId: string, settings: RuleSettings): RaguelConfig {
  const config = baseConfig()
  config.rules[ruleId] = { ...config.rules[ruleId], ...settings }
  return config
}

describe("SEALED_RULES", () => {
  it("設計書 §6.4.2 の sealed のルールと一致する", () => {
    expect([...SEALED_RULES].sort()).toEqual(
      [
        "common/secrets",
        "common/injection-marker",
        "common/resubmission-loop",
        "code/protected-paths",
        "code/destructive-ops",
        "code/unsafe-exec"
      ].sort()
    )
  })
})

describe("assertInvariants(設計書 §6.12.3)", () => {
  it("内蔵の既定の設定は違反しない", () => {
    expect(() => assertInvariants(baseConfig())).not.toThrow()
  })

  describe("sealed ルールは無効にできない", () => {
    for (const ruleId of SEALED_RULES) {
      it(`${ruleId} に enabled: false を指定すると拒否する`, () => {
        expect(() =>
          assertInvariants(withRule(ruleId, { enabled: false }))
        ).toThrow(new RegExp(ruleId.replace("/", "\\/")))
      })
    }

    it("sealed でないルールの enabled: false は受ける", () => {
      expect(() =>
        assertInvariants(withRule("code/max-diff-lines", { enabled: false }))
      ).not.toThrow()
    })
  })

  describe("sealed ルールの severity を既定より軽くできない(A3)", () => {
    it.each([
      ["code/destructive-ops", "ask"],
      ["code/unsafe-exec", "info"],
      ["common/secrets", "ask"],
      ["code/protected-paths", "info"],
      ["common/injection-marker", "info"]
    ] as const)("%s の severity: %s は拒否する", (ruleId, severity) => {
      expect(() => assertInvariants(withRule(ruleId, { severity }))).toThrow(
        /より軽くできません/
      )
    })

    it("sealed ルールを重くするのは受ける(code/unsafe-exec を ask のまま)", () => {
      expect(() =>
        assertInvariants(withRule("code/unsafe-exec", { severity: "ask" }))
      ).not.toThrow()
    })

    it("sealed でないルールは軽くできる", () => {
      expect(() =>
        assertInvariants(withRule("code/max-diff-lines", { severity: "info" }))
      ).not.toThrow()
    })
  })

  describe("STOP を出せないルールの severity: stop(R4)", () => {
    it.each([
      "code/unsafe-exec",
      "common/injection-marker",
      "plan/irreversible-ops",
      "code/max-diff-lines"
    ])("%s は拒否する", (ruleId) => {
      expect(() =>
        assertInvariants(withRule(ruleId, { severity: "stop" }))
      ).toThrow(/severity: stop/)
    })

    it.each([
      "common/secrets",
      "code/protected-paths",
      "code/destructive-ops"
    ])("%s は stop を受ける", (ruleId) => {
      expect(() =>
        assertInvariants(withRule(ruleId, { severity: "stop" }))
      ).not.toThrow()
    })
  })

  describe("common/secrets.allowPatterns(A3)", () => {
    it("不正な正規表現は拒否する", () => {
      expect(() =>
        assertInvariants(withRule("common/secrets", { allowPatterns: ["[a-"] }))
      ).toThrow(/正規表現が不正/)
    })

    it.each(["", ".*", "a*", "^$"])("空文字列に一致する %j は拒否する", (p) => {
      expect(() =>
        assertInvariants(withRule("common/secrets", { allowPatterns: [p] }))
      ).toThrow(/空文字列/)
    })

    it.each([
      "sk-ant",
      "AKIA",
      "ghp_",
      "BEGIN",
      "[A-Z0-9]{16}"
    ])("見本の秘密情報に一致する %j は拒否する", (p) => {
      expect(() =>
        assertInvariants(withRule("common/secrets", { allowPatterns: [p] }))
      ).toThrow(/見本の秘密情報/)
    })

    it("特定のトークンだけに一致する正規表現は受ける", () => {
      expect(() =>
        assertInvariants(
          withRule("common/secrets", {
            allowPatterns: ["^example-fixture-token$"]
          })
        )
      ).not.toThrow()
    })
  })

  describe("common/resubmission-loop.similarityThreshold の上限", () => {
    it("0.95 は受ける(境界値)", () => {
      expect(() =>
        assertInvariants(
          withRule("common/resubmission-loop", { similarityThreshold: 0.95 })
        )
      ).not.toThrow()
    })

    it("0.96 は拒否する", () => {
      expect(() =>
        assertInvariants(
          withRule("common/resubmission-loop", { similarityThreshold: 0.96 })
        )
      ).toThrow(/similarityThreshold/)
    })
  })

  describe("code/protected-paths の excludeDefaults と generated(R20)", () => {
    it("既定の glob と完全に一致する excludeDefaults は受ける", () => {
      expect(() =>
        assertInvariants(
          withRule("code/protected-paths", {
            excludeDefaults: [".github/**", "infra/**", "**/*.env*"]
          })
        )
      ).not.toThrow()
    })

    it.each([
      "infra/*",
      "src/auth/**",
      ".github"
    ])("既定に無い excludeDefaults %j は拒否する", (glob) => {
      expect(() =>
        assertInvariants(
          withRule("code/protected-paths", { excludeDefaults: [glob] })
        )
      ).toThrow(/excludeDefaults/)
    })

    it.each([
      "**/*",
      "*.js",
      "*/dist/**"
    ])("固定部の無い generated %j は拒否する", (glob) => {
      expect(() =>
        assertInvariants(
          withRule("code/protected-paths", { generated: [glob] })
        )
      ).toThrow(/generated/)
    })

    it.each([
      "!docs/**",
      "!dist/**",
      "!plugins/*/scripts/**"
    ])("否定の generated %j は拒否する", (glob) => {
      expect(() =>
        assertInvariants(
          withRule("code/protected-paths", { generated: [glob] })
        )
      ).toThrow(/generated.*否定/)
    })

    it("固定部のある generated は受ける", () => {
      expect(() =>
        assertInvariants(
          withRule("code/protected-paths", {
            generated: ["plugins/*/scripts/**", "dist/**"]
          })
        )
      ).not.toThrow()
    })
  })

  describe("subject.ignoreUncommitted(§6.2.2 の手順 3)", () => {
    it.each([
      "**/*",
      "*.md",
      "*/chat/**",
      "**"
    ])("固定部の無い glob %j は拒否する", (glob) => {
      const config = baseConfig()
      config.subject.ignoreUncommitted = ["docs/chat/**", glob]
      expect(() => assertInvariants(config)).toThrow(
        /subject\.ignoreUncommitted/
      )
    })

    it.each([
      "!docs/**",
      "!docs/chat/**",
      "!plugins/*/scripts/**"
    ])("否定の glob %j は拒否する", (glob) => {
      const config = baseConfig()
      config.subject.ignoreUncommitted = ["docs/chat/**", glob]
      expect(() => assertInvariants(config)).toThrow(
        /subject\.ignoreUncommitted.*否定/
      )
    })

    it("固定部のある glob は受ける", () => {
      const config = baseConfig()
      config.subject.ignoreUncommitted = [
        "docs/chat/**",
        "plugins/*/scripts/**",
        "notes/*/log.md"
      ]
      expect(() => assertInvariants(config)).not.toThrow()
    })
  })

  describe("締切と時間の上限(R21)", () => {
    it("judge.deadlineMs の上限ちょうどは受け、超えると拒否する", () => {
      const ok = baseConfig()
      ok.judge.deadlineMs = MAX_DEADLINE_MS
      expect(() => assertInvariants(ok)).not.toThrow()

      const over = baseConfig()
      over.judge.deadlineMs = MAX_DEADLINE_MS + 1
      expect(() => assertInvariants(over)).toThrow(/deadlineMs/)
      expect(MAX_DEADLINE_MS).toBe(1800000)
    })

    it("judge.timeoutMs が judge.deadlineMs を超えると拒否する", () => {
      const config = baseConfig()
      config.judge.timeoutMs = config.judge.deadlineMs + 1
      expect(() => assertInvariants(config)).toThrow(/timeoutMs/)
    })

    it("contextJudge.timeoutMs が judge.deadlineMs を超えると拒否する", () => {
      const config = baseConfig()
      config.contextJudge.timeoutMs = config.judge.deadlineMs + 1
      expect(() => assertInvariants(config)).toThrow(/contextJudge\.timeoutMs/)
    })
  })

  describe("contextJudge.thresholds(R19)", () => {
    it.each([
      [0.5, 0.5],
      [0.8, 0.7]
    ])("lower %s・raise %s は拒否する", (lower, raise) => {
      const config = baseConfig()
      config.contextJudge.thresholds = { lower, raise }
      expect(() => assertInvariants(config)).toThrow(/lower/)
    })
  })
})
