import { createHash } from "node:crypto"
import * as fs from "node:fs"
import * as path from "node:path"
import { afterEach, describe, expect, it } from "vitest"
import { collectFilesSubject, MAX_FILE_BYTES } from "../files"
import { SubjectInputError } from "../types"
import { git, makeRepo, makeTmpDir, writeFile } from "./helpers/gitRepo"

const sha = (s: string | Buffer) => createHash("sha256").update(s).digest("hex")

const dirs: string[] = []
function track(dir: string): string {
  dirs.push(dir)
  return dir
}

afterEach(() => {
  for (const d of dirs.splice(0)) fs.rmSync(d, { recursive: true, force: true })
})

describe("collectFilesSubject", () => {
  it("見出し行でつないだ本文と、見出し行の位置・sha256・isNew・HEAD を返す", () => {
    const repo = track(makeRepo({ "docs/design.md": "# 設計\n本文\n" }))
    const head = git(repo, "rev-parse", "HEAD")
    // 追跡されていないファイルも読む。本文の中の見出しに似た行は見出しにしない
    writeFile(repo, "docs/plan.md", "=== fake ===\n計画\n")

    const r = collectFilesSubject({
      projectRoot: repo,
      paths: ["docs/design.md", "docs/plan.md"]
    })
    expect(r.body.text).toBe(
      [
        "=== docs/design.md ===",
        "# 設計",
        "本文",
        "=== docs/plan.md ===",
        "=== fake ===",
        "計画"
      ].join("\n")
    )
    expect(r.body.headingLines).toEqual([0, 3])
    expect(r.subject).toEqual({
      repoPath: repo,
      head,
      paths: ["docs/design.md", "docs/plan.md"],
      files: [
        { path: "docs/design.md", sha256: sha("# 設計\n本文\n"), isNew: false },
        {
          path: "docs/plan.md",
          sha256: sha("=== fake ===\n計画\n"),
          isNew: true
        }
      ]
    })
  })

  it("repoPath の外を指すパスとシンボリックリンク越しのパスを拒む", () => {
    const repo = track(makeRepo({ "a.md": "a\n" }))
    const outside = track(makeTmpDir())
    fs.writeFileSync(path.join(outside, "secret.md"), "secret\n")
    fs.symlinkSync(path.join(outside, "secret.md"), path.join(repo, "link.md"))
    fs.symlinkSync(outside, path.join(repo, "linkdir"))

    for (const p of ["../x.md", "link.md", "linkdir/secret.md", "/etc/hosts"]) {
      expect(() =>
        collectFilesSubject({ projectRoot: repo, paths: [p] })
      ).toThrow(SubjectInputError)
    }
  })

  it("1 MB を超えるファイル・UTF-8 でないファイル・ディレクトリ・無いファイルを拒む", () => {
    const repo = track(makeRepo({ "a.md": "a\n" }))
    writeFile(repo, "big.md", "x".repeat(MAX_FILE_BYTES + 1))
    writeFile(repo, "exact.md", "x".repeat(MAX_FILE_BYTES))
    writeFile(repo, "bin.md", Buffer.from([0x61, 0xff, 0xfe, 0x62]))
    fs.mkdirSync(path.join(repo, "dir"))

    expect(() =>
      collectFilesSubject({ projectRoot: repo, paths: ["big.md"] })
    ).toThrow(/バイトを超える/)
    expect(
      collectFilesSubject({ projectRoot: repo, paths: ["exact.md"] }).subject
        .files
    ).toHaveLength(1)
    expect(() =>
      collectFilesSubject({ projectRoot: repo, paths: ["bin.md"] })
    ).toThrow(/UTF-8/)
    expect(() =>
      collectFilesSubject({ projectRoot: repo, paths: ["dir"] })
    ).toThrow(/通常のファイル/)
    expect(() =>
      collectFilesSubject({ projectRoot: repo, paths: ["nope.md"] })
    ).toThrow(/無い/)
  })

  it("paths は 1〜20 件に限る", () => {
    const repo = track(makeRepo({ "a.md": "a\n" }))
    expect(() => collectFilesSubject({ projectRoot: repo, paths: [] })).toThrow(
      SubjectInputError
    )
    expect(() =>
      collectFilesSubject({
        projectRoot: repo,
        paths: Array.from({ length: 21 }, () => "a.md")
      })
    ).toThrow(SubjectInputError)
  })

  it("git の管理外のプロジェクトでは HEAD を null にして読む", () => {
    const plain = track(makeTmpDir())
    fs.writeFileSync(path.join(plain, "a.md"), "a\n")
    const r = collectFilesSubject({ projectRoot: plain, paths: ["a.md"] })
    expect(r.subject.head).toBeNull()
    expect(r.subject.files).toEqual([
      { path: "a.md", sha256: sha("a\n"), isNew: true }
    ])
  })
})
