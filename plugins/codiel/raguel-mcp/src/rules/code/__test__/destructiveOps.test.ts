import { describe, expect, it } from "vitest"
import { makeArtifact, makeCtx } from "../../testHelpers.js"
import { destructiveOpsRule } from "../destructiveOps.js"
import { fileDiff } from "./helpers/diff.js"

function check(path: string, lines: string[], deletions: string[] = []) {
  return destructiveOpsRule.check(
    makeArtifact({ content: fileDiff(path, lines, deletions) }),
    makeCtx()
  )
}

describe("destructiveOpsRule の検出", () => {
  it("sealed で既定は stop", () => {
    expect(destructiveOpsRule.sealed).toBe(true)
    expect(destructiveOpsRule.defaultSeverity).toBe("stop")
  })

  it.each([
    "rm -rf /",
    "rm -rf /*",
    "rm -rf ~",
    "rm -rf ~/",
    "rm -rf $HOME",
    'rm -rf "$HOME"',
    "rm -fr $BUILD_DIR/",
    'rm -rf "$TARGET_DIR"/',
    `rm -r -f \${OUT}`,
    "rm --recursive --force /",
    'execSync("rm -rf /")'
  ])("見逃しの型(所見 A4): %s を stop にする", (line) => {
    const findings = check("scripts/clean.sh", [line])
    expect(findings).toHaveLength(1)
    expect(findings[0].severity).toBe("stop")
  })

  it.each([
    "rm -rf ./dist",
    "rm -rf node_modules",
    'rm -rf "$TMP_DIR"',
    `rm -rf "\${OUT:?}"/`,
    "rm -r $DIR",
    "rm -f /tmp/x"
  ])("安全な形 %s は出さない", (line) => {
    expect(check("scripts/clean.sh", [line])).toEqual([])
  })

  it.each([
    "git push --force origin main",
    "git push -f origin feature/foo",
    "git push origin +main",
    "git push --force-with-lease origin topic"
  ])("git push の強制 %s を出す(ブランチを問わない)", (line) => {
    expect(check("deploy.sh", [line])).toHaveLength(1)
  })

  it("強制の無い git push は出さない", () => {
    expect(check("deploy.sh", ["git push origin main"])).toEqual([])
  })

  it("git reset --hard と git clean -f の組を出し、片方だけなら出さない", () => {
    const both = check("reset.sh", [
      "git reset --hard origin/main",
      "git clean -fdx"
    ])
    expect(both).toHaveLength(1)
    expect(both[0].evidence?.line).toBe(7)
    expect(check("reset.sh", ["git reset --hard HEAD~1"])).toEqual([])
    expect(check("reset.sh", ["git clean -fd"])).toEqual([])
  })

  it.each([
    "DROP TABLE users;",
    "drop database app;",
    "TRUNCATE TABLE sessions;",
    "TRUNCATE sessions;"
  ])("%s を出す", (line) => {
    expect(check("migrate.sql", [line])).toHaveLength(1)
  })

  it("文字列の truncate の関数は出さない", () => {
    expect(check("src/a.ts", ["const s = truncate(text, 10)"])).toEqual([])
  })

  it("WHERE の無い DELETE FROM を出す", () => {
    expect(check("migrate.sql", ["DELETE FROM users;"])).toHaveLength(1)
  })

  it("2 行に分けた DELETE FROM と WHERE は出さない(所見 A4 の誤検知)", () => {
    expect(
      check("migrate.sql", ["DELETE FROM users", "WHERE id = 1;"])
    ).toEqual([])
  })

  it("文末の後の WHERE は、前の DELETE の WHERE とみなさない", () => {
    const findings = check("migrate.sql", [
      "DELETE FROM users;",
      "SELECT * FROM t WHERE id = 1;"
    ])
    expect(findings).toHaveLength(1)
  })

  it("削除行では出さない", () => {
    expect(check("script.sh", ["echo done"], ["rm -rf /"])).toEqual([])
  })

  it("所見に path・line・抜粋を載せる", () => {
    const findings = check("scripts/clean.sh", ["echo start", "rm -rf ~/"])
    expect(findings[0].evidence).toEqual({
      location: "scripts/clean.sh",
      path: "scripts/clean.sh",
      line: 7,
      excerpt: "rm -rf ~/"
    })
  })
})

describe("destructiveOpsRule の引き下げ(所見 A5)", () => {
  it.each([
    ["docs/tests/units/cli/cases.md", "DELETE FROM を含む SQL を拒否する"],
    ["src/__test__/db.test.ts", 'db.run("DELETE FROM sessions")'],
    ["pkg/store_test.go", 'db.Exec("DROP TABLE users")'],
    ["tests/test_api.py", "os.system('rm -rf /')"],
    ["e2e/frontend/cleanup.ts", "git push --force origin main"],
    ["src/test/java/FooTest.java", 'jdbc.execute("TRUNCATE TABLE users")']
  ])("%s の一致は ask に下げる", (path, line) => {
    const findings = check(path, [line])
    expect(findings).toHaveLength(1)
    expect(findings[0].severity).toBe("ask")
    expect(findings[0].message).toContain("ask に下げました")
  })

  it.each([
    "// rm -rf / はしない",
    "# git push --force は禁止",
    "/* DROP TABLE users */",
    " * TRUNCATE TABLE は使わない",
    "-- DELETE FROM sessions",
    "<!-- rm -rf ~ の例 -->"
  ])("ソースのコメント行 %s の一致は ask に下げる", (line) => {
    const findings = check("src/a.ts", [line])
    expect(findings).toHaveLength(1)
    expect(findings[0].severity).toBe("ask")
  })

  it("ソースの行の一致は stop のまま", () => {
    const findings = check("src/db.ts", ['db.run("DROP TABLE users")'])
    expect(findings[0].severity).toBe("stop")
  })
})
