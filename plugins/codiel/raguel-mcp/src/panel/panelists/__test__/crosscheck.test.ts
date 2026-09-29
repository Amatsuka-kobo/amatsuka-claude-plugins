import { describe, expect, it } from "vitest"
import type { DiffFile } from "../../../core/types.js"
import {
  FakeJudgeProvider,
  makeCtl
} from "../../__test__/helpers/fakeProvider.js"
import { makeArtifact } from "../../__test__/helpers/fixtures.js"
import { SCORE_SCALE } from "../../prompts.js"
import {
  factRowsFromDiff,
  formatFactTable,
  runCrosscheck
} from "../crosscheck.js"

const scores = {
  objective_alignment: 80,
  no_unintended_changes: 80,
  no_breaking_changes: 80
}

function diffFile(overrides: Partial<DiffFile>): DiffFile {
  return {
    path: "src/a.ts",
    additions: [],
    deletions: [],
    isNew: false,
    isDeleted: false,
    isRename: false,
    isBinary: false,
    ...overrides
  }
}

describe("事実表(所見 A13)", () => {
  it("新規ファイルは「新規」と書き、「不在」と書かない", () => {
    const table = formatFactTable(
      factRowsFromDiff([
        diffFile({ path: "src/new.ts", isNew: true }),
        diffFile({ path: "src/old.ts", isDeleted: true }),
        diffFile({ path: "src/b.ts", oldPath: "src/a.ts", isRename: true }),
        diffFile({ path: "src/c.ts" })
      ])
    )
    expect(table.split("\n")).toEqual([
      "src/new.ts: 新規",
      "src/old.ts: 削除",
      "src/b.ts: 改名(旧: src/a.ts)",
      "src/c.ts: 変更"
    ])
    expect(table).not.toContain("不在")
  })

  it("パスは diff の解析結果のまま(a/・b/ の接頭辞を足さない)", () => {
    const rows = factRowsFromDiff([diffFile({ path: "src/x.ts" })])
    expect(rows).toEqual([{ path: "src/x.ts", state: "modified" }])
  })

  it("空なら参照パスなしと書く", () => {
    expect(formatFactTable([])).toBe("(参照パスなし)")
  })
})

describe("runCrosscheck", () => {
  it("事実表と前フェーズの証拠が無くても実行できる", async () => {
    const provider = new FakeJudgeProvider()
    provider.set("crosscheck", { findings: [], scores })

    const report = await runCrosscheck(
      { artifact: makeArtifact() },
      provider,
      "haiku",
      makeCtl()
    )

    expect(report.panelist).toBe("crosscheck")
    const prompt = provider.calls[0].prompt
    expect(prompt).toContain("初回フェーズ")
    expect(prompt).toContain("事実表なし")
    expect(prompt).toContain(SCORE_SCALE)
  })

  it("事実表と前フェーズの証拠をプロンプトに載せ、新規は不在でないと書く", async () => {
    const provider = new FakeJudgeProvider()
    provider.set("crosscheck", {
      findings: [
        { severity: "ask", confidence: 90, message: "移行手順が未実施" }
      ],
      scores
    })

    const report = await runCrosscheck(
      {
        artifact: makeArtifact(),
        priorEvidence: "前フェーズでは移行手順を計画済み",
        facts: [{ path: "src/login.ts", state: "new" }]
      },
      provider,
      "haiku",
      makeCtl()
    )

    expect(report.findings[0].ruleId).toBe("panel/crosscheck")
    const prompt = provider.calls[0].prompt
    expect(prompt).toContain("未達")
    expect(prompt).toContain("逸脱")
    expect(prompt).toContain("前フェーズでは移行手順を計画済み")
    expect(prompt).toContain("src/login.ts: 新規")
    expect(prompt).toContain(
      "「新規」はこの変更で作られるファイルで、不在ではない"
    )
  })
})
