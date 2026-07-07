#!/usr/bin/env node
import { readStdin, emit, findProjectRoot } from "./lib.mjs";
import { findActiveRun } from "../../scripts/codiel-state.mjs";

// git のサブコマンド前オプション(例: `git -C ../repo push`)を挟んでいても push 検知を
// バイパスできないよう、"git" と "push" の間はパイプ・セミコロン・& を跨がない任意文字を許容する。
// (パイプ越しの `git log | grep push` のような誤爆は [^\n;|&] の除外で防ぐ)
const GIT_PUSH_RE = /\bgit\b[^\n;|&]*?\bpush\b/;
// push 以降のトークン列を取り出す(同一コマンド内、パイプ・セミコロン・& の手前まで)。
const GIT_PUSH_TOKENS_RE = /\bgit\b[^\n;|&]*?\bpush\b([^\n;|&]*)/g;

// 保護ブランチ(main/master)宛の push かどうかをトークン単位で判定する。
// remote 名(origin 固定)には依存せず、オプション(- 始まり)を除く各トークンが
// main/master に完全一致、または refspec の `:main` / `:master` で終わるかを見る。
// これにより "main-refactor-branch" のような誤 deny や、"upstream main" のような
// origin 以外の remote への push の見逃しを防ぐ。
function pushesToProtectedBranch(cmd) {
  for (const m of cmd.matchAll(GIT_PUSH_TOKENS_RE)) {
    const tokens = m[1].trim().split(/\s+/).filter(Boolean);
    for (const tok of tokens) {
      if (tok.startsWith("-")) continue;
      if (tok === "main" || tok === "master") return true;
      if (tok.endsWith(":main") || tok.endsWith(":master")) return true;
    }
  }
  return false;
}

try {
  const input = await readStdin();
  const cmd = input.tool_input?.command ?? "";

  const ALWAYS_DENY = [
    [/\brm\s+(-[a-zA-Z]*r[a-zA-Z]*f|-[a-zA-Z]*f[a-zA-Z]*r)[a-zA-Z]*\s+(\/(?!tmp)|~)/, "作業ツリー外への rm -rf"],
    [/\b(curl|wget)\b[^|;&]*\|\s*(ba|z)?sh\b/, "ダウンロードしたスクリプトの直接実行(curl | sh)"],
    [new RegExp(GIT_PUSH_RE.source + "[^\\n;|&]*(\\s--force\\b|\\s-f\\b)"), "force push"],
    [/(>|>>|\btee\b|\bsed\s+-i\b)[^\n]*\.codiel\/runs\/[^\s]*state\.json/, "state.json へのシェル経由の書き込み"],
  ];
  for (const [re, why] of ALWAYS_DENY) if (re.test(cmd)) emit("deny", `禁止コマンド: ${why}`);
  if (pushesToProtectedBranch(cmd)) emit("deny", "禁止コマンド: 保護ブランチ(main/master)への push");

  const root = findProjectRoot(input.cwd);
  const run = findActiveRun(root);
  // findActiveRun は active / awaiting_human の run しか返さない。
  // 人間の判断待ち(awaiting_human)中こそ PR 作成や push を許してはならないため、
  // run が存在する限りゲートを適用する(status による分岐はしない)。
  if (run) {
    const phase = run.state.phase;
    const testLoopPassed = run.state.phases["test-loop"]?.status === "passed";
    if (/\bgh\s+issue\s+create\b/.test(cmd) && phase !== "triage")
      emit("deny", `gh issue create は triage フェーズでのみ実行できます(現在: ${phase})`);
    if (/\bgh\s+pr\s+create\b/.test(cmd) && (phase !== "pr" || !testLoopPassed))
      emit("deny", `PR 作成は pr フェーズかつ test-loop 合格後のみ可能です(現在: ${phase}, test-loop passed: ${testLoopPassed})`);
    if (GIT_PUSH_RE.test(cmd) && (!["pr", "fix-loop", "triage", "finalize"].includes(phase) || !testLoopPassed))
      emit("deny", `push は test-loop 合格後の pr 以降のフェーズでのみ可能です(現在: ${phase})`);
  }
  emit("allow", "");
} catch (e) {
  emit("ask", `guard-bash の内部エラー(フェイルクローズド): ${e.message}`);
}
