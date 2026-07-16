import { execFileSync } from "node:child_process"
import fs from "node:fs"
import os from "node:os"
import path from "node:path"
import { expect, test } from "vitest"
import { diffBetween, headCommit, snapshotWorktree } from "../git.js"

function git(dir: string, ...args: string[]): string {
  return execFileSync("git", args, { cwd: dir, encoding: "utf8" })
}

function withRepo(fn: (dir: string) => void) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "pitcrew-git-"))
  try {
    git(dir, "init", "-q")
    git(dir, "config", "user.email", "t@example.com")
    git(dir, "config", "user.name", "t")
    fn(dir)
  } finally {
    fs.rmSync(dir, { recursive: true, force: true })
  }
}

test("スナップショット間の diff に変更内容と対象パスが出る", () => {
  withRepo((dir) => {
    fs.writeFileSync(path.join(dir, "a.ts"), "const a = 1\n")
    git(dir, "add", "-A")
    git(dir, "commit", "-qm", "init")
    const base = snapshotWorktree(dir)
    expect(base).toBeTruthy()
    fs.writeFileSync(path.join(dir, "a.ts"), "const a = 2\n")
    fs.writeFileSync(path.join(dir, "b.ts"), "const b = 1\n") // 未追跡
    const head = snapshotWorktree(dir)
    if (!base || !head) throw new Error("unreachable")
    const { diff, paths } = diffBetween(dir, base, head)
    expect(paths.sort()).toEqual(["a.ts", "b.ts"])
    expect(diff).toContain("-const a = 1")
    expect(diff).toContain("+const a = 2")
    expect(diff).toContain("+const b = 1")
  })
})

test("変更がなければ diff は空・paths も空", () => {
  withRepo((dir) => {
    fs.writeFileSync(path.join(dir, "a.ts"), "x\n")
    const s1 = snapshotWorktree(dir)
    const s2 = snapshotWorktree(dir)
    if (!s1 || !s2) throw new Error("unreachable")
    const { diff, paths } = diffBetween(dir, s1, s2)
    expect(diff.trim()).toBe("")
    expect(paths).toEqual([])
  })
})

test(".pitcrew/ 配下はスナップショットに含めない", () => {
  withRepo((dir) => {
    const base = snapshotWorktree(dir)
    fs.mkdirSync(path.join(dir, ".pitcrew", "review"), { recursive: true })
    fs.writeFileSync(path.join(dir, ".pitcrew", "review", "001.md"), "x")
    const head = snapshotWorktree(dir)
    if (!base || !head) throw new Error("unreachable")
    expect(diffBetween(dir, base, head).paths).toEqual([])
  })
})

test("コミットゼロのリポジトリでもスナップショットが取れ、headCommit は null", () => {
  withRepo((dir) => {
    fs.writeFileSync(path.join(dir, "a.ts"), "x\n")
    expect(snapshotWorktree(dir)).toBeTruthy()
    expect(headCommit(dir)).toBeNull()
  })
})

test("git リポジトリでないディレクトリでは null を返す", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "pitcrew-nogit-"))
  try {
    expect(snapshotWorktree(dir)).toBeNull()
    expect(headCommit(dir)).toBeNull()
  } finally {
    fs.rmSync(dir, { recursive: true, force: true })
  }
})
