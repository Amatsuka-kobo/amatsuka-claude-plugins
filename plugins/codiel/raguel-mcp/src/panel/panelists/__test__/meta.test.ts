import { describe, expect, it } from "vitest"
import type { Precedent } from "../../../core/types.js"
import {
  FakeJudgeProvider,
  makeCtl
} from "../../__test__/helpers/fakeProvider.js"
import { PRECEDENTS_HEADING, SCORE_SCALE } from "../../prompts.js"
import { runMetaPanelist } from "../meta.js"

const scores = {
  objective_alignment: 80,
  no_unintended_changes: 75,
  no_breaking_changes: 70,
  blast_radius_contained: 60
}

const seed: Precedent = {
  id: "seed-001",
  source: "seed",
  kind: "code",
  outcome: "rejected",
  summary: "保護パスの書き換え",
  firedRules: [],
  changedPaths: [],
  lesson: "保護パスは人が確かめる"
}

describe("runMetaPanelist", () => {
  it("MetaReport(scores と rationale)を返し、blast_radius_contained の軸を持つ", async () => {
    const provider = new FakeJudgeProvider()
    provider.set("meta", { scores, rationale: "小規模な追加でリスクは限定的" })

    const meta = await runMetaPanelist(
      { evidenceBundle: "証拠", kind: "code", precedents: [] },
      provider,
      "sonnet",
      makeCtl()
    )

    expect(meta.model).toBe("sonnet")
    expect(meta.scores.blast_radius_contained).toBe(60)
    expect(meta.rationale).toContain("小規模")
    expect((meta as { findings?: unknown }).findings).toBeUndefined()
  })

  it("証拠の束を囲んで渡し、スコアの向きと判例の参考入力を載せる", async () => {
    const provider = new FakeJudgeProvider()
    provider.set("meta", { scores, rationale: "x" })

    await runMetaPanelist(
      { evidenceBundle: "証拠バンドル本文", kind: "code", precedents: [seed] },
      provider,
      "sonnet",
      makeCtl()
    )

    const prompt = provider.calls[0].prompt
    expect(prompt).toContain("証拠バンドル本文")
    expect(prompt).toContain("<<<UNTRUSTED:case-evidence:")
    expect(prompt).toContain("成果物そのものを見ていない")
    expect(prompt).toContain(SCORE_SCALE)
    expect(prompt).toContain(PRECEDENTS_HEADING)
    expect(prompt).toContain("日付: 記録なし")
    expect(prompt).toContain("ruling: なし")
    expect(prompt).toContain("保護パスは人が確かめる")
  })
})
