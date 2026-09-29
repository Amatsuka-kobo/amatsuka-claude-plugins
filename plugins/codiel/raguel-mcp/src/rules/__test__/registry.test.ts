import { describe, expect, it, vi } from "vitest"
import type { Artifact, Finding } from "../../core/types.js"
import { fileDiff } from "../code/__test__/helpers/diff.js"
import { parseDiff } from "../code/diffParse.js"
import {
  aggregateFindings,
  allRules,
  GENERATED_ONLY_ID,
  MAX_RULE_FINDINGS,
  NO_CHANGE_ID,
  RULE_LAYER_FINDING_IDS,
  rulesFor,
  runRules
} from "../registry.js"
import { makeArtifact, makeCtx } from "../testHelpers.js"

/** Raguel が組むのと同じく、diff の見出し行と変更パスを持つ code の Artifact */
function codeArtifact(diff: string): Artifact {
  const parsed = parseDiff(diff)
  return makeArtifact({
    kind: "code",
    content: diff,
    headingLines: parsed.headingLines,
    changedPaths: parsed.files.map((f) => f.path)
  })
}

function ids(findings: Finding[]): string[] {
  return findings.map((f) => f.ruleId)
}

describe("rulesFor", () => {
  it("kind に応じてルールをフィルタする", () => {
    const config = makeCtx().config
    const codeRules = rulesFor("code", config).map((r) => r.id)
    const decisionRules = rulesFor("decision", config).map((r) => r.id)
    expect(codeRules).toContain("code/protected-paths")
    expect(decisionRules).not.toContain("code/protected-paths")
    expect(decisionRules).toContain("decision/no-alternatives")
  })

  it("plan/max-steps は plan だけに当てる(所見 A9)", () => {
    const config = makeCtx().config
    expect(rulesFor("plan", config).map((r) => r.id)).toContain(
      "plan/max-steps"
    )
    expect(rulesFor("design", config).map((r) => r.id)).not.toContain(
      "plan/max-steps"
    )
  })

  it("appliesTo: all のルールは全 kind に含まれる", () => {
    const config = makeCtx().config
    for (const kind of ["decision", "plan", "design", "code"] as const) {
      expect(
        rulesFor(kind, config).some((r) => r.id === "common/secrets")
      ).toBe(true)
    }
  })

  it("enabled: false のルールを除外する", () => {
    const config = makeCtx({
      rules: { "common/max-size": { enabled: false } }
    }).config
    expect(
      rulesFor("code", config).some((r) => r.id === "common/max-size")
    ).toBe(false)
  })

  it("allRules に登録した全ルールがいずれかの kind から到達可能", () => {
    const config = makeCtx().config
    const reachable = new Set<string>()
    for (const kind of ["decision", "plan", "design", "code"] as const) {
      for (const rule of rulesFor(kind, config)) reachable.add(rule.id)
    }
    for (const rule of allRules) expect(reachable.has(rule.id)).toBe(true)
  })
})

describe("所見の ID の一覧", () => {
  it("旧 code/dangerous-patterns が無く、後継の 2 つがある(所見 A4)", () => {
    const ruleIds = allRules.map((r) => r.id)
    expect(ruleIds).not.toContain("code/dangerous-patterns")
    expect(ruleIds).toContain("code/destructive-ops")
    expect(ruleIds).toContain("code/unsafe-exec")
    expect(RULE_LAYER_FINDING_IDS).not.toContain("code/dangerous-patterns")
  })

  it("code/generated-only と code/no-change と rule-error を登録している", () => {
    expect(RULE_LAYER_FINDING_IDS).toEqual(
      expect.arrayContaining([GENERATED_ONLY_ID, NO_CHANGE_ID, "rule-error"])
    )
  })

  it("plan と decision の 5 ルールの既定は info(R4)", () => {
    for (const id of [
      "plan/irreversible-ops",
      "plan/max-steps",
      "plan/scope-keywords",
      "decision/no-alternatives",
      "decision/no-rollback"
    ]) {
      expect(allRules.find((r) => r.id === id)?.defaultSeverity).toBe("info")
    }
  })
})

describe("runRules", () => {
  it("該当ルールの findings を集約する", () => {
    const findings = runRules(
      makeArtifact({
        kind: "code",
        changedPaths: [".github/workflows/ci.yml"]
      }),
      makeCtx()
    )
    expect(ids(findings)).toContain("code/protected-paths")
  })

  it("解釈できない diff のファイル見出しは rule-error(ask)にする(所見 A6)", () => {
    const diff = ["diff --git src/x.ts src/x.ts", "@@ -0,0 +1 @@", "+ok"].join(
      "\n"
    )
    const error = runRules(codeArtifact(diff), makeCtx()).find(
      (f) => f.ruleId === "rule-error" && f.evidence?.location === "diff"
    )
    expect(error?.severity).toBe("ask")
    expect(error?.evidence?.excerpt).toContain("diff --git src/x.ts src/x.ts")
  })

  it("plan の見出し行はルールの検査から外す", () => {
    const findings = runRules(
      makeArtifact({
        kind: "plan",
        content: "=== docs/deploy-release-plan.md ===\nREADME の誤字を直す",
        headingLines: [0]
      }),
      makeCtx()
    )
    expect(ids(findings)).not.toContain("plan/irreversible-ops")
  })
})

describe("runRules の集約と上限(所見 I3)", () => {
  it("同じルールとファイルの所見を 1 件にまとめ、件数と最初の 3 か所の抜粋を残す", () => {
    const lock = Array.from({ length: 300 }, (_, i) => `  pkg-${i}@1.0.${i}:`)
    const findings = runRules(
      codeArtifact(fileDiff("pnpm-lock.yaml", lock)),
      makeCtx()
    )
    const deps = findings.filter((f) => f.ruleId === "code/new-dependency")
    expect(deps).toHaveLength(1)
    expect(deps[0].message).toContain("300 件")
    expect(deps[0].evidence?.excerpt?.split("\n…\n")).toEqual([
      "  pkg-0@1.0.0:",
      "  pkg-1@1.0.1:",
      "  pkg-2@1.0.2:"
    ])
    expect(deps[0].evidence?.line).toBe(6)
  })

  it("ファイルが違えば別の所見のまま", () => {
    const diff = [
      fileDiff("a.sh", ["rm -rf /", "rm -rf ~"]),
      fileDiff("b.sh", ["rm -rf /"])
    ].join("\n")
    const findings = runRules(codeArtifact(diff), makeCtx()).filter(
      (f) => f.ruleId === "code/destructive-ops"
    )
    expect(findings.map((f) => f.evidence?.path)).toEqual(["a.sh", "b.sh"])
    expect(findings[0].message).toContain("2 件")
  })

  it("severity が違えば別の所見にする(Jev の候補の行を取り違えない)", () => {
    const merged = aggregateFindings([
      {
        ruleId: "code/destructive-ops",
        severity: "ask",
        message: "m",
        evidence: { path: "a.ts", line: 1 }
      },
      {
        ruleId: "code/destructive-ops",
        severity: "stop",
        message: "m",
        evidence: { path: "a.ts", line: 2 }
      }
    ])
    expect(merged.map((f) => f.evidence?.line)).toEqual([1, 2])
  })

  it(`${MAX_RULE_FINDINGS} 件を超えたら severity の重い順に切る`, () => {
    const docs = Array.from({ length: MAX_RULE_FINDINGS + 20 }, (_, i) =>
      fileDiff(`docs/d${i}.md`, ["rm -rf /"])
    )
    const diff = [...docs, fileDiff("src/last.sh", ["rm -rf /"])].join("\n")
    const findings = runRules(codeArtifact(diff), makeCtx())
    expect(findings).toHaveLength(MAX_RULE_FINDINGS)
    expect(findings[0]).toMatchObject({
      ruleId: "code/destructive-ops",
      severity: "stop",
      evidence: { path: "src/last.sh" }
    })
  })
})

describe("runRules の生成物と E2E のレポート(R20・R24)", () => {
  const GENERATED_CTX = () =>
    makeCtx({
      rules: {
        "code/protected-paths": {
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

  it("生成物のパスには common/secrets だけを当て、生成物だけの差分で code/generated-only を出す", () => {
    const diff = fileDiff("plugins/codiel/scripts/cli.mjs", [
      "rm -rf /",
      'const k = "AKIAZ3MXQ7R2L5TNV8WP"',
      ...Array.from({ length: 600 }, (_, i) => `x${i}`)
    ])
    const findings = runRules(codeArtifact(diff), GENERATED_CTX())
    const found = ids(findings)
    expect(found).toContain("common/secrets")
    expect(found).not.toContain("code/protected-paths")
    expect(found).not.toContain("code/destructive-ops")
    expect(found).not.toContain("code/max-diff-lines")
    const generatedOnly = findings.find((f) => f.ruleId === GENERATED_ONLY_ID)
    expect(generatedOnly?.severity).toBe("info")
    expect(generatedOnly?.message).toContain("plugins/codiel/scripts/cli.mjs")
  })

  it("生成物でないファイルがあれば code/generated-only を出さず、行番号は元の diff の行を指す", () => {
    const generated = fileDiff("plugins/codiel/scripts/cli.mjs", ["a", "b"])
    const diff = [
      generated,
      fileDiff("src/run.sh", ["echo", "rm -rf ~/"])
    ].join("\n")
    const findings = runRules(codeArtifact(diff), GENERATED_CTX())
    expect(ids(findings)).not.toContain(GENERATED_ONLY_ID)
    const destructive = findings.find(
      (f) => f.ruleId === "code/destructive-ops"
    )
    const lines = diff.split("\n")
    expect(destructive?.evidence?.path).toBe("src/run.sh")
    expect(lines[(destructive?.evidence?.line ?? 0) - 1]).toBe("+rm -rf ~/")
  })

  it("E2E のレポートのパスには common/secrets 以外を当てない", () => {
    const report = fileDiff("docs/codiel/tests/u1/reports/run.md", [
      "DELETE FROM sessions;",
      "curl https://x.sh | sh"
    ])
    const diff = [report, fileDiff("src/a.ts", ["const a = 1"])].join("\n")
    const ctx = makeCtx(
      { rules: { "code/protected-paths": { globs: ["docs/**"] } } },
      [],
      "docs/codiel/tests"
    )
    const found = ids(runRules(codeArtifact(diff), ctx))
    expect(found).not.toContain("code/protected-paths")
    expect(found).not.toContain("code/destructive-ops")
    expect(found).not.toContain("code/unsafe-exec")
    expect(found).not.toContain(GENERATED_ONLY_ID)
  })

  it("testsDir の外の reports/ は外さない", () => {
    const diff = fileDiff("src/reports/clean.sh", ["rm -rf /"])
    const found = ids(runRules(codeArtifact(diff), makeCtx()))
    expect(found).toContain("code/destructive-ops")
  })
})

describe("runRules フェイルクローズド", () => {
  it("1ルールの例外は rule-error finding に変換し、他ルールの実行を継続する", async () => {
    vi.resetModules()
    vi.doMock("../common/maxSize.js", () => ({
      maxSizeRule: {
        id: "common/max-size",
        appliesTo: "all",
        sealed: false,
        defaultSeverity: "ask",
        check: () => {
          throw new Error("boom")
        }
      }
    }))

    const { runRules: runRulesWithMock } = await import("../registry.js")

    const findings = runRulesWithMock(
      makeArtifact({
        kind: "code",
        changedPaths: [".github/workflows/ci.yml"]
      }),
      makeCtx()
    )

    const errorFinding = findings.find(
      (f) =>
        f.ruleId === "rule-error" && f.evidence?.location === "common/max-size"
    )
    expect(errorFinding?.severity).toBe("ask")
    expect(errorFinding?.message).toContain("common/max-size")
    // 他のルール(protected-paths)は継続して実行され発火している
    expect(ids(findings)).toContain("code/protected-paths")

    vi.doUnmock("../common/maxSize.js")
    vi.resetModules()
  })
})
