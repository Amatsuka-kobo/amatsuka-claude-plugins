import { describe, expect, it } from "vitest"
import { FakeJudgeProvider } from "../testing/fakeProvider.js"
import { runMetaPanelist } from "./meta.js"

describe("runMetaPanelist", () => {
  it("MetaReport(scores + rationale)を返し、findings は持たない", async () => {
    const provider = new FakeJudgeProvider()
    provider.set("meta", {
      scores: {
        objective_alignment: 80,
        unintended_changes: 75,
        breaking_changes: 70,
        blast_radius: 60
      },
      rationale: "小規模な追加でリスクは限定的"
    })

    const meta = await runMetaPanelist(
      "01-rules.json: ...\n02-adversarial.md: ...",
      "code",
      provider,
      "sonnet",
      5000
    )

    expect(meta.model).toBe("sonnet")
    expect(meta.scores.blast_radius).toBe(60)
    expect(meta.rationale).toContain("小規模")
    expect((meta as { findings?: unknown }).findings).toBeUndefined()
  })

  it("成果物原文は含めず、証拠バンドルのみをフレーミングして渡す", async () => {
    const provider = new FakeJudgeProvider()
    provider.set("meta", {
      scores: {
        objective_alignment: 80,
        unintended_changes: 75,
        breaking_changes: 70,
        blast_radius: 60
      },
      rationale: "x"
    })

    await runMetaPanelist("証拠バンドル本文", "code", provider, "sonnet", 5000)

    const prompt = provider.calls[0].prompt
    expect(prompt).toContain("証拠バンドル本文")
    expect(prompt).toContain("<<<UNTRUSTED:case-evidence:")
    expect(prompt).toContain("成果物そのものを見ていない")
  })
})
