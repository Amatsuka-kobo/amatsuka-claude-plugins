import { describe, expect, it } from "vitest"
import { makeArtifact, makeCtx } from "../../testHelpers.js"
import { maskSecrets, secretsRule } from "../secrets.js"

const AWS_KEY = "AKIAABCDEFGHIJKLMNOP"
const HIGH_ENTROPY = "Zq8xK2mP9vL4nR7tW3yB6cD1fG5hJ0sA"

function check(content: string, headingLines: number[] = [], ctx = makeCtx()) {
  return secretsRule.check(makeArtifact({ content, headingLines }), ctx)
}

describe("secretsRule 既知の形", () => {
  it("AWS アクセスキーを検出し、既定の severity は stop", () => {
    const findings = check(`const key = '${AWS_KEY}'`)
    expect(findings).toHaveLength(1)
    expect(findings[0].message).toContain("aws-access-key")
    expect(findings[0].severity).toBe("stop")
  })

  it.each([
    ["GitHub トークン", `ghp_${"a".repeat(36)}`],
    ["GitHub PAT", `github_pat_${"a".repeat(24)}`],
    ["sk- のトークン", `sk-${"a".repeat(24)}`],
    ["秘密鍵のブロック", "-----BEGIN RSA PRIVATE KEY-----"],
    [
      "JWT",
      "eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxMjM0NTY3ODkwIn0.dozjgNryP4J3jVmNHl0w5N_XgL0n3I9PlFUP0THsR8U"
    ],
    ["Slack トークン", "xoxb-1234567890-abcdefg"],
    ["api_key の代入", 'const c = { api_key: "abcdefghijklmnopqrstuvwx" }']
  ])("%s を検出する", (_name, content) => {
    expect(check(content).length).toBeGreaterThan(0)
  })

  it("語の中の sk-(/tmp/task-...)は既知の形として拾わない", () => {
    expect(
      check("cd /tmp/task-utility-chat-recorder-0123456789abcdef")
    ).toEqual([])
  })
})

describe("secretsRule URL を含む行(所見 A2)", () => {
  it("user:pass@ の形を検出する", () => {
    const findings = check(
      "DATABASE_URL=postgres://admin:hunter2secret@db.example.com:5432/app"
    )
    expect(findings.map((f) => f.message)).toEqual([
      expect.stringContaining("url-credentials")
    ])
  })

  it(":// を含む行でも ghp_・sk- の既知の形を検出する", () => {
    const ghp = `git clone https://github.com/o/r.git --token ghp_${"A1b2".repeat(9)}`
    const sk = `curl -H "Authorization: Bearer sk-ant-api03-${"x".repeat(24)}" https://api.example.com`
    expect(check(ghp).some((f) => f.message.includes("github-token"))).toBe(
      true
    )
    expect(check(sk).some((f) => f.message.includes("llm-api-key"))).toBe(true)
  })

  it("URL のホスト名とパスは、部分ごとの判定と 3 種の条件で外れる(W4R2-06)", () => {
    expect(
      check(
        [
          "see https://raguel-api-server-v2.internal.example.com/docs/managed-settings-script-2026/overview and postgres://db.example.com:5432/app",
          "https://github.com/amatsuka-kobo/claude-plugins/commit/a1b2c3d4e5f6a1b2c3d4e5f6a1b2c3d4e5f6a1b2",
          "https://registry.npmjs.org/@typescript-eslint/eslint-plugin-kit/-/eslint-plugin-kit-0.2.8.tgz"
        ].join("\n")
      )
    ).toEqual([])
  })

  it("URL のクエリの高エントロピーな値は拾う(W4R2-06)", () => {
    const findings = check(
      `fetch("https://api.example.com/v1/items?api_key=${HIGH_ENTROPY}&page=2")`
    )
    expect(findings).toHaveLength(1)
    expect(findings[0].message).toContain("高エントロピー")
    expect(findings[0].evidence?.excerpt).not.toContain(HIGH_ENTROPY)
  })

  it("URL のパスに埋めた高エントロピーな部分も拾う", () => {
    expect(check(`see https://example.com/docs/${HIGH_ENTROPY}`)).toHaveLength(
      1
    )
  })

  it("node_modules の行は :// を含んでもエントロピーで測らない", () => {
    expect(
      check(
        `  resolved "https://registry.example.com/x" node_modules/${HIGH_ENTROPY}`
      )
    ).toEqual([])
  })
})

describe("secretsRule エントロピー(所見 A1)", () => {
  // 所見 A1 の標本: unit-id 10 個とよくあるファイル名 6 個で作る 60 行
  const UNITS = [
    "feat-managed-settings-script",
    "feat-readme-test-notice",
    "fix-guard-write-hook-2026",
    "chore-backup-rotation-daemon",
    "feat-intent-driven-gating",
    "fix-resubmission-loop-d5",
    "feat-protected-paths-k1",
    "refactor-panel-provider-codex",
    "feat-jev-context-judge-r19",
    "docs-architecture-adr-009"
  ]
  const FILES = [
    "run.sh",
    "lib/common.sh",
    "readme-test-notice.test.mjs",
    "check-settings.mjs",
    "fixtures/expected-output.json",
    "playwright.config.ts"
  ]
  const SAMPLE = UNITS.flatMap((u) =>
    FILES.map((f) => `+++ b/.codiel/specs/${u}/scripts/${f}`)
  )

  it("60 行の標本は、見出し行として外さなくても 1 件も出ない", () => {
    expect(SAMPLE).toHaveLength(60)
    expect(check(SAMPLE.join("\n"))).toEqual([])
  })

  it("intent のパス・diff の見出し・lockfile の依存名は出ない", () => {
    const content = [
      "intent: docs/intents/2026-09-28-managed-settings-script.md を読む",
      "diff --git a/plugins/codiel/src/hooks/guard-write.ts b/plugins/codiel/src/hooks/guard-write.ts",
      "  /@typescript-eslint/eslint-plugin-kit@0.2.8:"
    ].join("\n")
    expect(check(content)).toEqual([])
  })

  it("英大文字・英小文字・数字の 3 種を含まない長い語は測らない", () => {
    expect(check("a1b2c3d4e5f6g7h8i9j0k1l2m3n4o5p6q7")).toEqual([])
    expect(check("ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefgh")).toEqual([])
    // 40 桁の git ハッシュ
    expect(check("a1b2c3d4e5f6a1b2c3d4e5f6a1b2c3d4e5f6a1b2")).toEqual([])
  })

  it("3 種を含む高エントロピーの語は検出する", () => {
    const findings = check(`const token = ${HIGH_ENTROPY}`)
    expect(findings).toHaveLength(1)
    expect(findings[0].message).toContain("高エントロピー")
  })

  it("/ と . で区切った部分ごとに測るので、パスの中の鍵も拾う", () => {
    expect(check(`key: config/${HIGH_ENTROPY}.pem`)).toHaveLength(1)
  })

  it("pnpm-lock の integrity 行は測らない", () => {
    const line =
      "  integrity: sha512-abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789+/=="
    expect(check(line)).toEqual([])
  })
})

describe("secretsRule 見出し行は位置で外す", () => {
  it("headingLines の行は、鍵に見える語を含んでも検査しない", () => {
    const content = [
      `=== ${HIGH_ENTROPY} ===`,
      "本文",
      `=== ${AWS_KEY} ===`
    ].join("\n")
    expect(check(content, [0, 2])).toEqual([])
  })

  it("見出し行の形の文字列でも、headingLines に無ければ検査する", () => {
    const content = `--- ${HIGH_ENTROPY} ---`
    expect(check(content)).toHaveLength(1)
  })
})

describe("secretsRule allowPatterns はトークンに当てる(所見 A3)", () => {
  it("行の別の場所に当たる正規表現では外れない", () => {
    const ctx = makeCtx({
      rules: { "common/secrets": { allowPatterns: ["dummy-fixture"] } }
    })
    expect(
      check(`const key = '${AWS_KEY}' // dummy-fixture`, [], ctx)
    ).toHaveLength(1)
  })

  it("トークンに当たる正規表現なら外れ、同じ行のほかのトークンは残る", () => {
    const ctx = makeCtx({
      rules: { "common/secrets": { allowPatterns: ["^AKIAABCDEFGHIJKLMNOP$"] } }
    })
    const findings = check(`${AWS_KEY} ${HIGH_ENTROPY}`, [], ctx)
    expect(findings).toHaveLength(1)
    expect(findings[0].message).toContain("高エントロピー")
  })
})

describe("secretsRule 抜粋と伏せ字(所見 G1・H1)", () => {
  it("抜粋は一致した行の前後 1 行と行番号で、トークンは先頭 4 文字だけ残す", () => {
    const content = [
      "line one",
      "line two",
      `key=${AWS_KEY}`,
      "line four",
      "line five"
    ].join("\n")
    const [finding] = check(content)
    expect(finding.evidence?.line).toBe(3)
    expect(finding.evidence?.location).toBe("3 行目")
    expect(finding.evidence?.excerpt).toBe(
      `2: line two\n3: key=AKIA${"*".repeat(16)}\n4: line four`
    )
    expect(finding.evidence?.excerpt).not.toContain(AWS_KEY)
  })

  it("本文の先頭と末尾では、ある行だけを抜粋する", () => {
    const [finding] = check(`${AWS_KEY}\nnext`)
    expect(finding.evidence?.excerpt).toBe(`1: AKIA${"*".repeat(16)}\n2: next`)
  })

  it("前後の行の別の秘密情報も伏せる", () => {
    const ghp = `ghp_${"A1b2".repeat(9)}`
    const [first] = check(`${AWS_KEY}\n${ghp}`)
    expect(first.evidence?.excerpt).not.toContain(ghp)
    expect(first.evidence?.excerpt).toContain(`ghp_${"*".repeat(32)}`)
  })

  it("message に鍵そのものを書かない", () => {
    for (const f of check(`${AWS_KEY} ${HIGH_ENTROPY}`)) {
      expect(f.message).not.toContain(AWS_KEY)
      expect(f.message).not.toContain(HIGH_ENTROPY)
    }
  })
})

describe("maskSecrets", () => {
  it("行の数と各行の長さを変えずに伏せる", () => {
    const text = `a\nkey=${AWS_KEY}\npostgres://admin:hunter2secret@db/x\n${HIGH_ENTROPY}`
    const masked = maskSecrets(text)
    expect(masked.split("\n").map((l) => l.length)).toEqual(
      text.split("\n").map((l) => l.length)
    )
    expect(masked).not.toContain(AWS_KEY)
    expect(masked).not.toContain("hunter2secret")
    expect(masked).not.toContain(HIGH_ENTROPY)
    expect(masked.split("\n")[0]).toBe("a")
  })

  it("PEM の秘密鍵は本体の行まで伏せる", () => {
    const body = "MIIEowIBAAKCAQEA7bq0x9pYd"
    const text = `前\n-----BEGIN RSA PRIVATE KEY-----\n${body}\n-----END RSA PRIVATE KEY-----\n後`
    const masked = maskSecrets(text)
    expect(masked).not.toContain(body)
    expect(masked.split("\n")).toHaveLength(5)
    expect(masked.split("\n")[0]).toBe("前")
    expect(masked.split("\n")[4]).toBe("後")
  })

  it("URL のクエリの高エントロピーな値を伏せ、ホスト名とパスは残す(W4R2-06)", () => {
    const text = `https://api.example.com/v1/items?token=${HIGH_ENTROPY}`
    const masked = maskSecrets(text)
    expect(masked).not.toContain(HIGH_ENTROPY)
    expect(masked.startsWith("https://api.example.com/v1/items?")).toBe(true)
    expect(masked).toHaveLength(text.length)
  })

  it("秘密情報の無い本文はそのまま返す", () => {
    const text =
      "docs/intents/2026-09-28-managed-settings-script.md\n日本語の説明"
    expect(maskSecrets(text)).toBe(text)
  })
})
