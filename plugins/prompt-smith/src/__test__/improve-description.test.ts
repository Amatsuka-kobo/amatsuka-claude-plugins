import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { describe, expect, it, vi } from "vitest"
import {
  buildImprovePrompt,
  extractDescription,
  improveDescription,
  MissingDescriptionTagError
} from "../improve-description.js"
import {
  byteLength,
  MULTIBYTE_LENGTH_LIMITS,
  SINGLEBYTE_LENGTH_LIMITS
} from "../lib/defaults.js"

const evalResults = {
  results: [
    {
      query: "should have fired",
      should_trigger: true,
      trigger_rate: 0,
      triggers: 0,
      runs: 3,
      errors: 0,
      pass: false
    },
    {
      query: "should not have fired",
      should_trigger: false,
      trigger_rate: 1,
      triggers: 3,
      runs: 3,
      errors: 0,
      pass: false
    },
    {
      query: "fine",
      should_trigger: true,
      trigger_rate: 1,
      triggers: 3,
      runs: 3,
      errors: 0,
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
      budget: MULTIBYTE_LENGTH_LIMITS.ceiling,
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
      budget: MULTIBYTE_LENGTH_LIMITS.ceiling,
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

  it("UTF-8 バイト数の現行値・予算・目標を伝え、旧上限を使わない", () => {
    const currentDescription = "あ".repeat(10)
    const budget = 900
    const prompt = buildImprovePrompt({
      skillName: "s",
      skillContent: "body",
      currentDescription,
      budget,
      evalResults,
      history: [],
      testResults: null
    })
    expect(prompt).toContain(`${byteLength(currentDescription)} UTF-8 bytes`)
    expect(prompt).toMatch(new RegExp(`must not exceed ${budget} UTF-8 bytes`))
    expect(prompt).toContain(
      `target ${MULTIBYTE_LENGTH_LIMITS.target} UTF-8 bytes`
    )
    expect(prompt).toContain(
      "For English, bytes and characters are nearly the same; for Japanese, one character is about 3 bytes."
    )
    expect(prompt).toContain(
      "rewrite, merge, or remove existing sections rather than adding sections"
    )
    expect(prompt).not.toContain(["100-200", "words"].join(" "))
    expect(prompt).not.toContain(["1024", "characters"].join(" "))
    expect(prompt).toContain(
      "highest-scoring one at the end. \n\nPlease respond"
    )
  })

  it("1バイト文字の現行説明には単一バイト用の目標を本文へ書く", () => {
    const prompt = buildImprovePrompt({
      skillName: "s",
      skillContent: "body",
      currentDescription: "description",
      budget: SINGLEBYTE_LENGTH_LIMITS.ceiling,
      evalResults,
      history: [],
      testResults: null
    })
    expect(prompt).toContain(
      `target ${SINGLEBYTE_LENGTH_LIMITS.target} UTF-8 bytes`
    )
  })

  it("多バイト文字の現行説明には多バイト用の目標を本文へ書く", () => {
    const prompt = buildImprovePrompt({
      skillName: "s",
      skillContent: "body",
      currentDescription: "説明文です",
      budget: MULTIBYTE_LENGTH_LIMITS.ceiling,
      evalResults,
      history: [],
      testResults: null
    })
    expect(prompt).toContain(
      `target ${MULTIBYTE_LENGTH_LIMITS.target} UTF-8 bytes`
    )
  })

  it("短い説明の方が発火しやすいという案内を含める", () => {
    const budget = 900
    const prompt = buildImprovePrompt({
      skillName: "s",
      skillContent: "body",
      currentDescription: "current",
      budget,
      evalResults,
      history: [],
      testResults: null
    })
    expect(prompt).toContain("Shorter descriptions trigger more reliably.")
    expect(prompt).toContain(`Treat ${budget} as a ceiling to stay well below`)
  })

  it("過去の試行を積む", () => {
    const prompt = buildImprovePrompt({
      skillName: "s",
      skillContent: "body",
      currentDescription: "current",
      budget: MULTIBYTE_LENGTH_LIMITS.ceiling,
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
  it("予算ちょうどの案なら短縮を依頼しない", async () => {
    const withinBudget = "x".repeat(MULTIBYTE_LENGTH_LIMITS.ceiling)
    const callClaude = vi
      .fn()
      .mockResolvedValue(`<new_description>${withinBudget}</new_description>`)
    const out = await improveDescription({
      skillName: "s",
      skillContent: "body",
      currentDescription: "current",
      budget: MULTIBYTE_LENGTH_LIMITS.ceiling,
      evalResults,
      history: [],
      testResults: null,
      model: "claude-opus-5",
      callClaude
    })
    expect(out).toBe(withinBudget)
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
      budget: MULTIBYTE_LENGTH_LIMITS.ceiling,
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
        budget: MULTIBYTE_LENGTH_LIMITS.ceiling,
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
      budget: MULTIBYTE_LENGTH_LIMITS.ceiling,
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

  it("最初の Claude 呼び出しが失敗しても transcript を残して例外を再送出する", async () => {
    const logDir = await mkdtemp(join(tmpdir(), "prompt-smith-test-"))
    const failure = new Error("Claude timed out")
    const callClaude = vi.fn().mockRejectedValue(failure)

    try {
      await expect(
        improveDescription({
          skillName: "s",
          skillContent: "body",
          currentDescription: "current",
          budget: MULTIBYTE_LENGTH_LIMITS.ceiling,
          evalResults,
          history: [],
          testResults: null,
          model: "claude-opus-5",
          callClaude,
          logDir,
          iteration: 1
        })
      ).rejects.toBe(failure)

      const transcript = JSON.parse(
        await readFile(join(logDir, "improve_iter_1.json"), "utf8")
      ) as Record<string, unknown>
      expect(transcript.prompt).toContain("<current_description>")
      expect(transcript.failure_stage).toBe("initial_request")
      expect(transcript.failure_message).toBe("Claude timed out")
    } finally {
      await rm(logDir, { recursive: true, force: true })
    }
  })

  it("Error 以外の値が投げられても transcript を残して再送出する", async () => {
    const logDir = await mkdtemp(join(tmpdir(), "prompt-smith-test-"))
    const failure = Object.create(null)
    const callClaude = vi.fn().mockRejectedValue(failure)

    try {
      await expect(
        improveDescription({
          skillName: "s",
          skillContent: "body",
          currentDescription: "current",
          budget: MULTIBYTE_LENGTH_LIMITS.ceiling,
          evalResults,
          history: [],
          testResults: null,
          model: "claude-opus-5",
          callClaude,
          logDir,
          iteration: 2
        })
      ).rejects.toBe(failure)

      const transcript = JSON.parse(
        await readFile(join(logDir, "improve_iter_2.json"), "utf8")
      ) as Record<string, unknown>
      expect(transcript.failure_message).toBe("Unknown non-Error thrown value")
    } finally {
      await rm(logDir, { recursive: true, force: true })
    }
  })

  it("transcript を書けなくても本来の失敗理由を送出する", async () => {
    // logDir にファイルを渡すと mkdir が失敗する。書き込みエラーで
    // 本来の理由がすり替わらないことを確かめる。
    const dir = await mkdtemp(join(tmpdir(), "prompt-smith-test-"))
    const logDir = join(dir, "not-a-directory")
    await writeFile(logDir, "", "utf8")
    const failure = new Error("Claude timed out")
    const callClaude = vi.fn().mockRejectedValue(failure)

    try {
      await expect(
        improveDescription({
          skillName: "s",
          skillContent: "body",
          currentDescription: "current",
          budget: MULTIBYTE_LENGTH_LIMITS.ceiling,
          evalResults,
          history: [],
          testResults: null,
          model: "claude-opus-5",
          callClaude,
          logDir,
          iteration: 1
        })
      ).rejects.toBe(failure)
    } finally {
      await rm(dir, { recursive: true, force: true })
    }
  })

  it("短縮時の Claude 呼び出しが失敗しても transcript を残して例外を再送出する", async () => {
    const logDir = await mkdtemp(join(tmpdir(), "prompt-smith-test-"))
    const tooLong = "x".repeat(MULTIBYTE_LENGTH_LIMITS.ceiling + 1)
    const failure = new Error("Claude CLI failed")
    const callClaude = vi
      .fn()
      .mockResolvedValueOnce(`<new_description>${tooLong}</new_description>`)
      .mockRejectedValueOnce(failure)

    try {
      await expect(
        improveDescription({
          skillName: "s",
          skillContent: "body",
          currentDescription: "current",
          budget: MULTIBYTE_LENGTH_LIMITS.ceiling,
          evalResults,
          history: [],
          testResults: null,
          model: "claude-opus-5",
          callClaude,
          logDir,
          iteration: 2
        })
      ).rejects.toBe(failure)

      const transcript = JSON.parse(
        await readFile(join(logDir, "improve_iter_2.json"), "utf8")
      ) as Record<string, unknown>
      expect(transcript.prompt).toContain("<current_description>")
      expect(transcript.rewrite_prompt).toContain(
        `over the ${MULTIBYTE_LENGTH_LIMITS.ceiling}-byte budget`
      )
      expect(transcript.failure_stage).toBe("rewrite_request")
      expect(transcript.failure_message).toBe("Claude CLI failed")
    } finally {
      await rm(logDir, { recursive: true, force: true })
    }
  })

  it("予算を 1 バイト超えたら 1 回だけ再依頼する", async () => {
    const tooLong = "x".repeat(MULTIBYTE_LENGTH_LIMITS.ceiling + 1)
    const callClaude = vi
      .fn()
      .mockResolvedValueOnce(`<new_description>${tooLong}</new_description>`)
      .mockResolvedValueOnce("<new_description>shortened</new_description>")
    const out = await improveDescription({
      skillName: "s",
      skillContent: "body",
      currentDescription: "current",
      budget: MULTIBYTE_LENGTH_LIMITS.ceiling,
      evalResults,
      history: [],
      testResults: null,
      model: "claude-opus-5",
      callClaude
    })
    expect(out).toBe("shortened")
    expect(callClaude).toHaveBeenCalledTimes(2)
    expect(callClaude.mock.calls[1]?.[0]).toContain(
      `over the ${MULTIBYTE_LENGTH_LIMITS.ceiling}-byte budget`
    )
  })

  it("短縮応答にタグが無ければ 1 回だけ再依頼する", async () => {
    const tooLong = "x".repeat(MULTIBYTE_LENGTH_LIMITS.ceiling + 1)
    const callClaude = vi
      .fn()
      .mockResolvedValueOnce(`<new_description>${tooLong}</new_description>`)
      .mockResolvedValueOnce("shorten response without a tag")
      .mockResolvedValueOnce("<new_description>shortened</new_description>")
    const out = await improveDescription({
      skillName: "s",
      skillContent: "body",
      currentDescription: "current",
      budget: MULTIBYTE_LENGTH_LIMITS.ceiling,
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
    const tooLong = "x".repeat(MULTIBYTE_LENGTH_LIMITS.ceiling + 1)
    const callClaude = vi
      .fn()
      .mockResolvedValue(`<new_description>${tooLong}</new_description>`)
    const out = await improveDescription({
      skillName: "s",
      skillContent: "body",
      currentDescription: "current",
      budget: MULTIBYTE_LENGTH_LIMITS.ceiling,
      evalResults,
      history: [],
      testResults: null,
      model: "claude-opus-5",
      callClaude
    })
    expect(byteLength(out)).toBe(MULTIBYTE_LENGTH_LIMITS.ceiling + 1)
    expect(callClaude).toHaveBeenCalledTimes(2)
  })
})
