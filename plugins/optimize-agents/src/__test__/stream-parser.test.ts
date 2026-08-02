import { describe, expect, test } from "vitest"
import { detectFirstToolUse, isResultEvent } from "../lib/stream-parser.js"

function streamEvent(
  eventType: string,
  contentBlock?: Record<string, unknown>,
  type = "stream_event"
): string {
  return JSON.stringify({
    type,
    event: {
      type: eventType,
      ...(contentBlock === undefined ? {} : { content_block: contentBlock })
    }
  })
}

describe("detectFirstToolUse", () => {
  test("content_block_start の Skill ツールを skill と判定する", () => {
    expect(
      detectFirstToolUse(
        streamEvent("content_block_start", { type: "tool_use", name: "Skill" })
      )
    ).toBe("skill")
  })

  test("content_block_start の Skill 以外のツールを other と判定する", () => {
    expect(
      detectFirstToolUse(
        streamEvent("content_block_start", { type: "tool_use", name: "Read" })
      )
    ).toBe("other")
  })

  test("content_block_start の text は null", () => {
    expect(
      detectFirstToolUse(streamEvent("content_block_start", { type: "text" }))
    ).toBe(null)
  })

  test("content_block_delta は null", () => {
    expect(
      detectFirstToolUse(
        streamEvent("content_block_delta", { type: "tool_use", name: "Skill" })
      )
    ).toBe(null)
  })

  test("message_start は null", () => {
    expect(detectFirstToolUse(streamEvent("message_start"))).toBe(null)
  })

  test("不正な JSON は例外を投げず null", () => {
    expect(() => detectFirstToolUse("not json")).not.toThrow()
    expect(detectFirstToolUse("not json")).toBe(null)
  })

  test("空行は null", () => {
    expect(detectFirstToolUse("")).toBe(null)
  })

  test("content_block 欠落は null", () => {
    expect(
      detectFirstToolUse(
        '{"type":"stream_event","event":{"type":"content_block_start"}}'
      )
    ).toBe(null)
  })

  test("tool_use の name 欠落は other", () => {
    expect(
      detectFirstToolUse(
        streamEvent("content_block_start", { type: "tool_use" })
      )
    ).toBe("other")
  })

  test("外側の type が stream_event 以外なら null", () => {
    expect(
      detectFirstToolUse(
        streamEvent(
          "content_block_start",
          { type: "tool_use", name: "Skill" },
          "assistant"
        )
      )
    ).toBe(null)
  })
})

describe("isResultEvent", () => {
  test("result イベントは true", () => {
    expect(isResultEvent('{"type":"result","result":"done"}')).toBe(true)
  })

  test("result 以外は false", () => {
    expect(isResultEvent('{"type":"assistant"}')).toBe(false)
  })

  test("不正な JSON は false", () => {
    expect(isResultEvent("not json")).toBe(false)
  })
})
