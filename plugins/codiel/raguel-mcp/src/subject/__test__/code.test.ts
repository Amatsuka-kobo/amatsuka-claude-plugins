import { createHash } from "node:crypto"
import * as fs from "node:fs"
import * as path from "node:path"
import { afterEach, describe, expect, it } from "vitest"
import {
  collectCodeSubject,
  MAX_DIFF_BYTES,
  parseNameStatusZ,
  parseStatusZ,
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

  describe("attributes と NUL があっても diff に追加行の本文が入る", () => {
    function changed(): { repo: string; base: string } {
      const repo = track(makeRepo({ "x.txt": "x\n" }))
      return { repo, base: git(repo, "rev-parse", "HEAD") }
    }

    it("未追跡の .gitattributes で -diff にしても本文が入る", () => {
      const { repo, base } = changed()
      writeFile(repo, "a.txt", "ADDED_BODY\n")
      commitAll(repo)
      writeFile(repo, ".gitattributes", "* -diff\n")
      const r = collectCodeSubject({ projectRoot: repo, baseRef: base })
      expect(r.diff).toContain("+ADDED_BODY")
      expect(r.diff).not.toContain("Binary files")
    })

    it(".git/info/attributes で -diff にしても本文が入る", () => {
      const { repo, base } = changed()
      writeFile(repo, "a.txt", "ADDED_BODY\n")
      commitAll(repo)
      writeFile(repo, ".git/info/attributes", "* -diff\n")
      const r = collectCodeSubject({ projectRoot: repo, baseRef: base })
      expect(r.diff).toContain("+ADDED_BODY")
      expect(r.diff).not.toContain("Binary files")
    })

    it("NUL を含むファイルでも本文が入る", () => {
      const { repo, base } = changed()
      writeFile(repo, "a.bin", Buffer.from("ADDED_BODY\0tail\n"))
      commitAll(repo)
      const r = collectCodeSubject({ projectRoot: repo, baseRef: base })
      expect(r.diff).toContain("+ADDED_BODY")
      expect(r.diff).not.toContain("Binary files")
    })
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

  it("ignoreUncommitted に当たるパスの未コミットの変更は数えず、評価に入れない", () => {
    const repo = track(
      makeRepo({ "a.ts": "a\n", "docs/chat/log.md": "1\n", "docs/.env": "x\n" })
    )
    const base = git(repo, "rev-parse", "HEAD")
    writeFile(repo, "a.ts", "a2\n")
    const head = commitAll(repo)
    writeFile(repo, "docs/chat/log.md", "1\n2\n")
    writeFile(repo, "docs/.env", "y\n")
    git(repo, "add", "docs/.env")

    expect(() =>
      collectCodeSubject({ projectRoot: repo, baseRef: base })
    ).toThrow(/未コミットの変更/)
    // ドットで始まるファイルにも当たる(classifyPath の generated と同じ照合)
    const r = collectCodeSubject({
      projectRoot: repo,
      baseRef: base,
      ignoreUncommitted: ["docs/**"]
    })
    expect(r.subject.head).toBe(head)
    expect(r.subject.files.map((f) => f.path)).toEqual(["a.ts"])
    expect(r.diff).not.toContain("docs/chat/log.md")
  })

  it("ignoreUncommitted の外にも変更があれば入力の誤りにし、残ったパスをメッセージに出す", () => {
    const repo = track(
      makeRepo({
        "a.ts": "a\n",
        "docs/chat/log.md": "1\n",
        "src/b c.ts": "b\n"
      })
    )
    writeFile(repo, "docs/chat/log.md", "1\n2\n")
    writeFile(repo, "src/b c.ts", "dirty\n")
    const run = () =>
      collectCodeSubject({
        projectRoot: repo,
        baseRef: "HEAD",
        ignoreUncommitted: ["docs/chat/**"]
      })
    expect(run).toThrow(SubjectInputError)
    expect(run).toThrow(/M src\/b c\.ts ほか/)
    expect(run).not.toThrow(/docs\/chat/)

    // 宣言の外のパスだけの変更も、今までどおり入力の誤りになる
    git(repo, "checkout", "--", "docs/chat/log.md")
    expect(run).toThrow(/M src\/b c\.ts ほか/)
  })

  it("名前の変更は、移動元と移動先の両方が ignoreUncommitted に当たるときだけ数えない", () => {
    const body = "line\n".repeat(20)
    const repo = track(
      makeRepo({ "docs/chat/a.md": body, "src/keep.ts": body })
    )
    const collect = () =>
      collectCodeSubject({
        projectRoot: repo,
        baseRef: "HEAD",
        ignoreUncommitted: ["docs/chat/**"]
      })

    git(repo, "mv", "docs/chat/a.md", "docs/chat/b.md")
    expect(collect().empty).toBe(true)

    // 宣言の中から外へ
    git(repo, "mv", "docs/chat/b.md", "src/moved.ts")
    expect(collect).toThrow(/R docs\/chat\/a\.md -> src\/moved\.ts/)
    git(repo, "mv", "src/moved.ts", "docs/chat/a.md")

    // 宣言の外から中へ
    git(repo, "mv", "src/keep.ts", "docs/chat/keep.md")
    expect(collect).toThrow(/R src\/keep\.ts -> docs\/chat\/keep\.md/)
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

describe("parseStatusZ", () => {
  it("名前の変更とコピーは移動先の次の移動元を読み、ほかは 1 つのパスを読む", () => {
    expect(
      parseStatusZ(" M a b.ts\0R  new name\0old name\0MM x\0C  c2\0c1\0")
    ).toEqual([
      { code: " M", path: "a b.ts" },
      { code: "R ", path: "new name", from: "old name" },
      { code: "MM", path: "x" },
      { code: "C ", path: "c2", from: "c1" }
    ])
    expect(parseStatusZ("")).toEqual([])
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
