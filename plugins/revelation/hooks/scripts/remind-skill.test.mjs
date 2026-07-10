import { test } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const HOOK = new URL("./remind-skill.mjs", import.meta.url).pathname;
let seq = 0;

function setup() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "rev-remind-"));
  return {
    stateDir: path.join(dir, "state"),
    transcript: path.join(dir, "t.jsonl"),
    session: `s-${process.pid}-${seq++}`,
  };
}

function hook(ctx, toolName, transcriptPath) {
  const input = JSON.stringify({
    session_id: ctx.session,
    tool_name: toolName,
    transcript_path: transcriptPath ?? ctx.transcript,
    cwd: os.tmpdir(),
  });
  const out = execFileSync("node", [HOOK], {
    input,
    encoding: "utf8",
    env: { ...process.env, REVELATION_STATE_DIR: ctx.stateDir },
  });
  return JSON.parse(out).hookSpecificOutput;
}

const skillUseLine = (skill) => JSON.stringify({
  type: "assistant",
  message: { content: [{ type: "tool_use", name: "Skill", input: { skill } }] },
});

test("未読の Edit は deny(fable-restraint への誘導)、同一セッション2回目は allow", () => {
  const ctx = setup();
  fs.writeFileSync(ctx.transcript, "\n");
  const first = hook(ctx, "Edit");
  assert.equal(first.permissionDecision, "deny");
  assert.match(first.permissionDecisionReason, /revelation:fable-restraint/);
  assert.equal(hook(ctx, "Edit").permissionDecision, "allow");
});

test("fable-restraint invoke 済みなら Write は allow(マーカー消費なし)", () => {
  const ctx = setup();
  fs.writeFileSync(ctx.transcript, skillUseLine("revelation:fable-restraint") + "\n");
  assert.equal(hook(ctx, "Write").permissionDecision, "allow");
  // 既読による allow はマーカーを消費しない(deny 履歴が残らない)
  assert.equal(fs.existsSync(ctx.stateDir), false);
});

test("Task/Agent は fable-subagents を要求する(restraint 既読でも別枠)", () => {
  const ctx = setup();
  fs.writeFileSync(ctx.transcript, skillUseLine("revelation:fable-restraint") + "\n");
  const r = hook(ctx, "Task");
  assert.equal(r.permissionDecision, "deny");
  assert.match(r.permissionDecisionReason, /revelation:fable-subagents/);
});

test("スキルごとにマーカーは独立(restraint の差し戻し後も subagents は差し戻される)", () => {
  const ctx = setup();
  fs.writeFileSync(ctx.transcript, "\n");
  assert.equal(hook(ctx, "Edit").permissionDecision, "deny");
  assert.equal(hook(ctx, "Agent").permissionDecision, "deny");
  assert.equal(hook(ctx, "Agent").permissionDecision, "allow");
});

test("対象外ツールは allow", () => {
  const ctx = setup();
  fs.writeFileSync(ctx.transcript, "\n");
  assert.equal(hook(ctx, "Read").permissionDecision, "allow");
});

test("transcript が読めなければ allow(フェイルオープン)", () => {
  const ctx = setup();
  const r = hook(ctx, "Edit", "/nonexistent/t.jsonl");
  assert.equal(r.permissionDecision, "allow");
});

test("入力が JSON として壊れていても allow で終了する(フェイルオープン)", () => {
  const ctx = setup();
  const out = execFileSync("node", [HOOK], {
    input: "not-json",
    encoding: "utf8",
    env: { ...process.env, REVELATION_STATE_DIR: ctx.stateDir },
  });
  assert.equal(JSON.parse(out).hookSpecificOutput.permissionDecision, "allow");
});
