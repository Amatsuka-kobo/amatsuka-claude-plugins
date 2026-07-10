import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { hasSkillInvocation, hasSkillFileRead, lastAssistantModel, subagentTranscriptPath } from "./lib.mjs";

function writeTranscript(lines) {
  const p = path.join(fs.mkdtempSync(path.join(os.tmpdir(), "rev-lib-")), "t.jsonl");
  fs.writeFileSync(p, lines.map((l) => (typeof l === "string" ? l : JSON.stringify(l))).join("\n") + "\n");
  return p;
}

const skillUse = (skill) => ({
  type: "assistant",
  message: { content: [{ type: "tool_use", name: "Skill", input: { skill } }] },
});

const assistantWithModel = (model) => ({
  type: "assistant",
  message: { model, content: [{ type: "text", text: "hi" }] },
});

test("Skill tool_use があれば true", () => {
  const p = writeTranscript([skillUse("revelation:fable-restraint")]);
  assert.equal(hasSkillInvocation(p, "revelation:fable-restraint"), true);
});

test("別スキルの invoke では false", () => {
  const p = writeTranscript([skillUse("superpowers:brainstorming")]);
  assert.equal(hasSkillInvocation(p, "revelation:fable-restraint"), false);
});

test("テキスト中にスキル名が現れるだけでは false(注入トリガー表への誤検知防止)", () => {
  const p = writeTranscript([
    { type: "user", message: { content: [{ type: "text", text: 'Skill ツールで revelation:fable-restraint を invoke せよ ("name":"Skill")' }] } },
  ]);
  assert.equal(hasSkillInvocation(p, "revelation:fable-restraint"), false);
});

test("壊れた JSON 行はスキップして残りを読む", () => {
  const p = writeTranscript(['{"Skill" broken json', JSON.stringify(skillUse("revelation:fable-restraint"))]);
  assert.equal(hasSkillInvocation(p, "revelation:fable-restraint"), true);
});

test("transcript が存在しなければ throw(フェイルオープン判断は呼び出し側)", () => {
  assert.throws(() => hasSkillInvocation("/nonexistent/t.jsonl", "revelation:fable-restraint"));
});

test("lastAssistantModel: assistant イベントの model を返す(複数あれば最後のもの)", () => {
  const p = writeTranscript([assistantWithModel("claude-opus-4-8"), assistantWithModel("claude-fable-5")]);
  assert.equal(lastAssistantModel(p), "claude-fable-5");
});

test("lastAssistantModel: assistant イベントが無ければ null", () => {
  const p = writeTranscript([
    { type: "user", message: { content: [{ type: "text", text: "hello" }] } },
  ]);
  assert.equal(lastAssistantModel(p), null);
});

test("lastAssistantModel: 壊れた JSON 行はスキップする", () => {
  const p = writeTranscript(['{"model" broken json', JSON.stringify(assistantWithModel("claude-sonnet-5"))]);
  assert.equal(lastAssistantModel(p), "claude-sonnet-5");
});

test("lastAssistantModel: transcript が存在しなければ throw", () => {
  assert.throws(() => lastAssistantModel("/nonexistent/t.jsonl"));
});

const readUse = (filePath) => ({
  type: "assistant",
  message: { content: [{ type: "tool_use", name: "Read", input: { file_path: filePath } }] },
});

test("hasSkillFileRead: 対応する SKILL.md への Read tool_use があれば true", () => {
  const p = writeTranscript([readUse("/opt/plugins/revelation/skills/fable-restraint/SKILL.md")]);
  assert.equal(hasSkillFileRead(p, "revelation:fable-restraint"), true);
});

test("hasSkillFileRead: 別スキルの SKILL.md への Read では false", () => {
  const p = writeTranscript([readUse("/opt/plugins/revelation/skills/fable-subagents/SKILL.md")]);
  assert.equal(hasSkillFileRead(p, "revelation:fable-restraint"), false);
});

test("hasSkillFileRead: テキスト中にパスが現れるだけでは false", () => {
  const p = writeTranscript([
    { type: "user", message: { content: [{ type: "text", text: 'Read せよ: skills/fable-restraint/SKILL.md ("name":"Read")' }] } },
  ]);
  assert.equal(hasSkillFileRead(p, "revelation:fable-restraint"), false);
});

test("hasSkillFileRead: transcript が存在しなければ throw", () => {
  assert.throws(() => hasSkillFileRead("/nonexistent/t.jsonl", "revelation:fable-restraint"));
});

test("subagentTranscriptPath: メイン transcript と同じ階層の <session>/subagents/agent-<id>.jsonl を返す", () => {
  assert.equal(
    subagentTranscriptPath("/proj/dir/sess-1.jsonl", "sess-1", "abc123"),
    "/proj/dir/sess-1/subagents/agent-abc123.jsonl",
  );
});
