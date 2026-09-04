import { fileURLToPath } from "node:url"
import { describe, expect, it } from "vitest"
import { runTs } from "../../testing/run-ts.js"

const HOOK = fileURLToPath(new URL("../parallel-nudge.ts", import.meta.url))
const PARALLEL_NUDGE =
  "並列 dispatch の確認: まだ着手していない独立タスクが残っているなら、後続のメッセージではなく、この dispatch と同じメッセージ内で並列に dispatch する。逐次にするのは前の出力に依存するときだけである。"

function environment(value?: string): NodeJS.ProcessEnv {
  const env = { ...process.env }
  delete env.AMATSUKA_AGENT_PARALLEL_NUDGE
  if (value !== undefined) env.AMATSUKA_AGENT_PARALLEL_NUDGE = value
  return env
}

function invoke(value?: string): string {
  return runTs(HOOK, [], { env: environment(value) })
}

describe("parallel-nudge hook", () => {
  it("未設定なら PreToolUse の文言を 1 行の JSON で出力する", () => {
    const output = invoke()
    expect(output.endsWith("\n")).toBe(true)
    const lines = output.trimEnd().split("\n")
    expect(lines).toHaveLength(1)

    expect(JSON.parse(lines[0])).toEqual({
      hookSpecificOutput: {
        hookEventName: "PreToolUse",
        additionalContext: PARALLEL_NUDGE
      }
    })
  })

  it.each([
    "0",
    "false",
    "off"
  ])("無効化値 %s では標準出力を空にする", (value) => {
    expect(invoke(value)).toBe("")
  })

  it.each([
    "OFF",
    " off "
  ])("大文字と空白を正規化して %s も無効にする", (value) => {
    expect(invoke(value)).toBe("")
  })

  it.each([
    "1",
    "true",
    "yes",
    ""
  ])("無効化値以外の %s では文言を出力する", (value) => {
    expect(invoke(value)).not.toBe("")
  })
})
