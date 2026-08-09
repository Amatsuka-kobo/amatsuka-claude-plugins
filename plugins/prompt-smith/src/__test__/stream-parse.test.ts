import { describe, expect, it } from "vitest"
import { judge, TriggerDetector } from "../lib/stream-parse.js"

const streamEvent = (event: unknown) =>
  JSON.stringify({ type: "stream_event", event })

const blockStart = (toolName: string) =>
  streamEvent({
    type: "content_block_start",
    content_block: { type: "tool_use", name: toolName }
  })

const delta = (partial: string) =>
  streamEvent({
    type: "content_block_delta",
    delta: { type: "input_json_delta", partial_json: partial }
  })

const blockStop = () => streamEvent({ type: "content_block_stop" })
const messageStop = () => streamEvent({ type: "message_stop" })

describe("TriggerDetector", () => {
  it("関係のない行では確定しない", () => {
    const d = new TriggerDetector("my-skill-skill-")
    expect(d.push(streamEvent({ type: "message_start" }))).toBeNull()
    expect(d.push("")).toBeNull()
    expect(d.push("not json")).toBeNull()
  })

  it("Skill 以外のツールが最初に来たら発火せずで確定する", () => {
    const d = new TriggerDetector("my-skill-skill-")
    expect(d.push(blockStart("Bash"))).toBe(false)
  })

  it("Skill の入力に接頭辞が現れたら発火で確定する", () => {
    const d = new TriggerDetector("my-skill-skill-")
    expect(d.push(blockStart("Skill"))).toBeNull()
    expect(d.push(delta('{"skill": "my-skill-'))).toBeNull()
    expect(d.push(delta('skill-ab12cd34"}'))).toBe(true)
  })

  it("接頭辞は前方一致で判定し、hash は問わない", () => {
    const d = new TriggerDetector("my-skill-skill-")
    d.push(blockStart("Skill"))
    expect(d.push(delta('{"skill": "my-skill-skill-ffffffff"}'))).toBe(true)
  })

  it("別スキルを呼んだら content_block_stop で発火せずに確定する", () => {
    const d = new TriggerDetector("my-skill-skill-")
    d.push(blockStart("Skill"))
    d.push(delta('{"skill": "other-skill"}'))
    expect(d.push(blockStop())).toBe(false)
  })

  it("Skill が来ないまま message_stop なら発火せず", () => {
    const d = new TriggerDetector("my-skill-skill-")
    expect(d.push(messageStop())).toBe(false)
  })

  it("assistant メッセージのフォールバックで Skill を見る", () => {
    const d = new TriggerDetector("my-skill-skill-")
    const line = JSON.stringify({
      type: "assistant",
      message: {
        content: [
          {
            type: "tool_use",
            name: "Skill",
            input: { skill: "my-skill-skill-0011" }
          }
        ]
      }
    })
    expect(d.push(line)).toBe(true)
  })

  it("フォールバックで Read は発火とみなさない", () => {
    const d = new TriggerDetector("my-skill-skill-")
    const line = JSON.stringify({
      type: "assistant",
      message: {
        content: [
          {
            type: "tool_use",
            name: "Read",
            input: { file_path: "/x/my-skill-skill-0011/SKILL.md" }
          }
        ]
      }
    })
    expect(d.push(line)).toBe(false)
  })

  it("result で確定する", () => {
    const d = new TriggerDetector("my-skill-skill-")
    expect(d.push(JSON.stringify({ type: "result" }))).toBe(false)
  })
})

describe("judge", () => {
  it.each([
    [1.0, true, 0.5, true],
    [0.5, true, 0.5, true],
    [0.34, true, 0.5, false],
    [0.0, false, 0.5, true],
    [0.34, false, 0.5, true],
    [0.5, false, 0.5, false],
    [1.0, false, 0.5, false]
  ])("rate=%s should=%s threshold=%s -> %s", (rate, should, threshold, expected) => {
    expect(judge(rate, should, threshold)).toBe(expected)
  })
})
