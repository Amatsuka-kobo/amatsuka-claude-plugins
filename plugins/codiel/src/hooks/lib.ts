import fs from "node:fs";
import path from "node:path";

export interface HookInput {
  session_id?: string
  tool_name?: string
  tool_input?: { command?: string; file_path?: string; [k: string]: unknown }
  transcript_path?: string
  cwd?: string
  agent_id?: string
  agent_type?: string
  stop_hook_active?: boolean
  [k: string]: unknown
}

export async function readStdin(): Promise<HookInput> {
  let data = "";
  for await (const chunk of process.stdin) data += chunk;
  return JSON.parse(data) as HookInput;
}

export function emit(decision: "deny" | "ask", reason: string): never {
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
export function pass(): never {
  process.exit(0);
}

export function globToRegExp(glob: string): RegExp {
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

export function readDomains(root: string): unknown {
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
export function findProjectRoot(startDir: string): string {
  let dir = startDir;
  while (true) {
    if (fs.existsSync(path.join(dir, ".codiel"))) return dir;
    const parent = path.dirname(dir);
    if (parent === dir) return startDir;
    dir = parent;
  }
}
