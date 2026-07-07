import { test } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const CLI = new URL("./codiel-state.mjs", import.meta.url).pathname;

function tmpProject() {
  return fs.mkdtempSync(path.join(os.tmpdir(), "codiel-state-"));
}
function run(cwd, args, opts = {}) {
  try {
    const out = execFileSync("node", [CLI, ...args], { cwd, encoding: "utf8" });
    return { code: 0, out: JSON.parse(out) };
  } catch (e) {
    return { code: e.status, err: (e.stderr || e.stdout || "").toString() };
  }
}

test("init は try-1 の state.json を作成する", () => {
  const root = tmpProject();
  const r = run(root, ["init", "--issue", "123", "--base-branch", "main"]);
  assert.equal(r.code, 0);
  assert.equal(r.out.state.runId, "issue-123");
  assert.equal(r.out.state.try, 1);
  assert.equal(r.out.state.branch, "codiel/issue-123-try-1");
  assert.equal(r.out.state.raguelRunId, "issue-123-try-1");
  assert.equal(r.out.state.status, "active");
  assert.equal(r.out.state.phases["init"].status, "pending");
  assert.ok(fs.existsSync(path.join(root, ".codiel/runs/issue-123/try-1/state.json")));
  assert.ok(fs.existsSync(path.join(root, ".codiel/runs/issue-123/try-1/reports")));
});

test("未完了 try がある間は init が失敗する", () => {
  const root = tmpProject();
  run(root, ["init", "--issue", "123"]);
  const r = run(root, ["init", "--issue", "123"]);
  assert.equal(r.code, 1);
  assert.match(r.err, /未完了/);
});

test("終端状態(stopped)なら init が try-2 を作成する", () => {
  const root = tmpProject();
  run(root, ["init", "--issue", "123"]);
  run(root, ["stop", "--issue", "123", "--reason", "test"]);
  const r = run(root, ["init", "--issue", "123"]);
  assert.equal(r.code, 0);
  assert.equal(r.out.state.try, 2);
  assert.equal(r.out.state.branch, "codiel/issue-123-try-2");
});

test("get は最新 try の state を返す", () => {
  const root = tmpProject();
  run(root, ["init", "--issue", "7"]);
  const r = run(root, ["get", "--issue", "7"]);
  assert.equal(r.code, 0);
  assert.equal(r.out.state.runId, "issue-7");
});

test("get --active はアクティブ run の一覧を返す", () => {
  const root = tmpProject();
  run(root, ["init", "--issue", "1"]);
  const r = run(root, ["get", "--active"]);
  assert.equal(r.code, 0);
  assert.equal(r.out.runs.length, 1);
  assert.equal(r.out.runs[0].state.issue, 1);
});
