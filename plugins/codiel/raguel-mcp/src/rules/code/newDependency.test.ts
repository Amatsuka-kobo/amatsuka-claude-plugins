import { describe, expect, it } from "vitest"
import { makeArtifact, makeCtx } from "../testHelpers.js"
import { newDependencyRule } from "./newDependency.js"

function fileDiff(path: string, additions: string[]): string {
  return [
    `diff --git a/${path} b/${path}`,
    `--- a/${path}`,
    `+++ b/${path}`,
    "@@ -1,1 +1,2 @@",
    ...additions.map((l) => `+${l}`)
  ].join("\n")
}

describe("newDependencyRule", () => {
  it("package.json への dependencies 追加を検出する", () => {
    const findings = newDependencyRule.check(
      makeArtifact({
        content: fileDiff("package.json", ['"lodash": "^4.17.21",'])
      }),
      makeCtx()
    )
    expect(findings.length).toBeGreaterThan(0)
    expect(findings[0].severity).toBe("ask")
  })

  it("package.json の name/version 変更では発火しない", () => {
    const findings = newDependencyRule.check(
      makeArtifact({
        content: fileDiff("package.json", ['"version": "0.0.2-dev",'])
      }),
      makeCtx()
    )
    expect(findings).toEqual([])
  })

  it("pnpm-lock.yaml へのパッケージ追加を検出する", () => {
    const findings = newDependencyRule.check(
      makeArtifact({
        content: fileDiff("pnpm-lock.yaml", ["  lodash@4.17.21:"])
      }),
      makeCtx()
    )
    expect(findings.length).toBeGreaterThan(0)
  })

  it("requirements.txt への追加を検出する", () => {
    const findings = newDependencyRule.check(
      makeArtifact({
        content: fileDiff("requirements.txt", ["requests==2.31.0"])
      }),
      makeCtx()
    )
    expect(findings.length).toBeGreaterThan(0)
  })

  it("Cargo.toml の依存追加を検出する", () => {
    const findings = newDependencyRule.check(
      makeArtifact({
        content: fileDiff("Cargo.toml", ['serde = "1.0"'])
      }),
      makeCtx()
    )
    expect(findings.length).toBeGreaterThan(0)
  })

  it("Cargo.toml の [package] メタ情報変更では発火しない", () => {
    const findings = newDependencyRule.check(
      makeArtifact({
        content: fileDiff("Cargo.toml", ['edition = "2021"'])
      }),
      makeCtx()
    )
    expect(findings).toEqual([])
  })

  it("go.mod への require 追加を検出する", () => {
    const findings = newDependencyRule.check(
      makeArtifact({
        content: fileDiff("go.mod", ["github.com/pkg/errors v0.9.1"])
      }),
      makeCtx()
    )
    expect(findings.length).toBeGreaterThan(0)
  })

  it("依存に無関係なファイルでは発火しない", () => {
    const findings = newDependencyRule.check(
      makeArtifact({ content: fileDiff("src/index.ts", ["const x = 1"]) }),
      makeCtx()
    )
    expect(findings).toEqual([])
  })

  it("非 diff の場合は判定不能として発火しない", () => {
    const findings = newDependencyRule.check(
      makeArtifact({ content: '"lodash": "^4.17.21"' }),
      makeCtx()
    )
    expect(findings).toEqual([])
  })
})
