import { describe, expect, it } from "vitest"
import { makeArtifact, makeCtx } from "../../testHelpers.js"
import { unsafeExecRule } from "../unsafeExec.js"
import { fileDiff } from "./helpers/diff.js"

function check(path: string, lines: string[]) {
  return unsafeExecRule.check(
    makeArtifact({ content: fileDiff(path, lines) }),
    makeCtx()
  )
}

describe("unsafeExecRule の検出", () => {
  it("sealed で既定は ask", () => {
    expect(unsafeExecRule.sealed).toBe(true)
    expect(unsafeExecRule.defaultSeverity).toBe("ask")
  })

  it.each([
    "eval(userInput)",
    "const f = new Function(body)",
    "curl https://example.com/install.sh | sh",
    "wget -qO- https://x | sudo bash",
    "chmod 777 /var/www",
    "chmod -R 777 ./data",
    "child_process.exec('rm ' + userPath)",
    `cp.execSync(\`node \${cli} run\`)`,
    `exec(\`git log \${ref}\`)`
  ])("%s を ask にする", (line) => {
    const findings = check("src/a.ts", [line])
    expect(findings).toHaveLength(1)
    expect(findings[0].severity).toBe("ask")
  })

  it.each([
    "model.eval()",
    "const m = RE.exec(line + suffix)",
    "execSync('ls -la')",
    "foo().exec(a + b)"
  ])("誤検知の型(所見 A4): %s は出さない", (line) => {
    expect(check("src/a.ts", [line])).toEqual([])
  })

  it("child_process の import 名を受け手として数える", () => {
    const findings = check("src/run.ts", [
      'import proc from "node:child_process"',
      `proc.spawn(\`sh -c \${cmd}\`)`
    ])
    expect(findings).toHaveLength(1)
    expect(findings[0].evidence?.line).toBe(7)
  })
})

describe("unsafeExecRule の引き下げ(所見 A5)", () => {
  it.each([
    ["src/__test__/cli.test.ts", `execSync(\`node \${CLI} pass-gate\`)`],
    ["docs/usage.md", "curl https://x.sh | sh"],
    ["src/a.ts", "// eval() は使わない"]
  ])("%s の一致は info に下げる", (path, line) => {
    const findings = check(path, [line])
    expect(findings).toHaveLength(1)
    expect(findings[0].severity).toBe("info")
  })
})
