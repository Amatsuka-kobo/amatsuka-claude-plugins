import { describe, expect, it, vi } from "vitest"
import {
  buildImprovePrompt,
  extractDescription,
  improveDescription,
  MissingDescriptionTagError
} from "../improve-description.js"

const evalResults = {
  results: [
    {
      query: "should have fired",
      should_trigger: true,
      trigger_rate: 0,
      triggers: 0,
      runs: 3,
      pass: false
    },
    {
      query: "should not have fired",
      should_trigger: false,
      trigger_rate: 1,
      triggers: 3,
      runs: 3,
      pass: false
    },
    {
      query: "fine",
      should_trigger: true,
      trigger_rate: 1,
      triggers: 3,
      runs: 3,
      pass: true
    }
  ],
  summary: { total: 3, passed: 1, failed: 2 }
}

describe("buildImprovePrompt", () => {
  it("発火漏れと誤発火を分けて書く", () => {
    const prompt = buildImprovePrompt({
      skillName: "s",
      skillContent: "body",
      currentDescription: "current",
      evalResults,
      history: [],
      testResults: null
    })
    expect(prompt).toContain("FAILED TO TRIGGER")
    expect(prompt).toContain("should have fired")
    expect(prompt).toContain("FALSE TRIGGERS")
    expect(prompt).toContain("should not have fired")
  })

  it("合格した問は失敗欄に入れない", () => {
    const prompt = buildImprovePrompt({
      skillName: "s",
      skillContent: "body",
      currentDescription: "current",
      evalResults,
      history: [],
      testResults: null
    })
    const failureSection = prompt.slice(
      prompt.indexOf("FAILED TO TRIGGER"),
      prompt.indexOf("</scores_summary>")
    )
    expect(failureSection).not.toContain('"fine"')
  })

  it("1024 文字の上限を伝える", () => {
    const prompt = buildImprovePrompt({
      skillName: "s",
      skillContent: "body",
      currentDescription: "current",
      evalResults,
      history: [],
      testResults: null
    })
    expect(prompt).toContain("1024 characters")
    expect(prompt).toContain("100-200 words")
  })

  it("過去の試行を積む", () => {
    const prompt = buildImprovePrompt({
      skillName: "s",
      skillContent: "body",
      currentDescription: "current",
      history: [
        {
          description: "older one",
          train_passed: 1,
          train_total: 3,
          results: []
        }
      ],
      evalResults,
      testResults: null
    })
    expect(prompt).toContain("PREVIOUS ATTEMPTS")
    expect(prompt).toContain("older one")
  })
})

describe("extractDescription", () => {
  it("タグの中身を取り出す", () => {
    expect(
      extractDescription(
        "junk <new_description>the text</new_description> junk"
      )
    ).toBe("the text")
  })

  it("改行を含むタグも取り出す", () => {
    expect(
      extractDescription(
        "<new_description>\nline one\nline two\n</new_description>"
      )
    ).toBe("line one\nline two")
  })

  it("タグが無ければ null を返す", () => {
    expect(extractDescription("  plain text  ")).toBeNull()
  })

  it("引用符を剥がす", () => {
    expect(
      extractDescription('<new_description>"quoted"</new_description>')
    ).toBe("quoted")
  })
})

describe("improveDescription", () => {
  it("1024 文字以内ならそのまま返す", async () => {
    const callClaude = vi
      .fn()
      .mockResolvedValue("<new_description>short</new_description>")
    const out = await improveDescription({
      skillName: "s",
      skillContent: "body",
      currentDescription: "current",
      evalResults,
      history: [],
      testResults: null,
      model: "claude-opus-5",
      callClaude
    })
    expect(out).toBe("short")
    expect(callClaude).toHaveBeenCalledTimes(1)
  })

  it("タグ無しの応答には 1 回だけ再依頼する", async () => {
    const callClaude = vi
      .fn()
      .mockResolvedValueOnce("response without a tag")
      .mockResolvedValueOnce("<new_description>retried</new_description>")
    const out = await improveDescription({
      skillName: "s",
      skillContent: "body",
      currentDescription: "current",
      evalResults,
      history: [],
      testResults: null,
      model: "claude-opus-5",
      callClaude
    })
    expect(out).toBe("retried")
    expect(callClaude).toHaveBeenCalledTimes(2)
    expect(callClaude.mock.calls[1]?.[0]).toContain(
      "The previous response did not include <new_description> tags."
    )
  })

  it("タグ無しの応答が 2 回続いたら MissingDescriptionTagError を送出する", async () => {
    const callClaude = vi
      .fn()
      .mockResolvedValueOnce("first response without a tag")
      .mockResolvedValueOnce("second response without a tag")
    await expect(
      improveDescription({
        skillName: "s",
        skillContent: "body",
        currentDescription: "current",
        evalResults,
        history: [],
        testResults: null,
        model: "claude-opus-5",
        callClaude
      })
    ).rejects.toBeInstanceOf(MissingDescriptionTagError)
    expect(callClaude).toHaveBeenCalledTimes(2)
  })

  it("タグ再依頼にも timeoutSeconds を渡す", async () => {
    const callClaude = vi
      .fn()
      .mockResolvedValueOnce("response without a tag")
      .mockResolvedValueOnce("<new_description>retried</new_description>")
    await improveDescription({
      skillName: "s",
      skillContent: "body",
      currentDescription: "current",
      evalResults,
      history: [],
      testResults: null,
      model: "claude-opus-5",
      timeoutSeconds: 480,
      callClaude
    })
    expect(callClaude).toHaveBeenCalledTimes(2)
    expect(callClaude.mock.calls[0]?.[2]).toBe(480)
    expect(callClaude.mock.calls[1]?.[2]).toBe(480)
  })

  it("1024 文字を超えたら 1 回だけ再依頼する", async () => {
    const tooLong = "x".repeat(1100)
    const callClaude = vi
      .fn()
      .mockResolvedValueOnce(`<new_description>${tooLong}</new_description>`)
      .mockResolvedValueOnce("<new_description>shortened</new_description>")
    const out = await improveDescription({
      skillName: "s",
      skillContent: "body",
      currentDescription: "current",
      evalResults,
      history: [],
      testResults: null,
      model: "claude-opus-5",
      callClaude
    })
    expect(out).toBe("shortened")
    expect(callClaude).toHaveBeenCalledTimes(2)
    expect(callClaude.mock.calls[1]?.[0]).toContain(
      "over the 1024-character hard limit"
    )
  })

  it("短縮応答にタグが無ければ 1 回だけ再依頼する", async () => {
    const tooLong = "x".repeat(1100)
    const callClaude = vi
      .fn()
      .mockResolvedValueOnce(`<new_description>${tooLong}</new_description>`)
      .mockResolvedValueOnce("shorten response without a tag")
      .mockResolvedValueOnce("<new_description>shortened</new_description>")
    const out = await improveDescription({
      skillName: "s",
      skillContent: "body",
      currentDescription: "current",
      evalResults,
      history: [],
      testResults: null,
      model: "claude-opus-5",
      callClaude
    })
    expect(out).toBe("shortened")
    expect(callClaude).toHaveBeenCalledTimes(3)
    expect(callClaude.mock.calls[2]?.[0]).toContain(
      "The previous response did not include <new_description> tags."
    )
  })

  it("再依頼の結果がなお長くてもそのまま返す", async () => {
    const tooLong = "x".repeat(1100)
    const callClaude = vi
      .fn()
      .mockResolvedValue(`<new_description>${tooLong}</new_description>`)
    const out = await improveDescription({
      skillName: "s",
      skillContent: "body",
      currentDescription: "current",
      evalResults,
      history: [],
      testResults: null,
      model: "claude-opus-5",
      callClaude
    })
    expect(out).toHaveLength(1100)
    expect(callClaude).toHaveBeenCalledTimes(2)
  })
})
