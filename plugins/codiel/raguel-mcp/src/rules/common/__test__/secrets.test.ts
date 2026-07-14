import { describe, expect, it } from "vitest"
import type {
  Artifact,
  RaguelConfig,
  RuleContext
} from "../../../core/types.js"
import { secretsRule } from "../secrets.js"

function makeArtifact(content: string): Artifact {
  return {
    kind: "code",
    runId: "run-1",
    objective: "test",
    content,
    changedPaths: [],
    steps: [],
    context: {}
  }
}

function makeCtx(rules: RaguelConfig["rules"] = {}): RuleContext {
  return {
    config: {
      version: 1,
      onError: "ASK",
      storage: {
        casesDir: "/tmp/cases",
        retention: { maxRuns: 200, maxDays: 90 }
      },
      judge: {
        provider: "none",
        model: "haiku",
        timeoutMs: 60000,
        canStop: false,
        maxConcurrency: 4,
        thresholds: { proceed: 80, confidence: 60, maxVariance: 30 }
      },
      weight: { tiers: { standard: 30, critical: 70 } },
      panel: {
        trivial: [],
        standard: [],
        critical: [],
        perPanelist: {}
      },
      precedent: { seedCatalog: true, topN: 5 },
      rules
    },
    priorSubmissions: []
  }
}

describe("secretsRule 既知パターン", () => {
  it("AWS アクセスキーを検出する", () => {
    const findings = secretsRule.check(
      makeArtifact("const key = 'AKIAABCDEFGHIJKLMNOP'"),
      makeCtx()
    )
    expect(findings.some((f) => f.message.includes("aws-access-key"))).toBe(
      true
    )
  })

  it("GitHub トークンを検出する", () => {
    const token = `ghp_${"a".repeat(36)}`
    const findings = secretsRule.check(makeArtifact(token), makeCtx())
    expect(findings.length).toBeGreaterThan(0)
  })

  it("GitHub PAT を検出する", () => {
    const token = `github_pat_${"a".repeat(24)}`
    const findings = secretsRule.check(makeArtifact(token), makeCtx())
    expect(findings.length).toBeGreaterThan(0)
  })

  it("Anthropic/OpenAI 系 sk- トークンを検出する", () => {
    const token = `sk-${"a".repeat(24)}`
    const findings = secretsRule.check(makeArtifact(token), makeCtx())
    expect(findings.length).toBeGreaterThan(0)
  })

  it("秘密鍵ブロックを検出する", () => {
    const findings = secretsRule.check(
      makeArtifact("-----BEGIN RSA PRIVATE KEY-----\nMIIExxxx"),
      makeCtx()
    )
    expect(findings.length).toBeGreaterThan(0)
  })

  it("JWT を検出する", () => {
    const jwt =
      "eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxMjM0NTY3ODkwIn0.dozjgNryP4J3jVmNHl0w5N_XgL0n3I9PlFUP0THsR8U"
    const findings = secretsRule.check(makeArtifact(jwt), makeCtx())
    expect(findings.some((f) => f.message.includes("jwt"))).toBe(true)
  })

  it("Slack トークンを検出する", () => {
    const findings = secretsRule.check(
      makeArtifact("xoxb-1234567890-abcdefg"),
      makeCtx()
    )
    expect(findings.length).toBeGreaterThan(0)
  })

  it("汎用の api_key = '...' 代入を検出する", () => {
    const findings = secretsRule.check(
      makeArtifact('const config = { api_key: "abcdefghijklmnopqrstuvwx" }'),
      makeCtx()
    )
    expect(findings.length).toBeGreaterThan(0)
  })

  it("既定 severity は stop", () => {
    const findings = secretsRule.check(
      makeArtifact("AKIAABCDEFGHIJKLMNOP"),
      makeCtx()
    )
    expect(findings[0].severity).toBe("stop")
  })
})

describe("secretsRule 偽陽性除外", () => {
  it("pnpm-lock の integrity 行は除外する", () => {
    const line =
      "  integrity: sha512-abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789+/=="
    const findings = secretsRule.check(makeArtifact(line), makeCtx())
    expect(findings).toEqual([])
  })

  it("40桁の git ハッシュは除外する", () => {
    const hash = "a1b2c3d4e5f6a1b2c3d4e5f6a1b2c3d4e5f6a1b2"
    const findings = secretsRule.check(makeArtifact(hash), makeCtx())
    expect(findings).toEqual([])
  })

  it("64桁の git ハッシュ(sha256)は除外する", () => {
    const hash = "a".repeat(64)
    const findings = secretsRule.check(makeArtifact(hash), makeCtx())
    expect(findings).toEqual([])
  })

  it("URL を含む行は entropy スキャン対象外", () => {
    const line =
      "see https://example.com/path/AbCdEfGhIjKlMnOpQrStUvWxYz0123456789 for docs"
    const findings = secretsRule.check(makeArtifact(line), makeCtx())
    expect(findings).toEqual([])
  })

  it("設定 allowPatterns による追加除外", () => {
    const line = "const key = 'AKIAABCDEFGHIJKLMNOP' // dummy-fixture"
    const findings = secretsRule.check(
      makeArtifact(line),
      makeCtx({
        "common/secrets": { allowPatterns: ["dummy-fixture"] }
      })
    )
    expect(findings).toEqual([])
  })
})
