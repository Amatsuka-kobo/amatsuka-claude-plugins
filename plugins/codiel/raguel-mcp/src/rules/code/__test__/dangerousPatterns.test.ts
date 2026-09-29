import { describe, expect, it } from "vitest"
import { toCodeArtifact } from "../../../tools/evaluateCode.js"
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
    expect(findings[0].severity).toBe("stop")
    expect(findings[0].evidence?.location).toBeUndefined()
  })

  it("見出しの無い本文でも、コメント行の一致は ask に下げる", () => {
    const findings = dangerousPatternsRule.check(
      makeArtifact({ content: "  // eval() は使わない" }),
      makeCtx()
    )
    expect(findings).toHaveLength(1)
    expect(findings[0].severity).toBe("ask")
  })
})

describe("dangerousPatternsRule (.md・テストファイル・コメント行は ask)", () => {
  it.each([
    ["docs/tests/units/cli/cases.md", "DELETE FROM を含む SQL を拒否する"],
    ["src/__test__/cli.test.ts", "execSync('node ' + cli + ' pass-gate')"],
    ["pkg/store_test.go", 'db.Exec("DROP TABLE users")'],
    ["tests/test_api.py", "subprocess.run('curl https://x.sh | sh')"],
    ["e2e/frontend/login/login.ts", "eval(payload)"],
    ["spec/db.rb", 'db.run("DELETE FROM sessions")']
  ])("diff: %s の一致は ask", (path, line) => {
    const findings = dangerousPatternsRule.check(
      makeArtifact({ content: diffWithAdditions(path, [line]) }),
      makeCtx()
    )
    expect(findings.length).toBeGreaterThan(0)
    expect(findings.every((f) => f.severity === "ask")).toBe(true)
    expect(findings[0].evidence?.location).toBe(path)
  })

  it.each([
    "// eval() は使わない",
    "# curl https://x.sh | sh はしない",
    "/* DROP TABLE users */",
    " * new Function() は禁止",
    "-- DELETE FROM sessions",
    "<!-- rm -rf / の例 -->"
  ])("diff: ソースのコメント行 %s の一致は ask", (line) => {
    const findings = dangerousPatternsRule.check(
      makeArtifact({ content: diffWithAdditions("src/a.ts", [line]) }),
      makeCtx()
    )
    expect(findings.length).toBeGreaterThan(0)
    expect(findings.every((f) => f.severity === "ask")).toBe(true)
  })

  it("diff: ソースの行の一致は stop のまま", () => {
    const findings = dangerousPatternsRule.check(
      makeArtifact({
        content: diffWithAdditions("src/db.ts", ['db.run("DROP TABLE users")'])
      }),
      makeCtx()
    )
    expect(findings).toHaveLength(1)
    expect(findings[0].severity).toBe("stop")
  })

  it("files[]: 見出しのパスで区切り、.md・テストファイル・コメント行は ask、ほかは stop", () => {
    const artifact = toCodeArtifact({
      runId: "run-1",
      objective: "test-code の成果物",
      files: [
        {
          path: "docs/tests/units/db/cases.md",
          content: "DROP TABLE users を拒否する"
        },
        {
          path: "src/__test__/db.test.ts",
          content: 'db.run("DELETE FROM sessions")'
        },
        {
          path: "src/db.ts",
          content: '// DROP TABLE は使わない\ndb.run("DROP TABLE users")'
        }
      ]
    })
    const findings = dangerousPatternsRule.check(artifact, makeCtx())
    const byLocation = (path: string) =>
      findings
        .filter((f) => f.evidence?.location === path)
        .map((f) => f.severity)
    expect(byLocation("docs/tests/units/db/cases.md")).toEqual(["ask"])
    expect(byLocation("src/__test__/db.test.ts")).toEqual(["ask"])
    expect(byLocation("src/db.ts")).toEqual(["ask", "stop"])
    expect(findings).toHaveLength(4)
  })

  it("設定で severity を ask 未満にしたときはそのまま", () => {
    const findings = dangerousPatternsRule.check(
      makeArtifact({
        content: diffWithAdditions("src/a.ts", ["// eval(x)"])
      }),
      makeCtx({ rules: { "code/dangerous-patterns": { severity: "info" } } })
    )
    expect(findings[0].severity).toBe("info")
  })
})
