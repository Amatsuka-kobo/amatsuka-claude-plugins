import { describe, expect, it } from "vitest"
import { makeArtifact, makeCtx } from "../../testHelpers.js"
import { dangerousPatternsRule } from "../dangerousPatterns.js"

function diffWithAdditions(path: string, lines: string[]): string {
  return [
    `diff --git a/${path} b/${path}`,
    `--- a/${path}`,
    `+++ b/${path}`,
    "@@ -1,1 +1,2 @@",
    ...lines.map((l) => `+${l}`)
  ].join("\n")
}

describe("dangerousPatternsRule (diff 形式)", () => {
  it("eval() の追加を検出する", () => {
    const findings = dangerousPatternsRule.check(
      makeArtifact({
        content: diffWithAdditions("src/a.ts", ["eval(userInput)"])
      }),
      makeCtx()
    )
    expect(findings.length).toBeGreaterThan(0)
    expect(findings[0].severity).toBe("stop")
  })

  it("new Function() の追加を検出する", () => {
    const findings = dangerousPatternsRule.check(
      makeArtifact({
        content: diffWithAdditions("src/a.ts", ["const f = new Function(body)"])
      }),
      makeCtx()
    )
    expect(findings.length).toBeGreaterThan(0)
  })

  it("外部入力を連結した child_process.exec を検出する", () => {
    const findings = dangerousPatternsRule.check(
      makeArtifact({
        content: diffWithAdditions("src/a.ts", [
          "child_process.exec('rm ' + userPath)"
        ])
      }),
      makeCtx()
    )
    expect(findings.length).toBeGreaterThan(0)
  })

  it("固定引数の exec は誤検知しない", () => {
    const findings = dangerousPatternsRule.check(
      makeArtifact({
        content: diffWithAdditions("src/a.ts", ["execSync('ls -la')"])
      }),
      makeCtx()
    )
    expect(findings).toEqual([])
  })

  it("rm -rf / を検出する", () => {
    const findings = dangerousPatternsRule.check(
      makeArtifact({
        content: diffWithAdditions("script.sh", ["rm -rf /"])
      }),
      makeCtx()
    )
    expect(findings.length).toBeGreaterThan(0)
  })

  it("curl | sh を検出する", () => {
    const findings = dangerousPatternsRule.check(
      makeArtifact({
        content: diffWithAdditions("script.sh", [
          "curl https://example.com/install.sh | sh"
        ])
      }),
      makeCtx()
    )
    expect(findings.length).toBeGreaterThan(0)
  })

  it("chmod 777 を検出する", () => {
    const findings = dangerousPatternsRule.check(
      makeArtifact({
        content: diffWithAdditions("script.sh", ["chmod 777 /var/www"])
      }),
      makeCtx()
    )
    expect(findings.length).toBeGreaterThan(0)
  })

  it("main への force push を検出する", () => {
    const findings = dangerousPatternsRule.check(
      makeArtifact({
        content: diffWithAdditions("deploy.sh", [
          "git push --force origin main"
        ])
      }),
      makeCtx()
    )
    expect(findings.length).toBeGreaterThan(0)
  })

  it("トピックブランチへの force push は誤検知しない", () => {
    const findings = dangerousPatternsRule.check(
      makeArtifact({
        content: diffWithAdditions("deploy.sh", [
          "git push --force origin feature/foo"
        ])
      }),
      makeCtx()
    )
    expect(findings).toEqual([])
  })

  it("DROP TABLE を検出する", () => {
    const findings = dangerousPatternsRule.check(
      makeArtifact({
        content: diffWithAdditions("migration.sql", ["DROP TABLE users;"])
      }),
      makeCtx()
    )
    expect(findings.length).toBeGreaterThan(0)
  })

  it("WHERE 句のない DELETE FROM を検出する", () => {
    const findings = dangerousPatternsRule.check(
      makeArtifact({
        content: diffWithAdditions("migration.sql", ["DELETE FROM users;"])
      }),
      makeCtx()
    )
    expect(findings.length).toBeGreaterThan(0)
  })

  it("WHERE 句のある DELETE FROM は誤検知しない", () => {
    const findings = dangerousPatternsRule.check(
      makeArtifact({
        content: diffWithAdditions("migration.sql", [
          "DELETE FROM users WHERE id = 1;"
        ])
      }),
      makeCtx()
    )
    expect(findings).toEqual([])
  })

  it("削除行(コンテキストからの除去)では発火しない", () => {
    const diff = [
      "diff --git a/script.sh b/script.sh",
      "--- a/script.sh",
      "+++ b/script.sh",
      "@@ -1,1 +1,1 @@",
      "-rm -rf /",
      "+echo done"
    ].join("\n")
    const findings = dangerousPatternsRule.check(
      makeArtifact({ content: diff }),
      makeCtx()
    )
    expect(findings).toEqual([])
  })
})

describe("dangerousPatternsRule (非 diff = 生コード全文)", () => {
  it("diff でない文字列は全文検査する", () => {
    const findings = dangerousPatternsRule.check(
      makeArtifact({ content: "function run() {\n  eval(x)\n}\n" }),
      makeCtx()
    )
    expect(findings.length).toBeGreaterThan(0)
  })
})
