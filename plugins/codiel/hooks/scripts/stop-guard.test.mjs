import { test } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import fs from "node:fs"; import os from "node:os"; import path from "node:path";

const STOP_GUARD = new URL("./stop-guard.mjs", import.meta.url).pathname;
const SUBAGENT_STOP = new URL("./subagent-stop.mjs", import.meta.url).pathname;
const CLI = new URL("../../scripts/codiel-state.mjs", import.meta.url).pathname;

function callHook(hookFile, cwd, stopHookActive = false) {
  const input = JSON.stringify({ cwd, stop_hook_active: stopHookActive });
  try {
    const out = execFileSync("node", [hookFile], { input, encoding: "utf8" });
    return { stdout: out, exitCode: 0 };
  } catch (e) {
    return { stdout: e.stdout, stderr: e.stderr, exitCode: e.status };
  }
}

function cli(root, args) {
  return execFileSync("node", [CLI, ...args], { cwd: root, encoding: "utf8" });
}

// init フェーズを in_progress にしたところで止める(phase=init)
function setupRunAtInit() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "stop-guard-"));
  cli(root, ["init", "--issue", "1"]);
  cli(root, ["start-phase", "init", "--issue", "1"]);
  return root;
}

// implement フェーズを in_progress にしたところで止める
function setupRunAtImplement() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "stop-guard-"));
  cli(root, ["init", "--issue", "1"]);
  cli(root, ["start-phase", "init", "--issue", "1"]);
  const passGate = (phase) =>
    cli(root, ["pass-gate", phase, "--issue", "1", "--evaluation-id", "e", "--verdict", "PROCEED"]);
  passGate("init");
  cli(root, ["start-phase", "discuss", "--issue", "1"]);
  cli(root, ["complete-phase", "discuss", "--issue", "1"]);
  for (const ph of ["design", "test-spec", "dev-plan"]) {
    cli(root, ["start-phase", ph, "--issue", "1"]);
    passGate(ph);
  }
  cli(root, ["start-phase", "implement", "--issue", "1"]);
  return root;
}

// awaiting_human 状態にする
function setupRunAwaitingHuman() {
  const root = setupRunAtInit();
  cli(root, ["mark-ask", "init", "--issue", "1", "--evaluation-id", "e"]);
  return root;
}

// --- stop-guard.mjs テスト ---

test("stop-guard: run なし → 出力なし(空 stdout)で exit 0", () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "stop-guard-"));
  const result = callHook(STOP_GUARD, root);
  assert.equal(result.exitCode, 0);
  assert.equal(result.stdout.trim(), "");
});

test("stop-guard: run active(phase=init)→ {decision:block, reason に issue 番号と phase を含む}", () => {
  const root = setupRunAtInit();
  const result = callHook(STOP_GUARD, root);
  assert.equal(result.exitCode, 0);
  const parsed = JSON.parse(result.stdout);
  assert.equal(parsed.decision, "block");
  assert.match(parsed.reason, /issue-1|try-1/);
  assert.match(parsed.reason, /init/);
});

test("stop-guard: run active(phase=implement)→ {decision:block, reason に issue 番号と phase を含む}", () => {
  const root = setupRunAtImplement();
  const result = callHook(STOP_GUARD, root);
  assert.equal(result.exitCode, 0);
  const parsed = JSON.parse(result.stdout);
  assert.equal(parsed.decision, "block");
  assert.match(parsed.reason, /issue-1|try-1/);
  assert.match(parsed.reason, /implement/);
});

test("stop-guard: run awaiting_human → 出力なし", () => {
  const root = setupRunAwaitingHuman();
  const result = callHook(STOP_GUARD, root);
  assert.equal(result.exitCode, 0);
  assert.equal(result.stdout.trim(), "");
});

test("stop-guard: 入力に stop_hook_active: true → run active でも出力なし(無限ループ防止)", () => {
  const root = setupRunAtInit();
  const result = callHook(STOP_GUARD, root, true);
  assert.equal(result.exitCode, 0);
  assert.equal(result.stdout.trim(), "");
});

// --- subagent-stop.mjs テスト ---

test("subagent-stop: run なし → 出力なし", () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "subagent-stop-"));
  const result = callHook(SUBAGENT_STOP, root);
  assert.equal(result.exitCode, 0);
  assert.equal(result.stdout.trim(), "");
});

test("subagent-stop: run active で phase=init かつ issue.md が無い → {decision:block}", () => {
  const root = setupRunAtInit();
  const result = callHook(SUBAGENT_STOP, root);
  assert.equal(result.exitCode, 0);
  const parsed = JSON.parse(result.stdout);
  assert.equal(parsed.decision, "block");
  assert.match(parsed.reason, /issue\.md/);
});

test("subagent-stop: issue.md を作成(1 バイト以上)したら出力なし", () => {
  const root = setupRunAtInit();
  // 最初はブロックされる
  const result1 = callHook(SUBAGENT_STOP, root);
  assert.equal(result1.exitCode, 0);
  const parsed1 = JSON.parse(result1.stdout);
  assert.equal(parsed1.decision, "block");

  // issue.md を作成
  const issueFile = path.join(root, ".codiel/runs/issue-1/try-1/issue.md");
  fs.mkdirSync(path.dirname(issueFile), { recursive: true });
  fs.writeFileSync(issueFile, "# Issue\n");

  // 作成後は出力なし
  const result2 = callHook(SUBAGENT_STOP, root);
  assert.equal(result2.exitCode, 0);
  assert.equal(result2.stdout.trim(), "");
});

test("subagent-stop: run awaiting_human で issue.md が無くても出力なし(ブロック対象外)", () => {
  const root = setupRunAwaitingHuman();
  const result = callHook(SUBAGENT_STOP, root);
  assert.equal(result.exitCode, 0);
  assert.equal(result.stdout.trim(), "");
});

test("subagent-stop: run active で phase=design かつ design.md が無い → {decision:block}", () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "subagent-stop-"));
  cli(root, ["init", "--issue", "1"]);
  cli(root, ["start-phase", "init", "--issue", "1"]);
  cli(root, ["pass-gate", "init", "--issue", "1", "--evaluation-id", "e", "--verdict", "PROCEED"]);
  cli(root, ["start-phase", "discuss", "--issue", "1"]);
  cli(root, ["complete-phase", "discuss", "--issue", "1"]);
  cli(root, ["start-phase", "design", "--issue", "1"]);

  const result = callHook(SUBAGENT_STOP, root);
  assert.equal(result.exitCode, 0);
  const parsed = JSON.parse(result.stdout);
  assert.equal(parsed.decision, "block");
  assert.match(parsed.reason, /design\.md/);
});

test("subagent-stop: run active で phase=implement でも出力なし(init/design/dev-plan のみ保護)", () => {
  const root = setupRunAtImplement();
  const result = callHook(SUBAGENT_STOP, root);
  assert.equal(result.exitCode, 0);
  assert.equal(result.stdout.trim(), "");
});

test("subagent-stop: 入力に stop_hook_active: true → run active でも出力なし(無限ループ防止)", () => {
  const root = setupRunAtInit();
  const result = callHook(SUBAGENT_STOP, root, true);
  assert.equal(result.exitCode, 0);
  assert.equal(result.stdout.trim(), "");
});

// --- 修正: 並列ステージ(test-spec/dev-plan)で複数フェーズが同時に in_progress の場合の誤 block 防止 ---

// design を passed にしたところで止める(test-spec/dev-plan を並列で start できる状態)
function setupRunAtParallelStages() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "subagent-stop-"));
  cli(root, ["init", "--issue", "1"]);
  cli(root, ["start-phase", "init", "--issue", "1"]);
  const passGate = (phase) =>
    cli(root, ["pass-gate", phase, "--issue", "1", "--evaluation-id", "e", "--verdict", "PROCEED"]);
  passGate("init");
  cli(root, ["start-phase", "discuss", "--issue", "1"]);
  cli(root, ["complete-phase", "discuss", "--issue", "1"]);
  cli(root, ["start-phase", "design", "--issue", "1"]);
  passGate("design");
  return root;
}

test("subagent-stop: test-spec と dev-plan が両方 in_progress → dev-plan.md が無くても出力なし(どのサブエージェントの停止か識別不能なため検査スキップ)", () => {
  const root = setupRunAtParallelStages();
  cli(root, ["start-phase", "test-spec", "--issue", "1"]);
  cli(root, ["start-phase", "dev-plan", "--issue", "1"]);
  const result = callHook(SUBAGENT_STOP, root);
  assert.equal(result.exitCode, 0);
  assert.equal(result.stdout.trim(), "");
});

test("subagent-stop: dev-plan のみ in_progress(test-spec は passed 済み)で dev-plan.md が無い → {decision:block}(既存挙動維持)", () => {
  const root = setupRunAtParallelStages();
  cli(root, ["start-phase", "test-spec", "--issue", "1"]);
  cli(root, ["pass-gate", "test-spec", "--issue", "1", "--evaluation-id", "e", "--verdict", "PROCEED"]);
  cli(root, ["start-phase", "dev-plan", "--issue", "1"]);
  const result = callHook(SUBAGENT_STOP, root);
  assert.equal(result.exitCode, 0);
  const parsed = JSON.parse(result.stdout);
  assert.equal(parsed.decision, "block");
  assert.match(parsed.reason, /dev-plan\.md/);
});

test("subagent-stop: run active で phase=discuss かつ agenda.md が無い → {decision:block}", () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "subagent-stop-"));
  cli(root, ["init", "--issue", "1"]);
  cli(root, ["start-phase", "init", "--issue", "1"]);
  cli(root, ["pass-gate", "init", "--issue", "1", "--evaluation-id", "e", "--verdict", "PROCEED"]);
  cli(root, ["start-phase", "discuss", "--issue", "1"]);

  const result1 = callHook(SUBAGENT_STOP, root);
  assert.equal(result1.exitCode, 0);
  const parsed = JSON.parse(result1.stdout);
  assert.equal(parsed.decision, "block");
  assert.match(parsed.reason, /agenda\.md/);

  const agendaFile = path.join(root, ".codiel/runs/issue-1/try-1/agenda.md");
  fs.writeFileSync(agendaFile, "# agenda\n");
  const result2 = callHook(SUBAGENT_STOP, root);
  assert.equal(result2.exitCode, 0);
  assert.equal(result2.stdout.trim(), "");
});

test("stop-guard: ブロック文言が discuss の回答待ち停止を正当な停止として案内する", () => {
  const root = setupRunAtInit();
  const result = callHook(STOP_GUARD, root);
  const parsed = JSON.parse(result.stdout);
  assert.match(parsed.reason, /discuss/);
});
