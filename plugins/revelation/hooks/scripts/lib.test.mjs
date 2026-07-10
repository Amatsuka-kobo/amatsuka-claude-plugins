import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { hasSkillInvocation } from "./lib.mjs";

function writeTranscript(lines) {
  const p = path.join(fs.mkdtempSync(path.join(os.tmpdir(), "rev-lib-")), "t.jsonl");
  fs.writeFileSync(p, lines.map((l) => (typeof l === "string" ? l : JSON.stringify(l))).join("\n") + "\n");
  return p;
}

const skillUse = (skill) => ({
  type: "assistant",
  message: { content: [{ type: "tool_use", name: "Skill", input: { skill } }] },
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
