import fs from "node:fs";
import path from "node:path";

export async function readStdin() {
  let data = "";
  for await (const chunk of process.stdin) data += chunk;
  return JSON.parse(data);
}

export function emit(decision, reason) {
  process.stdout.write(JSON.stringify({
    hookSpecificOutput: {
      hookEventName: "PreToolUse",
      permissionDecision: decision,
      permissionDecisionReason: reason,
    },
  }) + "\n");
  process.exit(0);
}

// 「意見なし」の素通し。permissionDecision: "allow" は許可システムをバイパスして
// 自動実行になってしまうため、素通しでは何も出力せずに終了する。
export function pass() {
  process.exit(0);
}

export function globToRegExp(glob) {
  let re = "";
  for (let i = 0; i < glob.length; i++) {
    const c = glob[i];
    if (c === "*") {
      if (glob[i + 1] === "*") { re += ".*"; i++; if (glob[i + 1] === "/") i++; }
      else re += "[^/]*";
    } else if (c === "?") re += "[^/]";
    else re += c.replace(/[.+^${}()|[\]\\]/g, "\\$&");
  }
  return new RegExp(`^${re}$`);
}

export function readDomains(root) {
  const p = path.join(root, "docs", "ARCHITECTURE.md");
  if (!fs.existsSync(p)) return null;
  const m = fs.readFileSync(p, "utf8").match(/```json codiel:domains\n([\s\S]*?)```/);
  if (!m) return null;
  try { return JSON.parse(m[1]); } catch { return null; }
}

// startDir から上方向に `.codiel` ディレクトリを持つ祖先を探す。
// 見つかればそのディレクトリを、見つからなければ startDir をそのまま返す(フォールバック)。
// cwd がプロジェクトルートのサブディレクトリの場合でも、run 探索やフェーズ制御を
// プロジェクトルート基準で行えるようにするためのもの。
export function findProjectRoot(startDir) {
  let dir = startDir;
  while (true) {
    if (fs.existsSync(path.join(dir, ".codiel"))) return dir;
    const parent = path.dirname(dir);
    if (parent === dir) return startDir;
    dir = parent;
  }
}
