import fs from "node:fs"
import os from "node:os"
import path from "node:path"
import { expect, test } from "vitest"
import {
  hasSkillFileRead,
  hasSkillInvocation,
  lastAssistantModel,
  subagentTranscriptPath
} from "../lib.js"

type TranscriptLine = string | Record<string, unknown>

function writeTranscript(lines: TranscriptLine[]): string {
  const p = path.join(
    fs.mkdtempSync(path.join(os.tmpdir(), "rev-lib-")),
    "t.jsonl"
  )
  fs.writeFileSync(
    p,
    `${lines
      .map((l) => (typeof l === "string" ? l : JSON.stringify(l)))
      .join("\n")}\n`
  )
  return p
}

const skillUse = (skill: string): Record<string, unknown> => ({
  type: "assistant",
  message: { content: [{ type: "tool_use", name: "Skill", input: { skill } }] }
})

const assistantWithModel = (model: string): Record<string, unknown> => ({
  type: "assistant",
  message: { model, content: [{ type: "text", text: "hi" }] }
})

test("Skill tool_use があれば true", () => {
  const p = writeTranscript([skillUse("revelation:fable-restraint")])
  expect(hasSkillInvocation(p, "revelation:fable-restraint")).toBe(true)
})

test("別スキルの invoke では false", () => {
  const p = writeTranscript([skillUse("superpowers:brainstorming")])
  expect(hasSkillInvocation(p, "revelation:fable-restraint")).toBe(false)
})

test("テキスト中にスキル名が現れるだけでは false(注入トリガー表への誤検知防止)", () => {
  const p = writeTranscript([
    {
      type: "user",
      message: {
        content: [
          {
            type: "text",
            text: 'Skill ツールで revelation:fable-restraint を invoke せよ ("name":"Skill")'
          }
        ]
      }
    }
  ])
  expect(hasSkillInvocation(p, "revelation:fable-restraint")).toBe(false)
})

test("壊れた JSON 行はスキップして残りを読む", () => {
  const p = writeTranscript([
    '{"Skill" broken json',
    JSON.stringify(skillUse("revelation:fable-restraint"))
  ])
  expect(hasSkillInvocation(p, "revelation:fable-restraint")).toBe(true)
})

test("transcript が存在しなければ throw(フェイルオープン判断は呼び出し側)", () => {
  expect(() =>
    hasSkillInvocation("/nonexistent/t.jsonl", "revelation:fable-restraint")
  ).toThrow()
})

test("lastAssistantModel: assistant イベントの model を返す(複数あれば最後のもの)", () => {
  const p = writeTranscript([
    assistantWithModel("claude-opus-4-8"),
    assistantWithModel("claude-fable-5")
  ])
  expect(lastAssistantModel(p)).toBe("claude-fable-5")
})

test("lastAssistantModel: assistant イベントが無ければ null", () => {
  const p = writeTranscript([
    { type: "user", message: { content: [{ type: "text", text: "hello" }] } }
  ])
  expect(lastAssistantModel(p)).toBeNull()
})

test("lastAssistantModel: 壊れた JSON 行はスキップする", () => {
  const p = writeTranscript([
    '{"model" broken json',
    JSON.stringify(assistantWithModel("claude-sonnet-5"))
  ])
  expect(lastAssistantModel(p)).toBe("claude-sonnet-5")
})

test("lastAssistantModel: transcript が存在しなければ throw", () => {
  expect(() => lastAssistantModel("/nonexistent/t.jsonl")).toThrow()
})

const readUse = (filePath: string): Record<string, unknown> => ({
  type: "assistant",
  message: {
    content: [
      { type: "tool_use", name: "Read", input: { file_path: filePath } }
    ]
  }
})

test("hasSkillFileRead: 対応する SKILL.md への Read tool_use があれば true", () => {
  const p = writeTranscript([
    readUse("/opt/plugins/revelation/skills/fable-restraint/SKILL.md")
  ])
  expect(hasSkillFileRead(p, "revelation:fable-restraint")).toBe(true)
})

test("hasSkillFileRead: 別スキルの SKILL.md への Read では false", () => {
  const p = writeTranscript([
    readUse("/opt/plugins/revelation/skills/fable-subagents/SKILL.md")
  ])
  expect(hasSkillFileRead(p, "revelation:fable-restraint")).toBe(false)
})

test("hasSkillFileRead: テキスト中にパスが現れるだけでは false", () => {
  const p = writeTranscript([
    {
      type: "user",
      message: {
        content: [
          {
            type: "text",
            text: 'Read せよ: skills/fable-restraint/SKILL.md ("name":"Read")'
          }
        ]
      }
    }
  ])
  expect(hasSkillFileRead(p, "revelation:fable-restraint")).toBe(false)
})

test("hasSkillFileRead: transcript が存在しなければ throw", () => {
  expect(() =>
    hasSkillFileRead("/nonexistent/t.jsonl", "revelation:fable-restraint")
  ).toThrow()
})

test("subagentTranscriptPath: メイン transcript と同じ階層の <session>/subagents/agent-<id>.jsonl を返す", () => {
  expect(
    subagentTranscriptPath("/proj/dir/sess-1.jsonl", "sess-1", "abc123")
  ).toBe("/proj/dir/sess-1/subagents/agent-abc123.jsonl")
})
