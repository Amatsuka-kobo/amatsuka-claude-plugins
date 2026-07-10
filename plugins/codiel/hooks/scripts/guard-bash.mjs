#!/usr/bin/env node
import { readStdin, emit, pass, findProjectRoot } from "./lib.mjs";
import { findActiveRun } from "../../scripts/codiel-state.mjs";

// git の「サブコマンド」を正規表現ではなくトークン解析で特定する。
// `\bgit\b...\bpush\b` のような正規表現は `git stash push` や `git config push.default`
// のような「push という語を含むが push サブコマンドではない」コマンドを誤検知してしまうため、
// コマンド文字列をシェル演算子で分割 → トークン化 → オプションを読み飛ばして
// 最初の非オプショントークン(=サブコマンド)を特定する方式に置き換える。
// `&&` は単独の `&`(バックグラウンド実行・複数コマンド区切り)を含むため、
// 先に `&&` を、続けて単独 `&` を試すことで `cmd1 & cmd2` のような区切りも分割できるようにする。
const SEGMENT_SPLIT_RE = /;|&&|&|\|\||\||\n/;
// git のサブコマンドより前で値を取るオプション。次のトークンが値として続く
// (`--git-dir=x` のように = で連結されている場合はそのトークン自身で完結する)。
const VALUE_TAKING_OPTS = ["-C", "--git-dir", "--work-tree", "-c"];

// トークンが git 起動を指すかどうかを判定する。`(git ...)` のようなサブシェルの
// 先頭に付く `(` を剥がした上で、`git` 完全一致、または `/usr/bin/git` のような
// 絶対パス経由の起動(`/git` で終わる)を許容する。
function isGitToken(tok) {
  const stripped = tok.replace(/^\(+/, "");
  return stripped === "git" || stripped.endsWith("/git");
}

// cmd を `;` `&&` `&` `||` `|` 改行で区切ったセグメントごとに、`git`(env 等の前置後や
// 絶対パス・サブシェルの `(` 付きでも可)トークンを探し、その直後のオプション列を
// 読み飛ばして最初の非オプショントークンをサブコマンドとして返す。
// セグメント内に複数の git 起動が残っている場合(区切り文字が全て捕捉しきれない場合)
// に備え、最初の1つだけでなく全ての git トークンを走査する。
function findGitInvocations(cmd) {
  const invocations = [];
  for (const segment of cmd.split(SEGMENT_SPLIT_RE)) {
    const tokens = segment.trim().split(/\s+/).filter(Boolean);
    let gitIdx = tokens.findIndex((tok) => isGitToken(tok));
    while (gitIdx !== -1) {
      let idx = gitIdx + 1;
      while (idx < tokens.length) {
        const tok = tokens[idx];
        if (!tok.startsWith("-")) break;
        const isValueOpt =
          VALUE_TAKING_OPTS.includes(tok) || VALUE_TAKING_OPTS.some((o) => tok.startsWith(`${o}=`));
        idx += isValueOpt && !tok.includes("=") ? 2 : 1;
      }
      const subcommand = tokens[idx];
      if (subcommand !== undefined) {
        invocations.push({ tokens, subIdx: idx, subcommand });
      }
      const rest = tokens.slice(gitIdx + 1).findIndex((tok) => isGitToken(tok));
      gitIdx = rest === -1 ? -1 : gitIdx + 1 + rest;
    }
  }
  return invocations;
}

// push サブコマンド自身に続く引数(remote・refspec・オプション)のトークン列。
function pushArgs(inv) {
  return inv.tokens.slice(inv.subIdx + 1);
}

// force push とみなすオプショントークン。`--force-with-lease`/`--force-if-includes` は
// 単純な `--force` より安全とされることがあるが、いずれも履歴書き換え push であり
// 保護対象ブランチに対して実行されればリモートの履歴を破壊し得るため deny 対象とする。
const FORCE_TOKENS = ["--force", "-f", "--force-with-lease", "--force-if-includes"];

function isForceToken(tok) {
  return FORCE_TOKENS.includes(tok) || tok.startsWith("--force-with-lease=");
}

// force push(--force / -f / --force-with-lease[=...] / --force-if-includes)を
// トークン単位で検出する。
function hasForcePush(invocations) {
  return invocations.some((inv) => inv.subcommand === "push" && pushArgs(inv).some(isForceToken));
}

// refspec の別記法(`+branch` の force 記法、`src:dest`、`refs/heads/...` 完全形)に
// 対応した保護ブランチ(main/master)宛先判定。
// トークン先頭の `+` を剥がし、`:` を含む場合は最後の `:` より後(push 先)、
// 含まない場合はトークン全体を dest とし、main/master または
// refs/heads/main・refs/heads/master に完全一致するかを見る。
function isProtectedBranchDest(token) {
  const stripped = token.startsWith("+") ? token.slice(1) : token;
  const lastColon = stripped.lastIndexOf(":");
  const dest = lastColon === -1 ? stripped : stripped.slice(lastColon + 1);
  return dest === "main" || dest === "master" || dest === "refs/heads/main" || dest === "refs/heads/master";
}

// 保護ブランチ(main/master)宛の push かどうかをトークン単位で判定する。
// remote 名(origin 固定)には依存せず、オプション(- 始まり)を除く各トークンが
// isProtectedBranchDest を満たすかを見る。これにより "main-refactor-branch" のような
// 誤 deny や、"upstream main" のような origin 以外の remote への push の見逃しを防ぐ。
function pushesToProtectedBranch(invocations) {
  return invocations.some(
    (inv) => inv.subcommand === "push" && pushArgs(inv).some((t) => !t.startsWith("-") && isProtectedBranchDest(t))
  );
}

try {
  const input = await readStdin();
  const cmd = input.tool_input?.command ?? "";
  const gitInvocations = findGitInvocations(cmd);
  const isGitPush = gitInvocations.some((inv) => inv.subcommand === "push");

  const ALWAYS_DENY = [
    [/\brm\s+(-[a-zA-Z]*r[a-zA-Z]*f|-[a-zA-Z]*f[a-zA-Z]*r)[a-zA-Z]*\s+(\/(?!tmp)|~)/.test(cmd), "作業ツリー外への rm -rf"],
    [/\b(curl|wget)\b[^|;&]*\|\s*(ba|z)?sh\b/.test(cmd), "ダウンロードしたスクリプトの直接実行(curl | sh)"],
    [hasForcePush(gitInvocations), "force push"],
    [pushesToProtectedBranch(gitInvocations), "保護ブランチ(main/master)への push"],
    [/(>|>>|\btee\b|\bsed\s+-i\b)[^\n]*\.codiel\/runs\/[^\s]*state\.json/.test(cmd), "state.json へのシェル経由の書き込み"],
    [/\b(cp|mv|dd|install)\b[^\n;|&]*\.codiel\/runs\/[^\s]*state\.json/.test(cmd), "state.json への cp/mv/dd/install 経由の書き込み"],
  ];
  for (const [triggered, why] of ALWAYS_DENY) if (triggered) emit("deny", `禁止コマンド: ${why}`);

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
    if (isGitPush && (!["pr", "fix-loop", "triage", "finalize"].includes(phase) || !testLoopPassed))
      emit("deny", `push は test-loop 合格後の pr 以降のフェーズでのみ可能です(現在: ${phase})`);
  }
  pass();
} catch (e) {
  emit("ask", `guard-bash の内部エラー(フェイルクローズド): ${e.message}`);
}
