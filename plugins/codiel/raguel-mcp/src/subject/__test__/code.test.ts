import { createHash } from "node:crypto"
import * as fs from "node:fs"
import * as path from "node:path"
import { afterEach, describe, expect, it } from "vitest"
import {
  collectCodeSubject,
  MAX_DIFF_BYTES,
  parseNameStatusZ,
  resolveRepoPath
} from "../code"
import { SubjectInputError } from "../types"
import {
  commitAll,
  git,
  makeRepo,
  makeTmpDir,
  writeFile
} from "./helpers/gitRepo"

const sha = (s: string) => createHash("sha256").update(s).digest("hex")

const dirs: string[] = []
function track(dir: string): string {
  dirs.push(dir)
  return dir
}

afterEach(() => {
  for (const d of dirs.splice(0)) fs.rmSync(d, { recursive: true, force: true })
})

describe("collectCodeSubject", () => {
  it("baseRef と HEAD の差分と、ファイルごとの sha256・isNew を返す", () => {
    const repo = track(makeRepo({ "a.ts": "a\n", "old.ts": "gone\n" }))
    const base = git(repo, "rev-parse", "HEAD")
    writeFile(repo, "a.ts", "a2\n")
    writeFile(repo, "b.ts", "b\n")
    fs.rmSync(path.join(repo, "old.ts"))
    const head = commitAll(repo)

    const r = collectCodeSubject({ projectRoot: repo, baseRef: base })
    expect(r.empty).toBe(false)
    expect(r.subject).toMatchObject({ repoPath: repo, base, head })
    expect(r.subject.paths).toBeUndefined()
    expect(r.subject.files).toEqual([
      { path: "a.ts", sha256: sha("a2\n"), isNew: false },
      { path: "b.ts", sha256: sha("b\n"), isNew: true },
      { path: "old.ts", sha256: null, isNew: false }
    ])
    expect(r.diff).toContain("diff --git a/a.ts b/a.ts")
  })

  it("名前の変更は移った先のパスで載せる", () => {
    const body = "line\n".repeat(20)
    const repo = track(makeRepo({ "from.ts": body }))
    const base = git(repo, "rev-parse", "HEAD")
    git(repo, "mv", "from.ts", "to.ts")
    commitAll(repo)
    const r = collectCodeSubject({ projectRoot: repo, baseRef: base })
    expect(r.subject.files).toEqual([
      { path: "to.ts", sha256: sha(body), isNew: false }
    ])
    expect(r.diff).toContain("rename from from.ts")
  })

  it("利用者の git 設定で書式が変わらず、日本語のファイル名を引用符で囲まない", () => {
    const repo = track(makeRepo({ "x.txt": "x\n" }))
    const base = git(repo, "rev-parse", "HEAD")
    const ext = path.join(repo, "..", `${path.basename(repo)}-ext.sh`)
    fs.writeFileSync(ext, "#!/bin/sh\necho EXTERNAL\n", { mode: 0o755 })
    dirs.push(ext)
    git(repo, "config", "core.quotePath", "true")
    git(repo, "config", "diff.noprefix", "true")
    git(repo, "config", "diff.mnemonicPrefix", "true")
    git(repo, "config", "diff.external", ext)
    git(repo, "config", "color.ui", "always")
    writeFile(repo, "日本語.md", "こんにちは\n")
    writeFile(repo, "x.txt", "y\n")
    commitAll(repo)

    const r = collectCodeSubject({ projectRoot: repo, baseRef: base })
    expect(r.diff).toContain("diff --git a/x.txt b/x.txt")
    expect(r.diff).toContain("diff --git a/日本語.md b/日本語.md")
    expect(r.diff).toContain("+++ b/日本語.md")
    expect(r.diff).not.toContain("EXTERNAL")
    expect(r.diff).not.toContain("\\346")
    expect(r.diff).not.toContain("\u001b[")
    expect(r.subject.files.map((f) => f.path)).toEqual(["x.txt", "日本語.md"])
  })

  it("paths で範囲を絞り、パス指定を文字どおりに解釈する", () => {
    const repo = track(makeRepo({ "a.md": "a\n", "b.md": "b\n" }))
    const base = git(repo, "rev-parse", "HEAD")
    writeFile(repo, "a.md", "a2\n")
    writeFile(repo, "b.md", "b2\n")
    commitAll(repo)

    const narrowed = collectCodeSubject({
      projectRoot: repo,
      baseRef: base,
      paths: ["a.md"]
    })
    expect(narrowed.subject.paths).toEqual(["a.md"])
    expect(narrowed.subject.files.map((f) => f.path)).toEqual(["a.md"])

    const glob = collectCodeSubject({
      projectRoot: repo,
      baseRef: base,
      paths: ["*.md"]
    })
    expect(glob.empty).toBe(true)
  })

  it("未コミットの変更があれば入力の誤りにし、未追跡のファイルは見ない", () => {
    const repo = track(makeRepo({ "a.ts": "a\n", "b.ts": "b\n" }))
    const base = git(repo, "rev-parse", "HEAD")
    writeFile(repo, "untracked.ts", "u\n")
    expect(collectCodeSubject({ projectRoot: repo, baseRef: base }).empty).toBe(
      true
    )

    writeFile(repo, "a.ts", "dirty\n")
    expect(() =>
      collectCodeSubject({ projectRoot: repo, baseRef: base })
    ).toThrow(SubjectInputError)
    // paths の範囲の外にある変更は妨げない
    expect(
      collectCodeSubject({ projectRoot: repo, baseRef: base, paths: ["b.ts"] })
        .empty
    ).toBe(true)
  })

  it("空の差分は入力の誤りにせず、空であることと subject を返す", () => {
    const repo = track(makeRepo({ "a.ts": "a\n" }))
    const head = git(repo, "rev-parse", "HEAD")
    const r = collectCodeSubject({ projectRoot: repo, baseRef: "HEAD" })
    expect(r).toEqual({
      empty: true,
      diff: "",
      subject: { repoPath: repo, head, base: head, files: [] }
    })
  })

  it("空の差分でも paths の範囲に未コミットの変更があれば入力の誤りを先に返す", () => {
    const repo = track(makeRepo({ "a.ts": "a\n" }))
    writeFile(repo, "a.ts", "dirty\n")
    expect(() =>
      collectCodeSubject({
        projectRoot: repo,
        baseRef: "HEAD",
        paths: ["a.ts"]
      })
    ).toThrow(/未コミットの変更/)
  })

  it("- で始まる baseRef と解決できない baseRef を拒む", () => {
    const repo = track(makeRepo({ "a.ts": "a\n" }))
    expect(() =>
      collectCodeSubject({ projectRoot: repo, baseRef: "--output=/tmp/x" })
    ).toThrow(/- で始められない/)
    expect(() =>
      collectCodeSubject({ projectRoot: repo, baseRef: "no-such-ref" })
    ).toThrow(SubjectInputError)
  })

  it("repoPath の外へ出る paths を拒む", () => {
    const repo = track(makeRepo({ "a.ts": "a\n" }))
    for (const p of ["../x", "/etc/passwd", ""]) {
      expect(() =>
        collectCodeSubject({ projectRoot: repo, baseRef: "HEAD", paths: [p] })
      ).toThrow(SubjectInputError)
    }
  })

  it("差分が 20 MB を超えたら入力の誤りにする", () => {
    const repo = track(makeRepo({ "a.txt": "a\n" }))
    const line = `${"x".repeat(99)}\n`
    writeFile(repo, "big.txt", line.repeat(MAX_DIFF_BYTES / 100 + 1000))
    commitAll(repo)
    expect(() =>
      collectCodeSubject({ projectRoot: repo, baseRef: "HEAD~1" })
    ).toThrow(/上限/)
  }, 30000)
})

describe("resolveRepoPath", () => {
  it("省略時はプロジェクトルートを返す", () => {
    expect(resolveRepoPath(undefined, "/some/root")).toBe("/some/root")
  })

  it("同じリポジトリの別の worktree を受け、その worktree で差分を取る", () => {
    const repo = track(makeRepo({ "a.ts": "a\n" }))
    const wt = path.join(track(makeTmpDir()), "wt")
    git(repo, "worktree", "add", "-q", "-b", "feature", wt)
    const base = git(wt, "rev-parse", "HEAD")
    writeFile(wt, "a.ts", "wt\n")
    const head = commitAll(wt)

    expect(resolveRepoPath(wt, repo)).toBe(wt)
    // メインの作業ツリーがプロジェクトルートの worktree でも通る
    expect(resolveRepoPath(repo, wt)).toBe(repo)
    const r = collectCodeSubject({
      projectRoot: repo,
      repoPath: wt,
      baseRef: base
    })
    expect(r.subject).toMatchObject({ repoPath: wt, head, base })
  })

  it("別のリポジトリ・相対パス・無いディレクトリを拒む", () => {
    const repo = track(makeRepo())
    const other = track(makeRepo())
    expect(() => resolveRepoPath(other, repo)).toThrow(/別のリポジトリ/)
    expect(() => resolveRepoPath("relative/dir", repo)).toThrow(/絶対パス/)
    expect(() => resolveRepoPath(path.join(repo, "nope"), repo)).toThrow(
      SubjectInputError
    )
  })

  it("git の管理外のディレクトリを拒み、プロジェクトルートが管理外なら repoPath を受けない", () => {
    const repo = track(makeRepo())
    const plain = track(makeTmpDir())
    expect(() => resolveRepoPath(plain, repo)).toThrow(/作業ツリーでない/)
    expect(() => resolveRepoPath(repo, plain)).toThrow(/管理外/)
  })
})

describe("parseNameStatusZ", () => {
  it("名前の変更は移った先を、ほかは 1 つのパスを採る", () => {
    expect(
      parseNameStatusZ("M\0a.ts\0R100\0old name\0new\tname\0A\0x\0")
    ).toEqual([
      { status: "M", path: "a.ts" },
      { status: "R", path: "new\tname" },
      { status: "A", path: "x" }
    ])
    expect(parseNameStatusZ("")).toEqual([])
  })
})
