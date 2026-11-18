import fs from "node:fs"
import path from "node:path"
import { expect, test } from "vitest"
import {
  fakeBin,
  gitRepo,
  runScript,
  tmpdir,
  write
} from "./helpers/check-intent-env-fixtures.js"

// ケース番号は codiel へ移す前の番号を引き継ぐ。欠番は、出力から外した値
// (Codiel への委譲判定・`.codiel` の検出・テスト基盤の推定)のケースである。
// 設計: harness-docs/design/2026-09-27-codiel-intent-driven-design.md §6.9.3・§8.3

// ---------------------------------------------------------------------------
// ケース 1〜5: git とリモート
// ---------------------------------------------------------------------------

test("ケース 1: git リポジトリでないディレクトリでも exit 0 で事実を返す", () => {
  const dir = tmpdir()
  const out = runScript(dir)
  expect(out.isGitRepo).toBe(false)
  expect(out.repoRoot).toBe(null)
  expect(out.repoSlug).toBe(null)
  expect(out.remoteUrl).toBe(null)
  // git 管理外・設定ファイル無しでは docRoot は開始ディレクトリ(契約 §3 規則 1 の段 3)
  expect(out.docRoot).toBe(dir)
  expect(out.intentsDir).toBe(null)
})

test("ケース 2: リモート未設定の git リポジトリ", () => {
  const dir = gitRepo()
  const out = runScript(dir)
  expect(out.isGitRepo).toBe(true)
  expect(out.repoRoot).toBe(dir)
  expect(out.remoteUrl).toBe(null)
  expect(out.repoSlug).toBe(null)
})

test("ケース 3: SSH 形式の GitHub リモートから repoSlug を抽出する", () => {
  const out = runScript(gitRepo("git@github.com:owner/my-repo.git"))
  expect(out.remoteUrl).toBe("git@github.com:owner/my-repo.git")
  expect(out.repoSlug).toBe("owner/my-repo")
})

test("ケース 4: HTTPS 形式は .git の有無を問わず repoSlug を抽出する", () => {
  expect(runScript(gitRepo("https://github.com/owner/my-repo")).repoSlug).toBe(
    "owner/my-repo"
  )
  expect(
    runScript(gitRepo("https://github.com/owner/my-repo.git")).repoSlug
  ).toBe("owner/my-repo")
})

test("ケース 5: GitHub 以外のリモートでは repoSlug が null", () => {
  expect(runScript(gitRepo("git@gitlab.com:owner/repo.git")).repoSlug).toBe(
    null
  )
  expect(runScript(gitRepo("git@notgithub.com:owner/repo.git")).repoSlug).toBe(
    null
  )
  expect(runScript(gitRepo("https://mygithub.com/owner/repo")).repoSlug).toBe(
    null
  )
})

test("ケース 3b: SSH 形式の *.ghe.com リモートからも repoSlug を抽出する", () => {
  const out = runScript(gitRepo("git@example.ghe.com:owner/my-repo.git"))
  expect(out.remoteHost).toBe("example.ghe.com")
  expect(out.repoSlug).toBe("owner/my-repo")
})

test("ケース 4b: HTTPS 形式の *.ghe.com リモートからも repoSlug を抽出する", () => {
  const out = runScript(gitRepo("https://example.ghe.com/owner/my-repo"))
  expect(out.remoteHost).toBe("example.ghe.com")
  expect(out.repoSlug).toBe("owner/my-repo")
})

test("ケース 5b: GHES の独自ドメインでは repoSlug が null で remoteHost に値が入る", () => {
  const out = runScript(gitRepo("git@git.example.com:owner/repo.git"))
  expect(out.remoteHost).toBe("git.example.com")
  expect(out.repoSlug).toBe(null)
})

test("ケース 5c: remoteHost はリモート未設定なら null", () => {
  expect(runScript(gitRepo()).remoteHost).toBe(null)
})

// ---------------------------------------------------------------------------
// ケース 6〜7: gh
// ---------------------------------------------------------------------------

test("ケース 6: gh が PATH に無ければ両方 false で exit 0", () => {
  const out = runScript(tmpdir(), [fakeBin()])
  expect(out.ghInstalled).toBe(false)
  expect(out.ghAuthenticated).toBe(false)
  expect(out.ghVersion).toBe(null)
  expect(out.ghAttachSupported).toBe(false)
})

test("ケース 7: gh スタブが exit 0 を返せば両方 true", () => {
  const out = runScript(tmpdir(), [fakeBin({ gh: "#!/bin/sh\nexit 0\n" })])
  expect(out.ghInstalled).toBe(true)
  expect(out.ghAuthenticated).toBe(true)
})

test("ケース 7 補: gh はあるが未認証なら ghAuthenticated だけ false", () => {
  const bin = fakeBin({
    gh: '#!/bin/sh\n[ "$1" = "--version" ] && exit 0\nexit 1\n'
  })
  const out = runScript(tmpdir(), [bin])
  expect(out.ghInstalled).toBe(true)
  expect(out.ghAuthenticated).toBe(false)
})

// ---------------------------------------------------------------------------
// 環境判定: ghVersion / ghAttachSupported / 認証確認の --hostname 引数(A2-14)
// ---------------------------------------------------------------------------

// --version には指定バージョンを返し、それ以外の呼び出しは exit 0 を返しつつ
// 引数を 1 行ずつ logFile に追記する gh スタブ(認証確認の引数を検証するため)。
function ghStub(version: string, logFile: string): string {
  return [
    "#!/bin/sh",
    `echo "$@" >> ${logFile}`,
    'if [ "$1" = "--version" ]; then',
    `  echo "gh version ${version} (2026-09-01)"`,
    "  exit 0",
    "fi",
    "exit 0"
  ].join("\n")
}

test("環境判定: gh のバージョンと remoteHost の組み合わせで ghAttachSupported と repoSlug を判定する", () => {
  const cases = [
    {
      version: "2.45.0",
      remote: "git@github.com:owner/repo.git",
      slug: "owner/repo",
      host: "github.com",
      attach: false
    },
    {
      version: "2.98.9",
      remote: "git@github.com:owner/repo.git",
      slug: "owner/repo",
      host: "github.com",
      attach: false
    },
    {
      version: "2.99.0",
      remote: "git@github.com:owner/repo.git",
      slug: "owner/repo",
      host: "github.com",
      attach: true
    },
    {
      version: "2.100.0",
      remote: "git@github.com:owner/repo.git",
      slug: "owner/repo",
      host: "github.com",
      attach: true
    },
    {
      version: "2.99.0",
      remote: "git@example.ghe.com:owner/repo.git",
      slug: "owner/repo",
      host: "example.ghe.com",
      attach: true
    },
    {
      // GHES の独自ドメインは 2.99.0 以上でも ghAttachSupported が偽になる
      version: "2.99.0",
      remote: "git@git.example.com:owner/repo.git",
      slug: null,
      host: "git.example.com",
      attach: false
    }
  ]

  for (const c of cases) {
    const dir = gitRepo(c.remote)
    const logDir = tmpdir()
    const logFile = path.join(logDir, "gh-args.log")
    const binDir = fakeBin({ gh: ghStub(c.version, logFile) })

    const out = runScript(dir, [binDir])
    expect(out.remoteHost, `${c.remote}: remoteHost`).toBe(c.host)
    expect(out.repoSlug, `${c.remote}: repoSlug`).toBe(c.slug)
    expect(out.ghVersion, `${c.remote} v${c.version}: ghVersion`).toBe(
      c.version
    )
    expect(
      out.ghAttachSupported,
      `${c.remote} v${c.version}: ghAttachSupported`
    ).toBe(c.attach)

    const log = fs.readFileSync(logFile, "utf8")
    expect(log, `${c.remote}: gh auth status の呼び出し引数`).toContain(
      `auth status --hostname ${c.host}`
    )
  }
})

test("環境判定: remoteHost が無ければ gh auth status を --hostname なしで呼ぶ", () => {
  const logDir = tmpdir()
  const logFile = path.join(logDir, "gh-args.log")
  const binDir = fakeBin({ gh: ghStub("2.45.0", logFile) })

  const out = runScript(gitRepo(), [binDir])
  expect(out.remoteHost).toBe(null)
  expect(out.ghAuthenticated).toBe(true)

  const log = fs.readFileSync(logFile, "utf8")
  expect(log).toContain("auth status\n")
  expect(log).not.toContain("--hostname")
})

// ---------------------------------------------------------------------------
// ケース 8〜9: Issue テンプレート
// ---------------------------------------------------------------------------

test("ケース 8: テンプレート 2 件 + config.yml", () => {
  const dir = gitRepo("git@github.com:owner/repo.git")
  write(
    dir,
    ".github/ISSUE_TEMPLATE/bug_report.md",
    [
      "---",
      "name: バグ報告",
      "about: 不具合の報告",
      "labels: bug",
      "---",
      ""
    ].join("\n")
  )
  write(
    dir,
    ".github/ISSUE_TEMPLATE/feature.yml",
    [
      "name: 機能要望",
      "description: 新機能の提案",
      'labels: ["enhancement"]'
    ].join("\n")
  )
  write(
    dir,
    ".github/ISSUE_TEMPLATE/config.yml",
    "blank_issues_enabled: false\n"
  )

  const out = runScript(dir)
  expect(out.templates.map((t: { file: string }) => t.file)).toEqual([
    "bug_report.md",
    "feature.yml"
  ])
  expect(out.templates[0].name).toBe("バグ報告")
  expect(out.templates[0].about).toBe("不具合の報告")
  expect(out.templates[0].labels).toEqual(["bug"])
  expect(out.templates[1].about).toBe("新機能の提案")
  expect(out.templates[1].labels).toEqual(["enhancement"])
  expect(out.blankIssuesEnabled).toBe(false)
})

test("ケース 9: .github/ISSUE_TEMPLATE/ が無ければ空 + blankIssuesEnabled: true", () => {
  const out = runScript(gitRepo("git@github.com:owner/repo.git"))
  expect(out.templates).toEqual([])
  expect(out.blankIssuesEnabled).toBe(true)
})
