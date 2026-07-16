import { execFileSync } from "node:child_process"
import fs from "node:fs"
import os from "node:os"
import path from "node:path"

// diff の base 管理(設計書 §4)。作業ツリーの状態を一時 index + write-tree で
// tree オブジェクト化する。git stash create は未追跡ファイルを含まず、
// コミットゼロのリポジトリで失敗するため使わない。
// 作業ツリー・本物の index・HEAD には一切影響しない。

function git(
  projectDir: string,
  args: string[],
  env?: Record<string, string>
): string {
  return execFileSync("git", args, {
    cwd: projectDir,
    encoding: "utf8",
    stdio: ["ignore", "pipe", "ignore"],
    env: { ...process.env, ...env }
  })
}

export function snapshotWorktree(projectDir: string): string | null {
  const tmpIndex = path.join(
    os.tmpdir(),
    `pitcrew-index-${process.pid}-${Date.now()}`
  )
  try {
    const env = { GIT_INDEX_FILE: tmpIndex }
    // 本物の index を一時 index にコピーしてから作業ツリーの全変更を乗せる
    // (追跡済みの削除・未追跡の追加も -A で反映される)
    try {
      git(projectDir, ["read-tree", "HEAD"], env)
    } catch {
      // unborn HEAD(コミットゼロ): 空 index から始める
      git(projectDir, ["read-tree", "--empty"], env)
    }
    git(projectDir, ["add", "-A", "--", ".", ":!.pitcrew"], env)
    return git(projectDir, ["write-tree"], env).trim()
  } catch {
    return null
  } finally {
    fs.rmSync(tmpIndex, { force: true })
  }
}

export function diffBetween(
  projectDir: string,
  baseTree: string,
  headTree: string
): { diff: string; paths: string[] } {
  const diff = git(projectDir, [
    "diff",
    "--no-color",
    "--no-ext-diff",
    baseTree,
    headTree
  ])
  const nameOnly = git(projectDir, ["diff", "--name-only", baseTree, headTree])
  return {
    diff,
    paths: nameOnly.split("\n").filter((p) => p.trim() !== "")
  }
}

export function headCommit(projectDir: string): string | null {
  try {
    return git(projectDir, ["rev-parse", "--short", "HEAD"]).trim()
  } catch {
    return null
  }
}

// 初回捕捉時の diff base(設計書 §4 の「または HEAD」)。HEAD の tree を返し、
// unborn HEAD(コミットゼロ)のときは空 tree にフォールバックする。
export function baselineTree(projectDir: string): string | null {
  try {
    return git(projectDir, ["rev-parse", "HEAD^{tree}"]).trim()
  } catch {
    try {
      return git(projectDir, ["hash-object", "-t", "tree", "/dev/null"]).trim()
    } catch {
      return null
    }
  }
}
