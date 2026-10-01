import { execFileSync } from "node:child_process"
import fs from "node:fs"
import os from "node:os"
import path from "node:path"
import { afterAll, beforeAll, describe, expect, it } from "vitest"
import { resolveCasesDir, resolveProjectId, resolveProjectRoot } from "../root"

const git = (cwd: string, ...args: string[]) =>
  execFileSync(
    "git",
    ["-C", cwd, "-c", "user.email=t@t", "-c", "user.name=t", ...args],
    {
      stdio: "ignore"
    }
  )

let tmp: string
let main: string
let userWt: string // 利用者の worktree(.codiel なし)
let userWtCodiel: string // 利用者の worktree(.codiel あり)
let codielWt: string // .codiel/worktrees/<slug>/<名前>
let plain: string // git の管理外

beforeAll(() => {
  tmp = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "raguel-root-")))
  main = path.join(tmp, "myrepo")
  fs.mkdirSync(path.join(main, ".codiel"), { recursive: true })
  fs.mkdirSync(path.join(main, "src", "deep"), { recursive: true })
  git(tmp, "init", "-q", main)
  git(main, "commit", "-q", "--allow-empty", "-m", "init")
  userWt = path.join(tmp, "wt-plain")
  userWtCodiel = path.join(tmp, "wt-codiel")
  codielWt = path.join(main, ".codiel", "worktrees", "slug", "feat")
  fs.mkdirSync(path.dirname(codielWt), { recursive: true })
  git(main, "worktree", "add", "-q", "-b", "b1", userWt)
  git(main, "worktree", "add", "-q", "-b", "b2", userWtCodiel)
  git(main, "worktree", "add", "-q", "-b", "b3", codielWt)
  fs.mkdirSync(path.join(userWtCodiel, ".codiel"))
  plain = path.join(tmp, "plain", "sub")
  fs.mkdirSync(plain, { recursive: true })
})

afterAll(() => {
  fs.rmSync(tmp, { recursive: true, force: true })
})

describe("resolveProjectRoot", () => {
  it("codiel の worktree の中では、メインの作業ツリーを返す", () => {
    expect(resolveProjectRoot(codielWt)).toBe(main)
    expect(resolveProjectRoot(path.join(codielWt, "x"))).toBe(main)
  })

  it("worktree の checkout に .codiel があっても、置き場のパスが優先される", () => {
    fs.mkdirSync(path.join(codielWt, ".codiel"), { recursive: true })
    expect(resolveProjectRoot(codielWt)).toBe(main)
  })

  it("利用者の worktree は .codiel を持てばそこが、持たなければ cwd がルートになる", () => {
    expect(resolveProjectRoot(userWtCodiel)).toBe(userWtCodiel)
    expect(resolveProjectRoot(userWt)).toBe(userWt)
  })

  it("git の管理外では、.codiel が無ければ cwd を返す", () => {
    expect(resolveProjectRoot(plain)).toBe(plain)
  })

  it("プロジェクトルートのサブディレクトリからは .codiel を持つ祖先を返す", () => {
    expect(resolveProjectRoot(path.join(main, "src", "deep"))).toBe(main)
  })

  it("パスが / 直下の .codiel/worktrees でも空文字列を返さない", () => {
    expect(resolveProjectRoot("/.codiel/worktrees/x")).toBe("/")
  })
})

describe("resolveProjectId", () => {
  it("どの worktree からでも同じ projectId になり、名前はリポジトリのディレクトリ名になる", () => {
    const id = resolveProjectId(main)
    expect(id).toMatch(/^myrepo-[0-9a-f]{12}$/)
    for (const wt of [userWt, userWtCodiel, codielWt, path.join(main, "src")]) {
      expect(resolveProjectId(wt)).toBe(id)
    }
  })

  it("storage.projectId があればそれを使う", () => {
    expect(resolveProjectId(main, "fixed-id")).toBe("fixed-id")
  })

  it("bare リポジトリは末尾の .git を除いた名前になる", () => {
    const bare = path.join(tmp, "server.git")
    git(tmp, "init", "-q", "--bare", bare)
    expect(resolveProjectId(bare)).toMatch(/^server-[0-9a-f]{12}$/)
  })

  it("git の管理外ではプロジェクトルートの実体パスから作る", () => {
    const id = resolveProjectId(plain)
    expect(id).toMatch(/^sub-[0-9a-f]{12}$/)
    expect(resolveProjectId(plain)).toBe(id)
    expect(id).not.toBe(resolveProjectId(main))
  })
})

describe("resolveCasesDir", () => {
  it("設定が無ければ ~/.raguel を展開する", () => {
    expect(resolveCasesDir()).toBe(path.join(os.homedir(), ".raguel"))
    expect(resolveCasesDir("")).toBe(path.join(os.homedir(), ".raguel"))
  })

  it("~ と ~/ をホームディレクトリへ展開し、それ以外は変えない", () => {
    expect(resolveCasesDir("~")).toBe(os.homedir())
    expect(resolveCasesDir("~/x/y")).toBe(path.join(os.homedir(), "x", "y"))
    expect(resolveCasesDir("/abs/cases")).toBe("/abs/cases")
  })
})
