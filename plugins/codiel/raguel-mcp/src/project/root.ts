/**
 * プロジェクトルート・projectId・置き場の解決(設計書 §6.9.1)。
 * プロジェクトルートは codiel の `findMainRoot`・`findProjectRoot`
 * (`plugins/codiel/src/hooks/lib.ts`)と同じアルゴリズムで決める。codiel の src は import しない。
 */

import { execFileSync } from "node:child_process"
import { createHash } from "node:crypto"
import fs from "node:fs"
import os from "node:os"
import path from "node:path"

// codiel の worktree の置き場。区切りは `/` と `\` の両方を受ける。
const CODIEL_WORKTREES_RE = /[/\\]\.codiel[/\\]worktrees[/\\]/

/** 既定の置き場。設定に `storage.casesDir` が無いときに使う。 */
export const DEFAULT_CASES_DIR = "~/.raguel"

/**
 * プロジェクトルート(`.codiel/config.json` を探すディレクトリ)を返す。
 *
 * 1. cwd が `/.codiel/worktrees/` を含むなら、最初に現れるその位置より前を返す(git は呼ばない)。
 * 2. cwd から親へたどり、`.codiel` を持つ最初のディレクトリを返す。
 * 3. 見つからなければ cwd を返す。
 * 返すのは論理パスで、実体化しない。
 */
export function resolveProjectRoot(cwd: string): string {
  const m = CODIEL_WORKTREES_RE.exec(cwd)
  // ルート直下(`/.codiel/worktrees/…`)では空文字列にせず、区切りの 1 文字を返す
  if (m) return cwd.slice(0, m.index) || cwd.slice(0, 1)
  let dir = cwd
  while (true) {
    if (fs.existsSync(path.join(dir, ".codiel"))) return dir
    const parent = path.dirname(dir)
    if (parent === dir) return cwd
    dir = parent
  }
}

function realpathOrResolve(p: string): string {
  try {
    return fs.realpathSync(p)
  } catch {
    return path.resolve(p)
  }
}

/** git の共通ディレクトリの実体パス。git の管理外(または git が無い)なら null。 */
function gitCommonDir(dir: string): string | null {
  try {
    const out = execFileSync(
      "git",
      ["-C", dir, "rev-parse", "--path-format=absolute", "--git-common-dir"],
      { encoding: "utf-8", stdio: ["ignore", "pipe", "ignore"] }
    ).trim()
    return out ? realpathOrResolve(out) : null
  } catch {
    return null
  }
}

/**
 * projectId を返す。`storage.projectId` があればそれを使う。
 * 無ければ git の共通ディレクトリの実体パスから `<名前>-<sha256 の先頭 12 文字>` を作る。
 * 共通ディレクトリの basename が `.git` ならその親の basename、そうでなければ末尾の `.git` を除いた basename が名前である。
 * git の管理外では、プロジェクトルートの実体パスで同じ形を作る。
 */
export function resolveProjectId(
  projectRoot: string,
  storageProjectId?: string
): string {
  if (storageProjectId) return storageProjectId
  const common = gitCommonDir(projectRoot)
  const base = common ?? realpathOrResolve(projectRoot)
  let name: string
  if (common === null) name = path.basename(base)
  else if (path.basename(base) === ".git")
    name = path.basename(path.dirname(base))
  else name = path.basename(base).replace(/\.git$/, "")
  const hash = createHash("sha256").update(base).digest("hex").slice(0, 12)
  return `${name}-${hash}`
}

/** `storage.casesDir` を解決する。無ければ `~/.raguel`。`~` はホームディレクトリへ展開する。 */
export function resolveCasesDir(configured?: string): string {
  const dir = configured || DEFAULT_CASES_DIR
  if (dir === "~") return os.homedir()
  if (dir.startsWith("~/") || dir.startsWith("~\\"))
    return path.join(os.homedir(), dir.slice(2))
  return dir
}
