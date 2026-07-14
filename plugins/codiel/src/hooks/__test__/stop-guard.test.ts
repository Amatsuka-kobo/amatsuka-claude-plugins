import { expect, test } from "vitest";
import { fileURLToPath } from "node:url";
import { runTs } from "../../testing/run-ts.js";
import fs from "node:fs"; import os from "node:os"; import path from "node:path";

const STOP_GUARD = fileURLToPath(new URL("../stop-guard.ts", import.meta.url));
const SUBAGENT_STOP = fileURLToPath(new URL("../subagent-stop.ts", import.meta.url));
const CLI = fileURLToPath(new URL("../../codiel-state-cli.ts", import.meta.url));

interface HookResult { stdout: string; stderr?: string; exitCode: number | null }

function callHook(hookFile: string, cwd: string, stopHookActive = false): HookResult {
  const input = JSON.stringify({ cwd, stop_hook_active: stopHookActive });
  try {
    const out = runTs(hookFile, [], { input });
    return { stdout: out, exitCode: 0 };
  } catch (e) {
    const error = e as { stdout?: string; stderr?: string; status?: number | null };
    return { stdout: error.stdout ?? "", stderr: error.stderr, exitCode: error.status ?? null };
  }
}

function cli(root: string, args: string[]): string {
  return runTs(CLI, args, { cwd: root });
}

// init フェーズを in_progress にしたところで止める(phase=init)
function setupRunAtInit(): string {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "stop-guard-"));
  cli(root, ["init", "--issue", "1"]);
  cli(root, ["start-phase", "init", "--issue", "1"]);
  return root;
}

// implement フェーズを in_progress にしたところで止める
function setupRunAtImplement(): string {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "stop-guard-"));
  cli(root, ["init", "--issue", "1"]);
  cli(root, ["start-phase", "init", "--issue", "1"]);
  const passGate = (phase: string) =>
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
function setupRunAwaitingHuman(): string {
  const root = setupRunAtInit();
  cli(root, ["mark-ask", "init", "--issue", "1", "--evaluation-id", "e"]);
  return root;
}

// --- stop-guard.mjs テスト ---

test("stop-guard: run なし → 出力なし(空 stdout)で exit 0", () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "stop-guard-"));
  const result = callHook(STOP_GUARD, root);
  expect(result.exitCode).toBe(0);
  expect(result.stdout.trim()).toBe("");
});

test("stop-guard: run active(phase=init)→ {decision:block, reason に issue 番号と phase を含む}", () => {
  const root = setupRunAtInit();
  const result = callHook(STOP_GUARD, root);
  expect(result.exitCode).toBe(0);
  const parsed = JSON.parse(result.stdout);
  expect(parsed.decision).toBe("block");
  expect(parsed.reason).toMatch(/issue-1|try-1/);
  expect(parsed.reason).toMatch(/init/);
});

test("stop-guard: run active(phase=implement)→ {decision:block, reason に issue 番号と phase を含む}", () => {
  const root = setupRunAtImplement();
  const result = callHook(STOP_GUARD, root);
  expect(result.exitCode).toBe(0);
  const parsed = JSON.parse(result.stdout);
  expect(parsed.decision).toBe("block");
  expect(parsed.reason).toMatch(/issue-1|try-1/);
  expect(parsed.reason).toMatch(/implement/);
});

test("stop-guard: run awaiting_human → 出力なし", () => {
  const root = setupRunAwaitingHuman();
  const result = callHook(STOP_GUARD, root);
  expect(result.exitCode).toBe(0);
  expect(result.stdout.trim()).toBe("");
});

test("stop-guard: 入力に stop_hook_active: true → run active でも出力なし(無限ループ防止)", () => {
  const root = setupRunAtInit();
  const result = callHook(STOP_GUARD, root, true);
  expect(result.exitCode).toBe(0);
  expect(result.stdout.trim()).toBe("");
});

// --- subagent-stop.mjs テスト ---

test("subagent-stop: run なし → 出力なし", () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "subagent-stop-"));
  const result = callHook(SUBAGENT_STOP, root);
  expect(result.exitCode).toBe(0);
  expect(result.stdout.trim()).toBe("");
});

test("subagent-stop: run active で phase=init かつ issue.md が無い → {decision:block}", () => {
  const root = setupRunAtInit();
  const result = callHook(SUBAGENT_STOP, root);
  expect(result.exitCode).toBe(0);
  const parsed = JSON.parse(result.stdout);
  expect(parsed.decision).toBe("block");
  expect(parsed.reason).toMatch(/issue\.md/);
});

test("subagent-stop: issue.md を作成(1 バイト以上)したら出力なし", () => {
  const root = setupRunAtInit();
  // 最初はブロックされる
  const result1 = callHook(SUBAGENT_STOP, root);
  expect(result1.exitCode).toBe(0);
  const parsed1 = JSON.parse(result1.stdout);
  expect(parsed1.decision).toBe("block");

  // issue.md を作成
  const issueFile = path.join(root, ".codiel/runs/issue-1/try-1/issue.md");
  fs.mkdirSync(path.dirname(issueFile), { recursive: true });
  fs.writeFileSync(issueFile, "# Issue\n");

  // 作成後は出力なし
  const result2 = callHook(SUBAGENT_STOP, root);
  expect(result2.exitCode).toBe(0);
  expect(result2.stdout.trim()).toBe("");
});

test("subagent-stop: run awaiting_human で issue.md が無くても出力なし(ブロック対象外)", () => {
  const root = setupRunAwaitingHuman();
  const result = callHook(SUBAGENT_STOP, root);
  expect(result.exitCode).toBe(0);
  expect(result.stdout.trim()).toBe("");
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
  expect(result.exitCode).toBe(0);
  const parsed = JSON.parse(result.stdout);
  expect(parsed.decision).toBe("block");
  expect(parsed.reason).toMatch(/design\.md/);
});

test("subagent-stop: run active で phase=implement でも出力なし(init/design/dev-plan のみ保護)", () => {
  const root = setupRunAtImplement();
  const result = callHook(SUBAGENT_STOP, root);
  expect(result.exitCode).toBe(0);
  expect(result.stdout.trim()).toBe("");
});

test("subagent-stop: 入力に stop_hook_active: true → run active でも出力なし(無限ループ防止)", () => {
  const root = setupRunAtInit();
  const result = callHook(SUBAGENT_STOP, root, true);
  expect(result.exitCode).toBe(0);
  expect(result.stdout.trim()).toBe("");
});

// --- 修正: 並列ステージ(test-spec/dev-plan)で複数フェーズが同時に in_progress の場合の誤 block 防止 ---

// design を passed にしたところで止める(test-spec/dev-plan を並列で start できる状態)
function setupRunAtParallelStages(): string {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "subagent-stop-"));
  cli(root, ["init", "--issue", "1"]);
  cli(root, ["start-phase", "init", "--issue", "1"]);
  const passGate = (phase: string) =>
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
  expect(result.exitCode).toBe(0);
  expect(result.stdout.trim()).toBe("");
});

test("subagent-stop: dev-plan のみ in_progress(test-spec は passed 済み)で dev-plan.md が無い → {decision:block}(既存挙動維持)", () => {
  const root = setupRunAtParallelStages();
  cli(root, ["start-phase", "test-spec", "--issue", "1"]);
  cli(root, ["pass-gate", "test-spec", "--issue", "1", "--evaluation-id", "e", "--verdict", "PROCEED"]);
  cli(root, ["start-phase", "dev-plan", "--issue", "1"]);
  const result = callHook(SUBAGENT_STOP, root);
  expect(result.exitCode).toBe(0);
  const parsed = JSON.parse(result.stdout);
  expect(parsed.decision).toBe("block");
  expect(parsed.reason).toMatch(/dev-plan\.md/);
});

test("subagent-stop: run active で phase=discuss かつ agenda.md が無い → {decision:block}", () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "subagent-stop-"));
  cli(root, ["init", "--issue", "1"]);
  cli(root, ["start-phase", "init", "--issue", "1"]);
  cli(root, ["pass-gate", "init", "--issue", "1", "--evaluation-id", "e", "--verdict", "PROCEED"]);
  cli(root, ["start-phase", "discuss", "--issue", "1"]);

  const result1 = callHook(SUBAGENT_STOP, root);
  expect(result1.exitCode).toBe(0);
  const parsed = JSON.parse(result1.stdout);
  expect(parsed.decision).toBe("block");
  expect(parsed.reason).toMatch(/agenda\.md/);

  const agendaFile = path.join(root, ".codiel/runs/issue-1/try-1/agenda.md");
  fs.writeFileSync(agendaFile, "# agenda\n");
  const result2 = callHook(SUBAGENT_STOP, root);
  expect(result2.exitCode).toBe(0);
  expect(result2.stdout.trim()).toBe("");
});

test("stop-guard: ブロック文言が discuss の回答待ち停止を正当な停止として案内する", () => {
  const root = setupRunAtInit();
  const result = callHook(STOP_GUARD, root);
  const parsed = JSON.parse(result.stdout);
  expect(parsed.reason).toMatch(/discuss/);
});
