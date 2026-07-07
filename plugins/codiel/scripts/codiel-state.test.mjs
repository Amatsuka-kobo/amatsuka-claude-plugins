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

test("stop は終端状態のときに失敗する", () => {
  const root = tmpProject();
  run(root, ["init", "--issue", "1"]);
  run(root, ["stop", "--issue", "1", "--reason", "test"]);
  const r = run(root, ["stop", "--issue", "1", "--reason", "test again"]);
  assert.equal(r.code, 1);
  assert.match(r.err, /すでに終端状態です/);
});

test("start-phase は前ステージ未passedなら失敗する", () => {
  const root = tmpProject();
  run(root, ["init", "--issue", "1"]);
  const r = run(root, ["start-phase", "design", "--issue", "1"]);
  assert.equal(r.code, 1);
  assert.match(r.err, /init/);
});

test("GATEDフェーズは pass-gate(PROCEED)でのみ passed になる", () => {
  const root = tmpProject();
  run(root, ["init", "--issue", "1"]);
  run(root, ["start-phase", "init", "--issue", "1"]);
  let r = run(root, ["pass-gate", "init", "--issue", "1", "--evaluation-id", "ev1", "--verdict", "ASK"]);
  assert.equal(r.code, 1);
  r = run(root, ["complete-phase", "init", "--issue", "1"]);
  assert.equal(r.code, 1); // GATED に complete-phase は使えない
  r = run(root, ["pass-gate", "init", "--issue", "1", "--evaluation-id", "ev1", "--verdict", "PROCEED"]);
  assert.equal(r.code, 0);
  assert.equal(r.out.state.phases["init"].status, "passed");
  assert.equal(r.out.state.phases["init"].evaluationId, "ev1");
});

test("pass-gate は --human-approved 指定時に ASK を受理し humanApproved を記録する", () => {
  const root = tmpProject();
  run(root, ["init", "--issue", "1"]);
  run(root, ["start-phase", "init", "--issue", "1"]);
  const r = run(root, ["pass-gate", "init", "--issue", "1", "--evaluation-id", "e1", "--verdict", "ASK", "--human-approved"]);
  assert.equal(r.code, 0);
  assert.equal(r.out.state.phases["init"].status, "passed");
  assert.equal(r.out.state.phases["init"].verdict, "ASK");
  assert.equal(r.out.state.phases["init"].humanApproved, true);
});

test("pass-gate は --human-approved なしでは ASK を従来どおり拒否する", () => {
  const root = tmpProject();
  run(root, ["init", "--issue", "1"]);
  run(root, ["start-phase", "init", "--issue", "1"]);
  const r = run(root, ["pass-gate", "init", "--issue", "1", "--evaluation-id", "e1", "--verdict", "ASK"]);
  assert.equal(r.code, 1);
});

test("--human-approved で passed になったフェーズの次フェーズを start-phase できる", () => {
  const root = tmpProject();
  run(root, ["init", "--issue", "1"]);
  run(root, ["start-phase", "init", "--issue", "1"]);
  run(root, ["pass-gate", "init", "--issue", "1", "--evaluation-id", "e1", "--verdict", "ASK", "--human-approved"]);
  const r = run(root, ["start-phase", "design", "--issue", "1"]);
  assert.equal(r.code, 0);
});

test("並列ステージ(test-spec/dev-plan)は design passed 後に両方 start できる", () => {
  const root = tmpProject();
  run(root, ["init", "--issue", "1"]);
  run(root, ["start-phase", "init", "--issue", "1"]);
  run(root, ["pass-gate", "init", "--issue", "1", "--evaluation-id", "e1", "--verdict", "PROCEED"]);
  run(root, ["start-phase", "design", "--issue", "1"]);
  run(root, ["pass-gate", "design", "--issue", "1", "--evaluation-id", "e2", "--verdict", "PROCEED"]);
  assert.equal(run(root, ["start-phase", "test-spec", "--issue", "1"]).code, 0);
  assert.equal(run(root, ["start-phase", "dev-plan", "--issue", "1"]).code, 0);
  // 片方だけ passed では implement に進めない
  run(root, ["pass-gate", "test-spec", "--issue", "1", "--evaluation-id", "e3", "--verdict", "PROCEED"]);
  assert.equal(run(root, ["start-phase", "implement", "--issue", "1"]).code, 1);
});

test("mark-ask / resume で awaiting_human を往復できる", () => {
  const root = tmpProject();
  run(root, ["init", "--issue", "1"]);
  run(root, ["start-phase", "init", "--issue", "1"]);
  let r = run(root, ["mark-ask", "init", "--issue", "1", "--evaluation-id", "e1"]);
  assert.equal(r.out.state.status, "awaiting_human");
  assert.equal(r.out.state.phases["init"].status, "awaiting_human");
  r = run(root, ["resume", "--issue", "1"]);
  assert.equal(r.out.state.status, "active");
  assert.equal(r.out.state.phases["init"].status, "in_progress");
});

test("record-attempt は上限超過で exit 3 + awaiting_human", () => {
  const root = tmpProject();
  run(root, ["init", "--issue", "1"]);
  run(root, ["start-phase", "init", "--issue", "1"]);
  for (let i = 0; i < 5; i++) assert.equal(run(root, ["record-attempt", "init", "--issue", "1"]).code, 0);
  const r = run(root, ["record-attempt", "init", "--issue", "1"]);
  assert.equal(r.code, 3);
  assert.equal(run(root, ["get", "--issue", "1"]).out.state.status, "awaiting_human");
});

test("pr フェーズの complete-phase は --pr-url 必須", () => {
  const root = tmpProject();
  run(root, ["init", "--issue", "1"]);
  passThrough(root, ["init", "design", "test-spec", "dev-plan", "implement", "test-loop"]);
  run(root, ["start-phase", "pr", "--issue", "1"]);
  assert.equal(run(root, ["complete-phase", "pr", "--issue", "1"]).code, 1);
  const r = run(root, ["complete-phase", "pr", "--issue", "1", "--pr-url", "https://example.test/pr/1"]);
  assert.equal(r.code, 0);
  assert.equal(r.out.state.pr.url, "https://example.test/pr/1");
});

test("finalize は全フェーズ passed 後のみ成功し awaiting_outcome にする", () => {
  const root = tmpProject();
  run(root, ["init", "--issue", "1"]);
  assert.equal(run(root, ["finalize", "--issue", "1"]).code, 1);
  passThrough(root, ["init", "design", "test-spec", "dev-plan", "implement", "test-loop"]);
  run(root, ["start-phase", "pr", "--issue", "1"]);
  run(root, ["complete-phase", "pr", "--issue", "1", "--pr-url", "u"]);
  for (const ph of ["review", "fix-loop", "triage"]) {
    run(root, ["start-phase", ph, "--issue", "1"]);
    if (ph === "fix-loop") run(root, ["pass-gate", ph, "--issue", "1", "--evaluation-id", "e", "--verdict", "PROCEED"]);
    else run(root, ["complete-phase", ph, "--issue", "1"]);
  }
  const r = run(root, ["finalize", "--issue", "1"]);
  assert.equal(r.code, 0);
  assert.equal(r.out.state.status, "awaiting_outcome");
});

test("record-outcome approved は completed にする", () => {
  const root = tmpProject();
  run(root, ["init", "--issue", "1"]);
  assert.equal(run(root, ["record-outcome", "--issue", "1", "--outcome", "approved"]).code, 1);
  // (finalize まで進めるヘルパーを流してから)
  fullRun(root, "1");
  const r = run(root, ["record-outcome", "--issue", "1", "--outcome", "approved"]);
  assert.equal(r.out.state.status, "completed");
});

test("skip-phase fix-loop は review まで passed なら passed/verdict SKIPPED にでき、続けて triage を start できる", () => {
  const root = tmpProject();
  run(root, ["init", "--issue", "1"]);
  throughReview(root, "1");
  const r = run(root, ["skip-phase", "fix-loop", "--issue", "1", "--reason", "critical/high ゼロ"]);
  assert.equal(r.code, 0);
  assert.equal(r.out.state.phases["fix-loop"].status, "passed");
  assert.equal(r.out.state.phases["fix-loop"].verdict, "SKIPPED");
  assert.equal(r.out.state.phases["fix-loop"].note, "critical/high ゼロ");
  const r2 = run(root, ["start-phase", "triage", "--issue", "1"]);
  assert.equal(r2.code, 0);
});

test("skip-phase は fix-loop 以外のフェーズでは失敗する", () => {
  const root = tmpProject();
  run(root, ["init", "--issue", "1"]);
  const r = run(root, ["skip-phase", "implement", "--issue", "1", "--reason", "理由"]);
  assert.equal(r.code, 1);
});

test("skip-phase は --reason なしでは失敗する", () => {
  const root = tmpProject();
  run(root, ["init", "--issue", "1"]);
  throughReview(root, "1");
  const r = run(root, ["skip-phase", "fix-loop", "--issue", "1"]);
  assert.equal(r.code, 1);
});

test("skip-phase fix-loop は review が passed でない状態では失敗する", () => {
  const root = tmpProject();
  run(root, ["init", "--issue", "1"]);
  passThrough(root, ["init", "design", "test-spec", "dev-plan", "implement", "test-loop"]);
  run(root, ["start-phase", "pr", "--issue", "1"]);
  run(root, ["complete-phase", "pr", "--issue", "1", "--pr-url", "u"]);
  run(root, ["start-phase", "review", "--issue", "1"]); // review は in_progress のまま(未 passed)
  const r = run(root, ["skip-phase", "fix-loop", "--issue", "1", "--reason", "理由"]);
  assert.equal(r.code, 1);
});

test("complete-phase は不正なフェーズ名を拒否する", () => {
  const root = tmpProject();
  run(root, ["init", "--issue", "1"]);
  const r = run(root, ["complete-phase", "bogus", "--issue", "1"]);
  assert.equal(r.code, 1);
  assert.match(r.err, /不正なフェーズ/);
});

test("mark-ask は不正なフェーズ名を拒否する", () => {
  const root = tmpProject();
  run(root, ["init", "--issue", "1"]);
  const r = run(root, ["mark-ask", "bogus", "--issue", "1", "--evaluation-id", "e"]);
  assert.equal(r.code, 1);
  assert.match(r.err, /不正なフェーズ/);
});

test("record-attempt は不正なフェーズ名を拒否する", () => {
  const root = tmpProject();
  run(root, ["init", "--issue", "1"]);
  const r = run(root, ["record-attempt", "bogus", "--issue", "1"]);
  assert.equal(r.code, 1);
  assert.match(r.err, /不正なフェーズ/);
});

test("skip-phase は不正なフェーズ名を拒否する", () => {
  const root = tmpProject();
  run(root, ["init", "--issue", "1"]);
  const r = run(root, ["skip-phase", "bogus", "--issue", "1", "--reason", "理由"]);
  assert.equal(r.code, 1);
  assert.match(r.err, /不正なフェーズ/);
});

// テストヘルパー
function passThrough(root, phases) {
  for (const ph of phases) {
    run(root, ["start-phase", ph, "--issue", "1"]);
    run(root, ["pass-gate", ph, "--issue", "1", "--evaluation-id", `e-${ph}`, "--verdict", "PROCEED"]);
  }
}

function throughReview(root, issue) {
  passThrough(root, ["init", "design", "test-spec", "dev-plan", "implement", "test-loop"]);
  run(root, ["start-phase", "pr", "--issue", issue]);
  run(root, ["complete-phase", "pr", "--issue", issue, "--pr-url", "u"]);
  run(root, ["start-phase", "review", "--issue", issue]);
  run(root, ["complete-phase", "review", "--issue", issue]);
}

function fullRun(root, issue) {
  passThrough(root, ["init", "design", "test-spec", "dev-plan", "implement", "test-loop"]);
  run(root, ["start-phase", "pr", "--issue", issue]);
  run(root, ["complete-phase", "pr", "--issue", issue, "--pr-url", "u"]);
  run(root, ["start-phase", "review", "--issue", issue]);
  run(root, ["complete-phase", "review", "--issue", issue]);
  run(root, ["start-phase", "fix-loop", "--issue", issue]);
  run(root, ["pass-gate", "fix-loop", "--issue", issue, "--evaluation-id", "e", "--verdict", "PROCEED"]);
  run(root, ["start-phase", "triage", "--issue", issue]);
  run(root, ["complete-phase", "triage", "--issue", issue]);
  run(root, ["finalize", "--issue", issue]);
}
