import { describe, expect, it } from "vitest"
import type { Finding } from "../../../core/types.js"
import {
  FakeJudgeProvider,
  makeCtl
} from "../../__test__/helpers/fakeProvider.js"
import { makeArtifact } from "../../__test__/helpers/fixtures.js"
import { SCORE_SCALE } from "../../prompts.js"
import { runSteelman, type SteelmanTarget } from "../steelman.js"

const scores = {
  objective_alignment: 75,
  no_unintended_changes: 70,
  no_breaking_changes: 65
}

function finding(panelist: string, message: string): Finding {
  return {
    ruleId: `panel/${panelist}`,
    severity: "ask",
    confidence: 80,
    message
  }
}

const targets: SteelmanTarget[] = [
  {
    panelist: "adversarial",
    findingIndex: 0,
    finding: finding("adversarial", "認証トークンの検証漏れ")
  },
  {
    panelist: "crosscheck",
    findingIndex: 0,
    finding: finding("crosscheck", "計画の移行手順が未実施")
  },
  {
    panelist: "crosscheck",
    findingIndex: 1,
    finding: finding("crosscheck", "計画に無いファイルの変更")
  }
]

describe("runSteelman", () => {
  it("通し番号の反駁を、元のパネリストとその中の添字に戻す", async () => {
    const provider = new FakeJudgeProvider()
    provider.set("steelman", {
      verdicts: [
        {
          findingIndex: 0,
          rebuttal: "既存の検証で足りる",
          outcome: "rebutted"
        },
        { findingIndex: 2, rebuttal: "反論できない", outcome: "conceded" },
        { findingIndex: 1, rebuttal: "手順は別の PR", outcome: "rebutted" }
      ],
      defenseArgument: "最小限の追加である",
      findings: [],
      scores
    })

    const outcome = await runSteelman(
      { artifact: makeArtifact(), targets },
      provider,
      "haiku",
      makeCtl()
    )

    expect(outcome.report.panelist).toBe("steelman")
    expect(outcome.verdicts).toEqual([
      {
        panelist: "adversarial",
        findingIndex: 0,
        outcome: "rebutted",
        rebuttal: "既存の検証で足りる"
      },
      {
        panelist: "crosscheck",
        findingIndex: 1,
        outcome: "conceded",
        rebuttal: "反論できない"
      },
      {
        panelist: "crosscheck",
        findingIndex: 0,
        outcome: "rebutted",
        rebuttal: "手順は別の PR"
      }
    ])
  })

  it("範囲外の番号の反駁は捨てる", async () => {
    const provider = new FakeJudgeProvider()
    provider.set("steelman", {
      verdicts: [{ findingIndex: 9, rebuttal: "x", outcome: "rebutted" }],
      defenseArgument: "x",
      findings: [],
      scores
    })

    const outcome = await runSteelman(
      { artifact: makeArtifact(), targets },
      provider,
      "haiku",
      makeCtl()
    )
    expect(outcome.verdicts).toEqual([])
  })

  it("プロンプトに通し番号とパネリスト名の付いた所見と、スコアの向きを載せる", async () => {
    const provider = new FakeJudgeProvider()
    provider.set("steelman", {
      verdicts: [],
      defenseArgument: "擁護論",
      findings: [],
      scores
    })

    await runSteelman(
      { artifact: makeArtifact(), targets },
      provider,
      "haiku",
      makeCtl()
    )

    const prompt = provider.calls[0].prompt
    expect(prompt).toContain("[0] adversarial")
    expect(prompt).toContain("[2] crosscheck")
    expect(prompt).toContain("計画に無いファイルの変更")
    expect(prompt).toContain("conceded")
    expect(prompt).toContain(SCORE_SCALE)
  })
})
