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

// stdout が空(= permissionDecision 出力なし、素通し)なら null を返す。
// deny など出力がある場合は hookSpecificOutput を返す。
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
  if (out === "") return null;
  return JSON.parse(out).hookSpecificOutput;
}

const skillUseLine = (skill) => JSON.stringify({
  type: "assistant",
  message: { content: [{ type: "tool_use", name: "Skill", input: { skill } }] },
});

const assistantModelLine = (model) => JSON.stringify({
  type: "assistant",
  message: { model, content: [{ type: "text", text: "hi" }] },
});

test("未読の Edit は deny(fable-restraint への誘導)、同一セッション2回目は素通し(無出力)", () => {
  const ctx = setup();
  fs.writeFileSync(ctx.transcript, "\n");
  const first = hook(ctx, "Edit");
  assert.equal(first.permissionDecision, "deny");
  assert.match(first.permissionDecisionReason, /revelation:fable-restraint/);
  assert.equal(hook(ctx, "Edit"), null);
});

test("fable-restraint invoke 済みなら Write は素通し(無出力、マーカー消費なし)", () => {
  const ctx = setup();
  fs.writeFileSync(ctx.transcript, skillUseLine("revelation:fable-restraint") + "\n");
  assert.equal(hook(ctx, "Write"), null);
  // 既読による素通しはマーカーを消費しない(deny 履歴が残らない)
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
  assert.equal(hook(ctx, "Agent"), null);
});

test("対象外ツールは素通し(無出力)", () => {
  const ctx = setup();
  fs.writeFileSync(ctx.transcript, "\n");
  assert.equal(hook(ctx, "Read"), null);
});

test("transcript が読めなければ素通し(無出力、フェイルオープン)", () => {
  const ctx = setup();
  const r = hook(ctx, "Edit", "/nonexistent/t.jsonl");
  assert.equal(r, null);
});

test("入力が JSON として壊れていても無出力で終了する(フェイルオープン)", () => {
  const ctx = setup();
  const out = execFileSync("node", [HOOK], {
    input: "not-json",
    encoding: "utf8",
    env: { ...process.env, REVELATION_STATE_DIR: ctx.stateDir },
  });
  assert.equal(out, "");
});

test("マーカーディレクトリの作成に失敗すると素通し(無出力、外側 catch)", () => {
  const ctx = setup();
  fs.writeFileSync(ctx.transcript, "\n");
  // REVELATION_STATE_DIR を既存の「ファイル」に向けると mkdirSync が throw する
  fs.mkdirSync(path.dirname(ctx.stateDir), { recursive: true });
  fs.writeFileSync(ctx.stateDir, "");
  const r = hook(ctx, "Edit");
  assert.equal(r, null);
});

test("Fable セッション(model に fable を含む)では未読でも Edit は素通し(マーカーも作られない)", () => {
  const ctx = setup();
  fs.writeFileSync(ctx.transcript, assistantModelLine("claude-fable-5") + "\n");
  assert.equal(hook(ctx, "Edit"), null);
  assert.equal(fs.existsSync(ctx.stateDir), false);
});

test("Opus セッションは対象のまま(従来どおり deny)", () => {
  const ctx = setup();
  fs.writeFileSync(ctx.transcript, assistantModelLine("claude-opus-4-8") + "\n");
  const r = hook(ctx, "Edit");
  assert.equal(r.permissionDecision, "deny");
  assert.match(r.permissionDecisionReason, /revelation:fable-restraint/);
});
