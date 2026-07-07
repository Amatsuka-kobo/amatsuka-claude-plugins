#!/usr/bin/env node
import { readStdin, emit, findProjectRoot } from "./lib.mjs";
import { findActiveRun } from "../../scripts/codiel-state.mjs";

try {
  const input = await readStdin();
  const cmd = input.tool_input?.command ?? "";

  const ALWAYS_DENY = [
    [/\brm\s+(-[a-zA-Z]*r[a-zA-Z]*f|-[a-zA-Z]*f[a-zA-Z]*r)[a-zA-Z]*\s+(\/(?!tmp)|~)/, "作業ツリー外への rm -rf"],
    [/\b(curl|wget)\b[^|;&]*\|\s*(ba|z)?sh\b/, "ダウンロードしたスクリプトの直接実行(curl | sh)"],
    [/\bgit\s+push\b[^\n;&|]*(\s--force\b|\s-f\b)/, "force push"],
    [/\bgit\s+push\b[^\n;&|]*\s(origin\s+(main|master)\b|\S+:(main|master)\b)/, "保護ブランチ(main/master)への push"],
    [/(>|>>|\btee\b|\bsed\s+-i\b)[^\n]*\.codiel\/runs\/[^\s]*state\.json/, "state.json へのシェル経由の書き込み"],
  ];
  for (const [re, why] of ALWAYS_DENY) if (re.test(cmd)) emit("deny", `禁止コマンド: ${why}`);

  const root = findProjectRoot(input.cwd);
  const run = findActiveRun(root);
  if (run && run.state.status === "active") {
    const phase = run.state.phase;
    const testLoopPassed = run.state.phases["test-loop"]?.status === "passed";
    if (/\bgh\s+issue\s+create\b/.test(cmd) && phase !== "triage")
      emit("deny", `gh issue create は triage フェーズでのみ実行できます(現在: ${phase})`);
    if (/\bgh\s+pr\s+create\b/.test(cmd) && (phase !== "pr" || !testLoopPassed))
      emit("deny", `PR 作成は pr フェーズかつ test-loop 合格後のみ可能です(現在: ${phase}, test-loop passed: ${testLoopPassed})`);
    if (/\bgit\s+push\b/.test(cmd) && (!["pr", "fix-loop", "triage", "finalize"].includes(phase) || !testLoopPassed))
      emit("deny", `push は test-loop 合格後の pr 以降のフェーズでのみ可能です(現在: ${phase})`);
  }
  emit("allow", "");
} catch (e) {
  emit("ask", `guard-bash の内部エラー(フェイルクローズド): ${e.message}`);
}
