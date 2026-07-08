import { test } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const SCRIPT = new URL("./install-harness.sh", import.meta.url).pathname;

function tmpProject() {
  return fs.mkdtempSync(path.join(os.tmpdir(), "install-harness-"));
}
function run(target) {
  return execFileSync("bash", [SCRIPT, target], { encoding: "utf8" });
}

test(".codiel 配下のディレクトリと GOTCHAS.md 雛形を作成する", () => {
  const root = tmpProject();
  run(root);
  for (const d of [".codiel/specs", ".codiel/runs", ".codiel/reports"]) {
    assert.ok(fs.existsSync(path.join(root, d)), `${d} がない`);
  }
  const gotchas = fs.readFileSync(path.join(root, "docs/GOTCHAS.md"), "utf8");
  assert.match(gotchas, /^# GOTCHAS/);
});

test("ARCHITECTURE.md / CLAUDE.md / raguel.config.yaml は作成しない(initializing-harness スキルが生成する)", () => {
  const root = tmpProject();
  run(root);
  assert.ok(!fs.existsSync(path.join(root, "docs/ARCHITECTURE.md")), "ARCHITECTURE.md を作ってはいけない");
  assert.ok(!fs.existsSync(path.join(root, "CLAUDE.md")), "CLAUDE.md を作ってはいけない");
  assert.ok(!fs.existsSync(path.join(root, "raguel.config.yaml")), "raguel.config.yaml を作ってはいけない");
});

test("既存の GOTCHAS.md は上書きしない(copy-if-absent)", () => {
  const root = tmpProject();
  fs.mkdirSync(path.join(root, "docs"), { recursive: true });
  fs.writeFileSync(path.join(root, "docs/GOTCHAS.md"), "既存の内容");
  const out = run(root);
  assert.equal(fs.readFileSync(path.join(root, "docs/GOTCHAS.md"), "utf8"), "既存の内容");
  assert.match(out, /skip\(既存\)/);
});
