import { beforeEach, describe, expect, it, vi } from "vitest"
import { makeArtifact, makeConfig } from "../../rules/testHelpers.js"
import type { Artifact, Finding, ParsedDiff, RaguelConfig } from "../types.js"

// diffParse.ts の実装に依存しないよう、解析結果を差し替える
const parsedRef = vi.hoisted(() => ({ value: null as unknown }))
vi.mock("../../rules/code/diffParse.js", () => ({
  parseDiff: () => parsedRef.value
}))

const { computeWeight } = await import("../weight.js")

interface F {
  path: string
  lines: number
}

function setDiff(files: F[]): ParsedDiff {
  const parsed: ParsedDiff = {
    files: files.map((f) => ({
      path: f.path,
      additions: Array(f.lines).fill(""),
      deletions: [],
      isNew: false,
      isDeleted: false,
      isRename: false,
      isBinary: false
    })),
    totalChangedLines: files.reduce((s, f) => s + f.lines, 0),
    malformedHeaders: []
  }
  parsedRef.value = parsed
  return parsed
}

function codeArtifact(files: F[], overrides: Partial<Artifact> = {}) {
  setDiff(files)
  return makeArtifact({
    kind: "code",
    content: "diff",
    changedPaths: files.map((f) => f.path),
    ...overrides
  })
}

function configWith(
  rule: string,
  params: Record<string, unknown>
): RaguelConfig {
  const config = makeConfig()
  config.rules[rule] = { ...config.rules[rule], ...params }
  return config
}

const ask = (ruleId: string): Finding => ({
  ruleId,
  severity: "ask",
  message: "m"
})

beforeEach(() => {
  parsedRef.value = { files: [], totalChangedLines: 0, malformedHeaders: [] }
})

describe("code の点数(B1・B2)", () => {
  it("49 行・4 ファイルは 33 点で standard になる(B2)", () => {
    const files = ["a", "b", "c", "d"].map((n) => ({
      path: `src/${n}.ts`,
      lines: 12
    }))
    files[0] = { path: "src/a.ts", lines: 13 }
    const r = computeWeight(codeArtifact(files), [], makeConfig())
    expect(r.score).toBe(33)
    expect(r.factors).toEqual({
      "kind-base": 20,
      "diff-lines": 5,
      "changed-files": 8
    })
    expect(r.tier).toBe("standard")
  })

  it("24 行・4 ファイルは trivial(28 点)", () => {
    const files = ["a", "b", "c", "d"].map((n) => ({
      path: `src/${n}.ts`,
      lines: 6
    }))
    const r = computeWeight(codeArtifact(files), [], makeConfig())
    expect(r.score).toBe(28)
    expect(r.tier).toBe("trivial")
  })

  it("25〜49 行・2 ファイルは trivial(29 点)", () => {
    const r = computeWeight(
      codeArtifact([
        { path: "src/a.ts", lines: 25 },
        { path: "src/b.ts", lines: 24 }
      ]),
      [],
      makeConfig()
    )
    expect(r.score).toBe(29)
    expect(r.tier).toBe("trivial")
  })

  it("1 ファイル 5000 行は 62 点で standard のまま", () => {
    const r = computeWeight(
      codeArtifact([{ path: "src/a.ts", lines: 5000 }]),
      [],
      makeConfig()
    )
    expect(r.score).toBe(62)
    expect(r.tier).toBe("standard")
  })

  it("不可逆キーワードは加点しない(B1)", () => {
    const artifact = codeArtifact([{ path: "src/a.ts", lines: 1 }], {
      content: "production migration と rm -rf の説明"
    })
    const r = computeWeight(artifact, [], makeConfig())
    expect(r.factors["irreversible-keyword"]).toBeUndefined()
    expect(r.score).toBe(22)
  })

  it("code/new-dependency の所見で 15 点を足す", () => {
    const artifact = codeArtifact([{ path: "src/a.ts", lines: 1 }])
    const r = computeWeight(
      artifact,
      [{ ruleId: "code/new-dependency", severity: "info", message: "m" }],
      makeConfig()
    )
    expect(r.factors["new-dependency"]).toBe(15)
    expect(r.tier).toBe("standard")
  })

  it("解析できたファイルが無いときは本文の行数で数える", () => {
    const artifact = makeArtifact({
      kind: "code",
      content: Array.from({ length: 100 }, () => "x").join("\n"),
      changedPaths: []
    })
    const r = computeWeight(artifact, [], makeConfig())
    expect(r.factors["diff-lines"]).toBe(20)
  })
})

describe("文書の点数(B2)", () => {
  it("小さな decision・design・plan も standard を下回らない", () => {
    for (const kind of ["decision", "design", "plan"] as const) {
      const r = computeWeight(
        makeArtifact({ kind, content: "短い" }),
        [],
        makeConfig()
      )
      expect(r.factors["kind-base"]).toBe(30)
      expect(r.tier).toBe("standard")
    }
  })

  it("tier の閾値を上げても文書は standard の下限を保つ", () => {
    const config = makeConfig()
    config.weight.tiers = { standard: 50, critical: 90 }
    const r = computeWeight(
      makeArtifact({ kind: "design", content: "短い" }),
      [],
      config
    )
    expect(r.tier).toBe("standard")
    expect(r.floors).toContain("kind-floor:standard")
  })

  it("本文が 4000 字増えるごとに 5 点足し、30 点で頭打ちにする", () => {
    const at = (n: number) =>
      computeWeight(
        makeArtifact({ kind: "design", content: "あ".repeat(n) }),
        [],
        makeConfig()
      ).factors["content-length"]
    expect(at(3999)).toBeUndefined()
    expect(at(8000)).toBe(10)
    expect(at(1_000_000)).toBe(30)
  })

  it("plan はステップ数が 5 件を超えた分の 2 倍を足し、20 点で頭打ちにする", () => {
    const steps = (n: number) =>
      Array.from({ length: n }, (_, i) => `${i + 1}. 手順`).join("\n")
    const at = (n: number) =>
      computeWeight(
        makeArtifact({ kind: "plan", content: steps(n) }),
        [],
        makeConfig()
      ).factors["plan-steps"]
    expect(at(5)).toBeUndefined()
    expect(at(10)).toBe(10)
    expect(at(40)).toBe(20)
  })

  it("decision の不可逆キーワードは加点しない", () => {
    const r = computeWeight(
      makeArtifact({ kind: "decision", content: "本番へ migration する" }),
      [],
      makeConfig()
    )
    expect(r.score).toBe(30)
  })
})

describe("保護パス近接(B3)", () => {
  const near = (path: string, config = makeConfig()) =>
    computeWeight(codeArtifact([{ path, lines: 1 }]), [], config).factors[
      "protected-path-proximity"
    ]

  it("既定の glob の固定部(.github・infra)の配下は近接になる", () => {
    expect(near(".github/workflows/ci.yml")).toBe(25)
    expect(near("infra/main.tf")).toBe(25)
  })

  it("固定部が空の glob(**/*.env*)は近接にならない", () => {
    expect(near("config/app.env")).toBeUndefined()
  })

  it("固定部の複数セグメントで比べる", () => {
    const config = configWith("code/protected-paths", {
      globs: ["src/server/auth/**"]
    })
    expect(near("src/server/auth/login.ts", config)).toBe(25)
    expect(near("src/utils/format.ts", config)).toBeUndefined()
    expect(near("src/server/db.ts", config)).toBeUndefined()
  })

  it("セグメントの途中までの一致は近接にならない", () => {
    expect(near(".github-actions/a.yml")).toBeUndefined()
    expect(near("infrastructure/a.tf")).toBeUndefined()
  })
})

describe("生成物と E2E のレポートの除外(R20・R24)", () => {
  const generated = configWith("code/protected-paths", {
    globs: ["plugins/**"],
    generated: ["plugins/*/scripts/**"]
  })

  it("生成物は行数・ファイル数・近接から外れる", () => {
    const artifact = codeArtifact([
      { path: "plugins/a/scripts/out.js", lines: 5000 },
      { path: "src/a.ts", lines: 1 }
    ])
    const r = computeWeight(artifact, [], generated)
    expect(r.factors).toEqual({ "kind-base": 20, "changed-files": 2 })
  })

  it("E2E のレポートは行数・ファイル数・近接から外れる", () => {
    const config = configWith("code/protected-paths", {
      globs: ["docs/**"]
    })
    const artifact = codeArtifact([
      { path: "docs/codiel/tests/x/reports/r.md", lines: 3000 },
      { path: "src/a.ts", lines: 1 }
    ])
    const r = computeWeight(artifact, [], config)
    expect(r.factors).toEqual({ "kind-base": 20, "changed-files": 2 })
  })

  it("testsDir を渡すと、その配下の reports を外す", () => {
    const artifact = codeArtifact([{ path: "t/reports/r.md", lines: 3000 }])
    const r = computeWeight(artifact, [], makeConfig(), { testsDir: "t" })
    expect(r.factors).toEqual({ "kind-base": 20 })
  })

  it("testsDir の外の reports は外れない", () => {
    const artifact = codeArtifact([{ path: "src/reports/r.ts", lines: 3000 }])
    const r = computeWeight(artifact, [], makeConfig())
    expect(r.factors["diff-lines"]).toBe(40)
  })
})

describe("床(昇格のみ)", () => {
  const small = () => codeArtifact([{ path: "src/a.ts", lines: 1 }])

  it("ask 以上の所見があれば最低 standard にする", () => {
    const r = computeWeight(small(), [ask("common/max-size")], makeConfig())
    expect(r.tier).toBe("standard")
    expect(r.floors).toContain("rule-ask-floor:standard")
  })

  it("info の所見だけなら上げない", () => {
    const r = computeWeight(
      small(),
      [{ ruleId: "common/max-size", severity: "info", message: "m" }],
      makeConfig()
    )
    expect(r.tier).toBe("trivial")
    expect(r.floors).toEqual([])
  })

  it("code/protected-paths が ask 以上なら critical にする", () => {
    for (const severity of ["ask", "stop"] as const) {
      const r = computeWeight(
        small(),
        [{ ruleId: "code/protected-paths", severity, message: "m" }],
        makeConfig()
      )
      expect(r.tier).toBe("critical")
      expect(r.floors).toContain("rule-fire-floor:critical")
    }
  })

  it("plan/irreversible-ops が ask なら critical にする", () => {
    const r = computeWeight(
      makeArtifact({ kind: "plan", content: "小さな計画" }),
      [ask("plan/irreversible-ops")],
      makeConfig()
    )
    expect(r.tier).toBe("critical")
  })

  it("protected-paths と irreversible-ops が info なら critical にしない", () => {
    for (const ruleId of ["code/protected-paths", "plan/irreversible-ops"]) {
      const r = computeWeight(
        small(),
        [{ ruleId, severity: "info", message: "m" }],
        makeConfig()
      )
      expect(r.tier).toBe("trivial")
    }
  })

  it("すでにその tier 以上なら floors に記録しない", () => {
    const artifact = codeArtifact(
      Array.from({ length: 10 }, (_, i) => ({
        path: `src/f${i}.ts`,
        lines: 100
      }))
    )
    const r = computeWeight(artifact, [ask("common/max-size")], makeConfig())
    expect(r.tier).toBe("critical")
    expect(r.floors).toEqual([])
  })
})

describe("Jev の文脈判定の下限", () => {
  const small = () => codeArtifact([{ path: "src/a.ts", lines: 1 }])

  it("standard の下限で trivial を上げる", () => {
    const r = computeWeight(small(), [], makeConfig(), {
      contextFloor: "standard"
    })
    expect(r.tier).toBe("standard")
    expect(r.floors).toContain("context-judge-floor:standard")
  })

  it("critical の下限で standard を上げる", () => {
    const r = computeWeight(small(), [ask("common/max-size")], makeConfig(), {
      contextFloor: "critical"
    })
    expect(r.tier).toBe("critical")
  })

  it("下限が現在の tier より低くても下げない", () => {
    const r = computeWeight(
      small(),
      [{ ruleId: "code/protected-paths", severity: "stop", message: "m" }],
      makeConfig(),
      { contextFloor: "standard" }
    )
    expect(r.tier).toBe("critical")
    expect(r.floors).not.toContain("context-judge-floor:standard")
  })

  it("下限が無ければ tier は変わらない", () => {
    const r = computeWeight(small(), [], makeConfig())
    expect(r.tier).toBe("trivial")
  })
})
