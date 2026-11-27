// 契約 `harness-docs/design/2026-08-16-file-contract-freeze.md` §2・§3 の検証。
// ケース ID は metatron 設計書 §13-1 の config.ts の表(C1〜C12)に対応する。
// 末尾の追加ケースは契約 §14 の「検証する構成」に対応する。

import { execFileSync, spawnSync } from "node:child_process"
import fs from "node:fs"
import os from "node:os"
import path from "node:path"
import { afterAll, expect, test } from "vitest"
import {
  DEFAULT_ARCHITECTURE_PATH,
  findDocRoot,
  loadConfig
} from "../config.js"

const tmpDirs: string[] = []

afterAll(() => {
  for (const dir of tmpDirs) {
    try {
      fs.rmSync(dir, { recursive: true, force: true })
    } catch {
      // 後始末の失敗はテスト結果に影響させない
    }
  }
})

// /tmp が symlink である環境(macOS 等)で段 2 の実体パスと食い違わないよう realpath で解決する。
function mkTmp(): string {
  const raw = fs.mkdtempSync(path.join(os.tmpdir(), "metatron-config-"))
  const dir = fs.realpathSync(raw)
  tmpDirs.push(dir)
  return dir
}

function mkSub(root: string, ...segments: string[]): string {
  const dir = path.join(root, ...segments)
  fs.mkdirSync(dir, { recursive: true })
  return dir
}

function writeConfig(dir: string, value: unknown): void {
  const body =
    typeof value === "string" ? value : `${JSON.stringify(value, null, 2)}\n`
  fs.writeFileSync(path.join(dir, "metatron.config.json"), body)
}

function gitInit(dir: string): void {
  execFileSync("git", ["init", "-q"], { cwd: dir, stdio: "ignore" })
}

function insideGitRepo(dir: string): boolean {
  return (
    spawnSync("git", ["rev-parse", "--show-toplevel"], {
      cwd: dir,
      encoding: "utf8"
    }).status === 0
  )
}

test("C1: 設定ファイル無し → 全項目が既定値", () => {
  const dir = mkTmp()
  const cfg = loadConfig(dir)

  expect(cfg.configExists).toBe(false)
  expect(cfg.architectureRelative).toBe(DEFAULT_ARCHITECTURE_PATH)
  expect(cfg.architecturePath).toBe(
    path.join(cfg.docRoot, "docs", "ARCHITECTURE.md")
  )
  // 「設定ファイルが無い」は正常な状態であり、警告にしない
  expect(cfg.warnings).toStrictEqual([])
})

test("C2: paths のみ指定 → 指定分だけ上書き、他は既定値", () => {
  const dir = mkTmp()
  writeConfig(dir, {
    version: 1,
    paths: { architecture: "documents/ARCH.md" }
  })
  const cfg = loadConfig(dir)

  expect(cfg.docRoot).toBe(dir)
  expect(cfg.configExists).toBe(true)
  expect(cfg.architectureRelative).toBe("documents/ARCH.md")
  expect(cfg.architecturePath).toBe(path.join(dir, "documents", "ARCH.md"))
  expect(cfg.warnings).toStrictEqual([])
})

test("C3: 壊れた JSON → 既定値 + 警告、例外を投げない", () => {
  const dir = mkTmp()
  writeConfig(dir, '{ "version": 1, "paths": ')
  const cfg = loadConfig(dir)

  expect(cfg.docRoot).toBe(dir)
  expect(cfg.configExists).toBe(true)
  expect(cfg.architectureRelative).toBe(DEFAULT_ARCHITECTURE_PATH)
  expect(cfg.warnings.length).toBeGreaterThanOrEqual(1)
})

test("C4: 未知の version → 全項目既定値 + 警告", () => {
  const dir = mkTmp()
  writeConfig(dir, {
    version: 99,
    paths: { architecture: "documents/ARCH.md" }
  })
  const cfg = loadConfig(dir)

  expect(cfg.architectureRelative).toBe(DEFAULT_ARCHITECTURE_PATH)
  expect(cfg.warnings.filter((w) => w.includes("version"))).toHaveLength(1)
})

test("C5: 絶対パス指定 → 拒否され既定値、理由を返す", () => {
  const dir = mkTmp()
  writeConfig(dir, {
    version: 1,
    paths: { architecture: "/etc/ARCHITECTURE.md" }
  })
  const cfg = loadConfig(dir)

  expect(cfg.architectureRelative).toBe(DEFAULT_ARCHITECTURE_PATH)
  expect(cfg.architecturePath).toBe(path.join(dir, "docs", "ARCHITECTURE.md"))
  // 拒否された項目は警告 1 行になる
  expect(cfg.warnings).toHaveLength(1)
  expect(cfg.warnings[0]).toContain("絶対パス")
})

test("C5b: ドライブレターと UNC の絶対パスも拒否され既定値、理由を返す", () => {
  for (const architecture of [
    "C:/ARCHITECTURE.md",
    "C:\\ARCHITECTURE.md",
    "//server/share/ARCHITECTURE.md",
    "\\\\server\\share\\ARCHITECTURE.md"
  ]) {
    const dir = mkTmp()
    writeConfig(dir, { version: 1, paths: { architecture } })
    const cfg = loadConfig(dir)
    expect(cfg.architectureRelative, architecture).toBe(
      DEFAULT_ARCHITECTURE_PATH
    )
    expect(cfg.warnings, architecture).toHaveLength(1)
    expect(cfg.warnings[0], architecture).toContain("絶対パス")
  }
})

test("C6: ../ でルート外を指す → 拒否され既定値、理由を返す", () => {
  const dir = mkTmp()
  writeConfig(dir, {
    version: 1,
    paths: { architecture: "../outside/ARCHITECTURE.md" }
  })
  const cfg = loadConfig(dir)

  expect(cfg.architectureRelative).toBe(DEFAULT_ARCHITECTURE_PATH)
  expect(cfg.architecturePath).toBe(path.join(dir, "docs", "ARCHITECTURE.md"))
  expect(cfg.warnings.some((w) => w.includes("ルート外"))).toBe(true)
})

test("C7: サブディレクトリから実行 → 最も近い祖先の設定ファイルを見つける", () => {
  const root = mkTmp()
  const mid = mkSub(root, "a")
  const leaf = mkSub(root, "a", "b")
  writeConfig(root, { version: 1, paths: { architecture: "ROOT.md" } })
  writeConfig(mid, { version: 1, paths: { architecture: "MID.md" } })

  expect(findDocRoot(leaf)).toBe(mid)
  const cfg = loadConfig(leaf)
  expect(cfg.docRoot).toBe(mid)
  expect(cfg.architecturePath).toBe(path.join(mid, "MID.md"))
})

test("C8: 設定無し + git リポジトリ → リポジトリルートが基準になる", () => {
  const root = mkTmp()
  gitInit(root)
  const sub = mkSub(root, "src", "deep")

  expect(findDocRoot(sub)).toBe(root)
  const cfg = loadConfig(sub)
  expect(cfg.docRoot).toBe(root)
  expect(cfg.architecturePath).toBe(path.join(root, "docs", "ARCHITECTURE.md"))
  expect(cfg.warnings).toStrictEqual([])
})

test("C9: 設定無し + git 管理外 → 開始ディレクトリが基準になる", () => {
  const dir = mkTmp()
  // 前提: 一時ディレクトリが git リポジトリの中に入っていないこと
  expect(insideGitRepo(dir)).toBe(false)

  expect(findDocRoot(dir)).toBe(dir)
  const cfg = loadConfig(dir)
  expect(cfg.docRoot).toBe(dir)
  expect(cfg.warnings).toStrictEqual([])
})

test("C10: repo/metatron.config.json と repo/sub/.codiel/ の併存 → findDocRoot は repo を返す", () => {
  const root = mkTmp()
  gitInit(root)
  const sub = mkSub(root, "sub")
  mkSub(root, "sub", ".codiel")
  writeConfig(root, { version: 1 })

  // .codiel の位置に引きずられない(codiel の findProjectRoot とは別概念)
  expect(findDocRoot(sub)).toBe(root)
  expect(loadConfig(sub).docRoot).toBe(root)
})

test("C11: $schema キーを含む設定 → 未知キーとして無視され、エラーにならない", () => {
  const dir = mkTmp()
  writeConfig(dir, {
    $schema: "https://example.com/metatron.schema.json",
    version: 1,
    unknownTopLevel: { nested: true },
    paths: { architecture: "docs/A.md", unknownPathKey: "x" }
  })
  const cfg = loadConfig(dir)

  expect(cfg.architectureRelative).toBe("docs/A.md")
  expect(cfg.warnings).toStrictEqual([])
})

test("C14: 廃止した paths.gotchas は未知キーとして警告なしで無視される", () => {
  const dir = mkTmp()
  writeConfig(dir, {
    version: 1,
    paths: { architecture: "docs/A.md", gotchas: "docs/G.md" }
  })
  const cfg = loadConfig(dir)

  expect(cfg.architectureRelative).toBe("docs/A.md")
  expect(cfg.warnings).toHaveLength(0)
  expect("gotchasRelative" in cfg).toBe(false)
})

test("C12: 旧キー injection は無視し、警告も出さない", () => {
  const dir = mkTmp()
  writeConfig(dir, {
    version: 1,
    injection: { enabled: "x", maxChars: -1 }
  })
  const cfg = loadConfig(dir)

  expect(cfg).not.toHaveProperty("injection")
  expect(cfg.warnings).toStrictEqual([])
})

// --- 契約 §14「検証する構成」由来の追加ケース ---

test("C13: 旧キー paths.rulesDir は無視し、警告も出さない", () => {
  const dir = mkTmp()
  writeConfig(dir, { version: 1, paths: { rulesDir: ".claude/rules/mine" } })
  const cfg = loadConfig(dir)

  expect(cfg).not.toHaveProperty("rulesDirPath")
  expect(cfg.warnings).toStrictEqual([])
})

test("R4-a: 開始ディレクトリ自身に設定ファイルがある(inclusive 探索)", () => {
  const root = mkTmp()
  gitInit(root)
  const sub = mkSub(root, "sub")
  writeConfig(sub, { version: 1 })

  // 真の親から探索を始めると root(git ルート)になってしまう
  expect(findDocRoot(sub)).toBe(sub)
})

test("R4-b: シンボリックリンク経由の開始ディレクトリ → 実体パスで解決される", () => {
  const base = mkTmp()
  const real = mkSub(base, "real")
  writeConfig(real, { version: 1, paths: { architecture: "docs/A.md" } })
  const link = path.join(base, "link")
  fs.symlinkSync(real, link, "dir")

  expect(findDocRoot(link)).toBe(real)
  const cfg = loadConfig(link)
  expect(cfg.docRoot).toBe(real)
  expect(cfg.architecturePath).toBe(path.join(real, "docs", "A.md"))
})

test("R4-c: git バイナリが無い環境 → 例外を投げず段 3 へ落ちる", () => {
  const root = mkTmp()
  gitInit(root)
  const sub = mkSub(root, "sub")
  const originalPath = process.env.PATH

  try {
    process.env.PATH = path.join(root, "no-such-bin-dir")
    expect(() => findDocRoot(sub)).not.toThrow()
    expect(findDocRoot(sub)).toBe(sub)
    const cfg = loadConfig(sub)
    expect(cfg.docRoot).toBe(sub)
    expect(cfg.warnings).toStrictEqual([])
  } finally {
    process.env.PATH = originalPath
  }
})

test("R4-d: ネストした git リポジトリ → 内側のリポジトリルートを採る", () => {
  const outer = mkTmp()
  gitInit(outer)
  const inner = mkSub(outer, "inner")
  gitInit(inner)
  const sub = mkSub(outer, "inner", "sub")

  expect(findDocRoot(sub)).toBe(inner)
})

test("R4-g: 親の設定ファイルは git の境界を越えて拾わない(親の中に置いた worktree)", () => {
  const outer = mkTmp()
  gitInit(outer)
  writeConfig(outer, { version: 1 })
  const inner = mkSub(outer, "worktrees", "x")
  gitInit(inner)
  const sub = mkSub(outer, "worktrees", "x", "sub")

  expect(findDocRoot(sub)).toBe(inner)
  writeConfig(inner, { version: 1 })
  expect(findDocRoot(sub)).toBe(inner)
})

test("R4-e: Windows 形式の区切りを含む paths → POSIX と同じ位置に解決される", () => {
  const dir = mkTmp()
  writeConfig(dir, {
    version: 1,
    paths: { architecture: "documents\\ARCH.md" }
  })
  const cfg = loadConfig(dir)

  expect(cfg.architectureRelative).toBe("documents/ARCH.md")
  expect(cfg.architecturePath).toBe(path.join(dir, "documents", "ARCH.md"))
  expect(cfg.warnings).toStrictEqual([])
})

test("R4-f: Windows 形式の区切りでのルート脱出も拒否される", () => {
  const dir = mkTmp()
  writeConfig(dir, {
    version: 1,
    paths: { architecture: "..\\outside\\ARCHITECTURE.md" }
  })
  const cfg = loadConfig(dir)

  expect(cfg.architectureRelative).toBe(DEFAULT_ARCHITECTURE_PATH)
  expect(cfg.warnings.some((w) => w.includes("ルート外"))).toBe(true)
})

test("トップレベルが配列の JSON も壊れた JSON として扱う", () => {
  const dir = mkTmp()
  writeConfig(dir, '["docs/ARCHITECTURE.md"]')
  const cfg = loadConfig(dir)

  expect(cfg.architectureRelative).toBe(DEFAULT_ARCHITECTURE_PATH)
  expect(cfg.warnings.length).toBeGreaterThanOrEqual(1)
})

test("トップレベルが null の JSON も壊れた JSON として扱う", () => {
  const dir = mkTmp()
  writeConfig(dir, "null")
  const cfg = loadConfig(dir)

  expect(cfg.architectureRelative).toBe(DEFAULT_ARCHITECTURE_PATH)
  expect(cfg.warnings.length).toBeGreaterThanOrEqual(1)
})

test("個別キーの型不整合はその項目だけ既定値に落ちる", () => {
  const dir = mkTmp()
  writeConfig(dir, {
    version: 1,
    paths: { architecture: 42 }
  })
  const cfg = loadConfig(dir)

  expect(cfg.architectureRelative).toBe(DEFAULT_ARCHITECTURE_PATH)
  expect(cfg.warnings).toHaveLength(1)
})

test("解決結果をキャッシュしない", () => {
  const dir = mkTmp()
  writeConfig(dir, { version: 1, paths: { architecture: "docs/A.md" } })
  expect(loadConfig(dir).architectureRelative).toBe("docs/A.md")

  writeConfig(dir, { version: 1, paths: { architecture: "docs/B.md" } })
  expect(loadConfig(dir).architectureRelative).toBe("docs/B.md")
})

test("存在しない開始ディレクトリでも例外を投げない", () => {
  const dir = path.join(mkTmp(), "no", "such", "dir")
  expect(() => loadConfig(dir)).not.toThrow()
  expect(loadConfig(dir).architectureRelative).toBe(DEFAULT_ARCHITECTURE_PATH)
})

// git を実行できない環境を作る。PATH を空にすると spawnSync("git") が失敗する。
function withoutGit<T>(fn: () => T): T {
  const saved = process.env.PATH
  process.env.PATH = ""
  try {
    return fn()
  } finally {
    process.env.PATH = saved
  }
}

test("R1-g1: 開始ディレクトリに設定があれば、git を実行できなくてもそこを返す", () => {
  const dir = mkTmp()
  gitInit(dir)
  const sub = mkSub(dir, "pkg")
  writeConfig(sub, { version: 1 })
  expect(withoutGit(() => findDocRoot(sub))).toBe(sub)
})

test("R1-g2: git を実行できないときは .git を持つディレクトリで探索を打ち切る", () => {
  const outer = mkTmp()
  writeConfig(outer, { version: 1 })
  const wt = mkSub(outer, "worktrees", "wt")
  // worktree の .git はファイルである
  fs.writeFileSync(path.join(wt, ".git"), "gitdir: /nonexistent\n")
  const start = mkSub(wt, "src")
  expect(withoutGit(() => findDocRoot(start))).toBe(start)
})

test("R1-g3: git も .git も無ければファイルシステムのルートまで辿る", () => {
  const outer = mkTmp()
  writeConfig(outer, { version: 1 })
  const start = mkSub(outer, "a", "b")
  expect(withoutGit(() => findDocRoot(start))).toBe(outer)
})
