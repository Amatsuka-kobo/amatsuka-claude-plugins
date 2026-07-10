import { test } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import fs from "node:fs"; import os from "node:os"; import path from "node:path";

const HOOK = new URL("./guard-write.mjs", import.meta.url).pathname;
const CLI = new URL("../../scripts/codiel-state.mjs", import.meta.url).pathname;

// stdout が空(= permissionDecision 出力なし、素通し)なら null を返す。
// deny/ask など出力がある場合は hookSpecificOutput を返す。
function hook(cwd, toolName, filePath) {
  const input = JSON.stringify({ cwd, tool_name: toolName, tool_input: { file_path: filePath } });
  const out = execFileSync("node", [HOOK], { input, encoding: "utf8" });
  if (out === "") return null;
  return JSON.parse(out).hookSpecificOutput;
}
function setupRun(phasesToPass = []) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "guard-write-"));
  execFileSync("node", [CLI, "init", "--issue", "1"], { cwd: root });
  execFileSync("node", [CLI, "start-phase", "init", "--issue", "1"], { cwd: root });
  for (const ph of phasesToPass) {
    execFileSync("node", [CLI, "pass-gate", ph, "--issue", "1", "--evaluation-id", "e", "--verdict", "PROCEED"], { cwd: root });
    // 次フェーズの start は呼び出し側で
  }
  return root;
}

test("state.json への直接書き込みは run の有無に関わらず deny", () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "gw-"));
  const r = hook(root, "Write", path.join(root, ".codiel/runs/issue-1/try-1/state.json"));
  assert.equal(r.permissionDecision, "deny");
});

test("アクティブ run がなければ通常の書き込みは素通し(無出力)", () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "gw-"));
  const r = hook(root, "Edit", path.join(root, "src/index.ts"));
  assert.equal(r, null);
});

test("文書フェーズ(init)中の src への書き込みは ask、.codiel 配下は素通し(無出力)", () => {
  const root = setupRun();
  assert.equal(hook(root, "Write", path.join(root, "src/app.ts")).permissionDecision, "ask");
  assert.equal(hook(root, "Write", path.join(root, ".codiel/runs/issue-1/try-1/issue.md")), null);
});

test("implement フェーズ中: src は素通し、specs の cases.md は ask", () => {
  const root = setupRun();
  const cli = (args) => execFileSync("node", [CLI, ...args], { cwd: root });
  cli(["pass-gate", "init", "--issue", "1", "--evaluation-id", "e", "--verdict", "PROCEED"]);
  cli(["start-phase", "discuss", "--issue", "1"]);
  cli(["complete-phase", "discuss", "--issue", "1"]);
  for (const ph of ["design", "test-spec", "dev-plan"]) {
    cli(["start-phase", ph, "--issue", "1"]);
    cli(["pass-gate", ph, "--issue", "1", "--evaluation-id", "e", "--verdict", "PROCEED"]);
  }
  cli(["start-phase", "implement", "--issue", "1"]);
  assert.equal(hook(root, "Edit", path.join(root, "src/app.ts")), null);
  assert.equal(hook(root, "Edit", path.join(root, ".codiel/specs/screen-login/cases.md")).permissionDecision, "ask");
  assert.equal(hook(root, "Edit", path.join(root, ".codiel/specs/screen-login/spec.md")).permissionDecision, "ask");
  assert.equal(hook(root, "Write", path.join(root, ".codiel/specs/screen-login/scripts/login.spec.ts")), null);
});

test("cwd がサブディレクトリでも state.json への絶対パス書き込みは deny(バイパス再現)", () => {
  const root = setupRun();
  const srcDir = path.join(root, "src");
  fs.mkdirSync(srcDir, { recursive: true });
  const abs = path.join(root, ".codiel/runs/issue-1/try-1/state.json");
  const r = hook(srcDir, "Write", abs);
  assert.equal(r.permissionDecision, "deny");
});

test("state.json 保護は大文字パスでもバイパスされない(ケース非依存)", () => {
  const root = setupRun();
  const abs = path.join(root, ".CODIEL/RUNS/issue-1/try-1/state.json");
  const r = hook(root, "Write", abs);
  assert.equal(r.permissionDecision, "deny");
});

test("discuss フェーズ中: .codiel 配下(agenda.md/discussion.md)は素通し、src への書き込みは ask", () => {
  const root = setupRun();
  const cli = (args) => execFileSync("node", [CLI, ...args], { cwd: root });
  cli(["pass-gate", "init", "--issue", "1", "--evaluation-id", "e", "--verdict", "PROCEED"]);
  cli(["start-phase", "discuss", "--issue", "1"]);
  assert.equal(hook(root, "Write", path.join(root, ".codiel/runs/issue-1/try-1/agenda.md")), null);
  assert.equal(hook(root, "Write", path.join(root, ".codiel/runs/issue-1/try-1/discussion.md")), null);
  assert.equal(hook(root, "Write", path.join(root, "src/app.ts")).permissionDecision, "ask");
});

test("cwd がサブディレクトリでも文書フェーズ制御が機能する(root/src への書き込みは ask)", () => {
  const root = setupRun();
  const srcDir = path.join(root, "src");
  fs.mkdirSync(srcDir, { recursive: true });
  const r = hook(srcDir, "Write", path.join(root, "src/app.ts"));
  assert.equal(r.permissionDecision, "ask");
});
