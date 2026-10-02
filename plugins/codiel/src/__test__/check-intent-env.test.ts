import { execFileSync, spawnSync } from "node:child_process"
import fs from "node:fs"
import os from "node:os"
import path from "node:path"
import { fileURLToPath } from "node:url"
import { expect, test } from "vitest"
// 契約 §14 / ケース 16f の 2 者比較のためだけの相対 import(テストコード限定)。
// codiel の実行時に metatron を参照することはない。
import { extractDomains } from "../../../metatron/src/lib/architecture.js"
import { loadConfig } from "../../../metatron/src/lib/config.js"
import {
  readDomains,
  readDomainsResult,
  resolveDocPaths
} from "../hooks/lib.js"
import { runTs } from "../testing/run-ts.js"

// ケース番号は codiel へ移す前の番号を引き継ぐ。欠番は、出力から外した値
// (Codiel への委譲判定・`.codiel` の検出・テスト基盤の推定)のケースである。
// 設計: harness-docs/design/2026-09-27-codiel-intent-driven-design.md §6.9.3・§8.3

const SCRIPT = fileURLToPath(new URL("../check-intent-env.ts", import.meta.url))

const mockEnv = (binDir: string) => ({
  ...process.env,
  PATH: `${binDir}${path.delimiter}${path.dirname(process.execPath)}`
})

// スクリプトを起動し stdout の JSON を返す。pathDirs 指定時は PATH を差し替える
// (gh / git の有無を擬似するため)
function runScript(cwd: string, pathDirs?: string[]) {
  const env = pathDirs ? mockEnv(pathDirs.join(path.delimiter)) : process.env
  const stdout = runTs(SCRIPT, [cwd], { env })
  return JSON.parse(stdout)
}

// macOS では os.tmpdir() 自体がシンボリックリンクなので実体パスへ揃える
// (docRoot は開始ディレクトリを realpath で解決する。契約 §3 規則 1 の細目)
function tmpdir(): string {
  return fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "intent-env-")))
}

function gitRepo(remoteUrl: string | null = null): string {
  const dir = tmpdir()
  execFileSync("git", ["init", "-q"], { cwd: dir })
  if (remoteUrl)
    execFileSync("git", ["remote", "add", "origin", remoteUrl], { cwd: dir })
  return dir
}

function write(dir: string, relative: string, content: string): string {
  const target = path.join(dir, relative)
  fs.mkdirSync(path.dirname(target), { recursive: true })
  fs.writeFileSync(target, content)
  return target
}

function mkdir(dir: string, relative: string): string {
  const target = path.join(dir, relative)
  fs.mkdirSync(target, { recursive: true })
  return target
}

const DOMAINS_ARCHITECTURE = [
  "# ARCHITECTURE",
  "",
  "## ドメインマップ",
  "",
  "```json metatron:domains",
  '{ "frontend": ["src/app/**"], "backend": ["src/server/**"] }',
  "```",
  ""
].join("\n")

const INTENT_DOC = (
  slug: string,
  status: string,
  issue: string,
  title: string,
  intentVersion: string = "v1"
): string =>
  [
    "---",
    `intent: ${intentVersion}`,
    `slug: ${slug}`,
    "created: 2026-08-16",
    `status: ${status}`,
    `issue: ${issue}`,
    "---",
    "",
    `# intent: ${title}`,
    "",
    "## ASIS",
    ""
  ].join("\n")

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

// PATH 制御用の bin ディレクトリ。スクリプトが spawn するのは git と gh のみ。
function fakeBin({ gh, git = true }: { gh?: string; git?: boolean } = {}) {
  const dir = tmpdir()
  if (git) {
    const realGit = execFileSync("sh", ["-c", "command -v git"], {
      encoding: "utf8"
    }).trim()
    fs.symlinkSync(realGit, path.join(dir, "git"))
  }
  if (gh) {
    const file = path.join(dir, "gh")
    fs.writeFileSync(file, gh)
    fs.chmodSync(file, 0o755)
  }
  return dir
}

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

// ---------------------------------------------------------------------------
// ケース 11〜16e: projectDocs と文書パスの解決
// ---------------------------------------------------------------------------

test("T14 回帰 7: ドメインマップの読み取り事実は従来どおり返る", () => {
  const readable = gitRepo()
  write(readable, "docs/ARCHITECTURE.md", DOMAINS_ARCHITECTURE)
  const readableOut = runScript(readable)
  expect(readableOut.projectDocs.domainsReadable).toBe(true)
  expect(readableOut.projectDocs.domainCount).toBe(2)

  const unreadable = gitRepo()
  const unreadableOut = runScript(unreadable)
  expect(unreadableOut.projectDocs.domainsReadable).toBe(false)
  expect(unreadableOut.projectDocs.domainCount).toBe(0)
})

test("ケース 11: ARCHITECTURE と GOTCHAS が無ければ projectDocs のパスは null", () => {
  const dir = gitRepo()
  const out = runScript(dir)
  expect(out.projectDocs.architecture).toBe(null)
  expect(out.projectDocs.gotchas).toBe(null)
  expect(out.projectDocs.domainCount).toBe(0)
})

test("ケース 12: ドメイン定義ブロックが壊れた JSON でも exit 0", () => {
  const dir = gitRepo()
  write(
    dir,
    "docs/ARCHITECTURE.md",
    ["```json metatron:domains", '{ "frontend": [', "```", ""].join("\n")
  )
  const out = runScript(dir)
  expect(out.projectDocs.domainsReadable).toBe(false)
  expect(out.projectDocs.domainCount).toBe(0)
})

test("ケース 16a: 旧マーカー codiel:domains は読まない", () => {
  const dir = gitRepo()
  write(
    dir,
    "docs/ARCHITECTURE.md",
    [
      "```json codiel:domains",
      '{ "frontend": ["src/app/**"] }',
      "```",
      ""
    ].join("\n")
  )
  const out = runScript(dir)
  expect(out.projectDocs.domainsReadable).toBe(false)
  expect(out.projectDocs.domainCount).toBe(0)
})

test("ケース 16b: metatron.config.json で文書パスを変更できる", () => {
  const dir = gitRepo()
  write(
    dir,
    "metatron.config.json",
    JSON.stringify({
      version: 1,
      paths: { architecture: "arch/MAIN.md", gotchas: "arch/TRAPS.md" }
    })
  )
  write(dir, "arch/MAIN.md", DOMAINS_ARCHITECTURE)
  write(dir, "arch/TRAPS.md", "# GOTCHAS\n")
  write(dir, "docs/ARCHITECTURE.md", "既定パスの方は使われない\n")

  const out = runScript(dir)
  expect(out.docRoot).toBe(dir)
  expect(out.projectDocs.architecture).toBe(path.join(dir, "arch/MAIN.md"))
  expect(out.projectDocs.gotchas).toBe(path.join(dir, "arch/TRAPS.md"))
  expect(out.projectDocs.domainsReadable).toBe(true)
  expect(out.configWarnings).toEqual([])
})

test("ケース 16c: metatron.config.json が無ければ既定値で解決する", () => {
  const dir = gitRepo()
  write(dir, "docs/ARCHITECTURE.md", DOMAINS_ARCHITECTURE)
  write(dir, "docs/GOTCHAS.md", "# GOTCHAS\n")
  const out = runScript(dir)
  expect(out.projectDocs.architecture).toBe(
    path.join(dir, "docs/ARCHITECTURE.md")
  )
  expect(out.projectDocs.gotchas).toBe(path.join(dir, "docs/GOTCHAS.md"))
  // 設定ファイルが無いことはエラーではなく、報告もしない(契約 §2)
  expect(out.configWarnings).toEqual([])
})

test("ケース 16d: サブディレクトリの metatron.config.json は docRoot を repoRoot と分ける", () => {
  const dir = gitRepo()
  const sub = mkdir(dir, "packages/app")
  write(
    dir,
    "packages/app/metatron.config.json",
    JSON.stringify({ version: 1 })
  )
  write(dir, "packages/app/docs/ARCHITECTURE.md", DOMAINS_ARCHITECTURE)
  write(dir, "docs/ARCHITECTURE.md", "ルート側は docRoot ではない\n")

  const out = runScript(sub)
  expect(out.docRoot).toBe(sub)
  expect(out.repoRoot).toBe(dir)
  expect(out.projectDocs.architecture).toBe(
    path.join(sub, "docs/ARCHITECTURE.md")
  )
  expect(out.projectDocs.domainsReadable).toBe(true)
})

test("ケース 16e: paths が絶対パス / ルート脱出なら既定値に落ち理由を返す", () => {
  const dir = gitRepo()
  write(
    dir,
    "metatron.config.json",
    JSON.stringify({
      version: 1,
      paths: { architecture: "/etc/ARCHITECTURE.md", gotchas: "../GOTCHAS.md" }
    })
  )
  write(dir, "docs/ARCHITECTURE.md", DOMAINS_ARCHITECTURE)
  write(dir, "docs/GOTCHAS.md", "# GOTCHAS\n")

  const out = runScript(dir)
  expect(out.projectDocs.architecture).toBe(
    path.join(dir, "docs/ARCHITECTURE.md")
  )
  expect(out.projectDocs.gotchas).toBe(path.join(dir, "docs/GOTCHAS.md"))
  expect(out.configWarnings.length).toBe(2)
  expect(out.configWarnings[0]).toContain("architecture")
  expect(out.configWarnings[1]).toContain("gotchas")
})

// ---------------------------------------------------------------------------
// ケース 17〜19: intent 文書
// ---------------------------------------------------------------------------

test("ケース 17: docs/intents/ が無ければ null を返し、作成もしない", () => {
  const dir = gitRepo()
  const out = runScript(dir)
  expect(out.intentsDir).toBe(null)
  expect(out.existingIntents).toEqual([])
  expect(fs.existsSync(path.join(dir, "docs", "intents"))).toBe(false)
})

test("ケース 18: intent 文書 2 件をファイル名昇順で返す", () => {
  const dir = gitRepo()
  write(
    dir,
    "docs/intents/2026-08-10-add-cache.md",
    INTENT_DOC("add-cache", "done", "42", "レスポンスキャッシュを入れる")
  )
  write(
    dir,
    "docs/intents/2026-08-16-add-oauth-login.md",
    INTENT_DOC("add-oauth-login", "approved", "", "OAuth ログインを足す")
  )
  write(dir, "docs/intents/notes.txt", "md ではないので拾わない\n")

  const out = runScript(dir)
  expect(out.intentsDir).toBe(path.join(dir, "docs/intents"))
  expect(out.existingIntents).toEqual([
    {
      file: "2026-08-10-add-cache.md",
      title: "レスポンスキャッシュを入れる",
      slug: "add-cache",
      status: "done",
      issue: "42",
      intent: "v1"
    },
    {
      file: "2026-08-16-add-oauth-login.md",
      title: "OAuth ログインを足す",
      slug: "add-oauth-login",
      status: "approved",
      issue: "",
      intent: "v1"
    }
  ])
})

test("ケース 19: frontmatter が壊れた intent 文書は落として続行する", () => {
  const dir = gitRepo()
  write(
    dir,
    "docs/intents/2026-08-01-broken.md",
    ["---", "intent: v1", "slug: broken", "# 閉じの --- が無い", ""].join("\n")
  )
  write(
    dir,
    "docs/intents/2026-08-02-nofm.md",
    "# intent: frontmatter が無い\n"
  )
  write(
    dir,
    "docs/intents/2026-08-03-ok.md",
    INTENT_DOC("ok", "approved", "", "正しい intent")
  )

  const out = runScript(dir)
  expect(out.existingIntents.map((i: { file: string }) => i.file)).toEqual([
    "2026-08-03-ok.md"
  ])
})

test("intent 書式 v2: v1 と v2 の intent 文書をどちらも列挙し、それぞれの intent の値を返す", () => {
  const dir = gitRepo()
  write(
    dir,
    "docs/intents/2026-08-10-add-cache.md",
    INTENT_DOC("add-cache", "done", "42", "レスポンスキャッシュを入れる")
  )
  write(
    dir,
    "docs/intents/2026-09-20-add-oauth-login.md",
    INTENT_DOC("add-oauth-login", "approved", "", "OAuth ログインを足す", "v2")
  )

  const out = runScript(dir)
  expect(
    out.existingIntents.map((i: { file: string; intent: string }) => ({
      file: i.file,
      intent: i.intent
    }))
  ).toEqual([
    { file: "2026-08-10-add-cache.md", intent: "v1" },
    { file: "2026-09-20-add-oauth-login.md", intent: "v2" }
  ])
})

// ---------------------------------------------------------------------------
// ケース 20: 読み取り専用の担保
// ---------------------------------------------------------------------------

// 相対パス・種別・ファイル内容のスナップショットを取る。
// `.git` は git 自身が更新しうる内部領域であり、このスクリプトの書き込みの有無とは
// 無関係なので除く。
function snapshot(dir: string): string[] {
  const out: string[] = []
  const walk = (current: string, relative: string) => {
    const entries = fs
      .readdirSync(current, { withFileTypes: true })
      .sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0))
    for (const entry of entries) {
      if (entry.name === ".git") continue
      const full = path.join(current, entry.name)
      const rel = relative ? `${relative}/${entry.name}` : entry.name
      if (entry.isDirectory()) {
        out.push(`d ${rel}`)
        walk(full, rel)
      } else {
        out.push(`f ${rel} ${fs.readFileSync(full, "utf8")}`)
      }
    }
  }
  walk(dir, "")
  return out
}

test("ケース 20: 実行前後で対象ディレクトリの内容が変化しない", () => {
  const dir = gitRepo("git@github.com:owner/repo.git")
  write(dir, "docs/ARCHITECTURE.md", DOMAINS_ARCHITECTURE)
  write(dir, "docs/GOTCHAS.md", "# GOTCHAS\n")
  write(dir, "CLAUDE.md", "# CLAUDE\n")
  write(dir, "README.md", "# README\n")
  write(dir, "metatron.config.json", JSON.stringify({ version: 1 }))
  write(
    dir,
    "docs/intents/2026-08-16-add-oauth-login.md",
    INTENT_DOC("add-oauth-login", "approved", "", "OAuth ログインを足す")
  )
  write(dir, ".github/ISSUE_TEMPLATE/bug.md", "---\nname: Bug\n---\n")

  const before = snapshot(dir)
  const out = runScript(dir)
  const after = snapshot(dir)

  expect(after).toEqual(before)
  // 検出そのものは成立している(空振りで「変化なし」になっていないことの確認)
  expect(out.projectDocs.domainsReadable).toBe(true)
  expect(out.existingIntents.length).toBe(1)
})

// ---------------------------------------------------------------------------
// ケース 21: contextDocs
// ---------------------------------------------------------------------------

test("ケース 21: contextDocs は存在するものだけを列挙する", () => {
  const dir = gitRepo()
  write(dir, "docs/ARCHITECTURE.md", DOMAINS_ARCHITECTURE)
  write(dir, "CLAUDE.md", "# CLAUDE\n")
  write(dir, "README.md", "# README\n")
  const out = runScript(dir)
  // ARCHITECTURE は projectDocs.architecture で返し、contextDocs には含めない
  expect(out.contextDocs).toEqual([
    path.join(dir, "CLAUDE.md"),
    path.join(dir, "README.md")
  ])
})

// ---------------------------------------------------------------------------
// ケース 24: 読めないエントリ
// ---------------------------------------------------------------------------

const isRoot = typeof process.getuid === "function" && process.getuid() === 0

test("ケース 24: 読み取り権限の無いエントリがあっても exit 0", () => {
  const dir = gitRepo()
  write(dir, "docs/ARCHITECTURE.md", DOMAINS_ARCHITECTURE)
  write(
    dir,
    "docs/intents/2026-08-16-ok.md",
    INTENT_DOC("ok", "approved", "", "読める intent")
  )
  const locked = write(
    dir,
    "docs/intents/2026-08-17-locked.md",
    INTENT_DOC("locked", "approved", "", "読めない intent")
  )
  fs.chmodSync(locked, 0o000)

  const out = runScript(dir)
  expect(out.projectDocs.domainsReadable).toBe(true)
  if (!isRoot) {
    // 読めないファイルは existingIntents から落として続行する
    expect(out.existingIntents.map((i: { file: string }) => i.file)).toEqual([
      "2026-08-16-ok.md"
    ])
  }

  fs.chmodSync(locked, 0o644)
})

// ---------------------------------------------------------------------------
// 契約 §14 の検証構成(check-intent-env 単体の性質。2 者で揃うべき規則は
// ケース 16f の expectTwoWayMatch で突き合わせる)
// ---------------------------------------------------------------------------

test("契約 §14: 設定なし + git では docRoot が git ルートになる", () => {
  const dir = gitRepo()
  const sub = mkdir(dir, "src/deep")
  const out = runScript(sub)
  expect(out.docRoot).toBe(dir)
  expect(out.repoRoot).toBe(dir)
})

test("契約 §14: 開始ディレクトリ自身の metatron.config.json を採る(inclusive)", () => {
  const dir = gitRepo()
  const sub = mkdir(dir, "sub")
  write(dir, "sub/metatron.config.json", JSON.stringify({ version: 1 }))
  expect(runScript(sub).docRoot).toBe(sub)
})

test("契約 §14: シンボリックリンク経由でも実体パスで docRoot を決める", () => {
  const base = tmpdir()
  const real = mkdir(base, "real")
  write(base, "real/metatron.config.json", JSON.stringify({ version: 1 }))
  const link = path.join(base, "link")
  fs.symlinkSync(real, link)
  expect(runScript(link).docRoot).toBe(real)
})

test("契約 §14: git バイナリが無くても例外を投げず段 3 へ落ちる", () => {
  const dir = tmpdir()
  const out = runScript(dir, [fakeBin({ git: false })])
  expect(out.isGitRepo).toBe(false)
  expect(out.repoRoot).toBe(null)
  expect(out.docRoot).toBe(dir)
})

test("契約 §14: ネストした git リポジトリでは内側がルートになる", () => {
  const outer = gitRepo()
  const inner = mkdir(outer, "inner")
  execFileSync("git", ["init", "-q"], { cwd: inner })
  const sub = mkdir(inner, "sub")
  const out = runScript(sub)
  expect(out.repoRoot).toBe(inner)
  expect(out.docRoot).toBe(inner)
})

test("契約 §14: Windows 形式の区切りを含む paths も同じパスへ解決する", () => {
  const dir = gitRepo()
  write(
    dir,
    "metatron.config.json",
    JSON.stringify({
      version: 1,
      paths: { architecture: "arch\\MAIN.md", gotchas: "arch\\TRAPS.md" }
    })
  )
  write(dir, "arch/MAIN.md", DOMAINS_ARCHITECTURE)
  write(dir, "arch/TRAPS.md", "# GOTCHAS\n")

  const out = runScript(dir)
  expect(out.projectDocs.architecture).toBe(path.join(dir, "arch/MAIN.md"))
  expect(out.projectDocs.gotchas).toBe(path.join(dir, "arch/TRAPS.md"))
  expect(out.configWarnings).toEqual([])
})

test("契約 §14: 壊れた設定・未知の version は全項目を既定値に落とす", () => {
  const broken = gitRepo()
  write(broken, "metatron.config.json", "{ this is not json")
  write(broken, "docs/ARCHITECTURE.md", DOMAINS_ARCHITECTURE)
  const brokenOut = runScript(broken)
  expect(brokenOut.docRoot).toBe(broken)
  expect(brokenOut.projectDocs.architecture).toBe(
    path.join(broken, "docs/ARCHITECTURE.md")
  )
  expect(brokenOut.configWarnings.length).toBe(1)

  const future = gitRepo()
  write(
    future,
    "metatron.config.json",
    JSON.stringify({ version: 99, paths: { architecture: "arch/MAIN.md" } })
  )
  write(future, "arch/MAIN.md", DOMAINS_ARCHITECTURE)
  write(future, "docs/ARCHITECTURE.md", DOMAINS_ARCHITECTURE)
  const futureOut = runScript(future)
  expect(futureOut.projectDocs.architecture).toBe(
    path.join(future, "docs/ARCHITECTURE.md")
  )
  expect(futureOut.configWarnings.length).toBe(1)

  const array = gitRepo()
  write(array, "metatron.config.json", "[]")
  const arrayOut = runScript(array)
  expect(arrayOut.configWarnings.length).toBe(1)
})

// ---------------------------------------------------------------------------
// ケース 16f: 2 者比較(契約 §14)
//
// 契約は metatron と codiel が同じ規則の写しを独立に持つことを認めており、一致の担保は
// このテストだけである。metatron の loadConfig と codiel の resolveDocPaths は関数として
// 直接呼べるが、check-intent-env はトップレベルで副作用を持つスクリプトなので、
// 子プロセスとして起動して出力 JSON を突き合わせる。check-intent-env は lib.ts を使うので、
// 実装としては metatron と codiel の 2 つを比べることになる。
// ---------------------------------------------------------------------------

function insideGitRepo(dir: string): boolean {
  return (
    spawnSync("git", ["rev-parse", "--show-toplevel"], {
      cwd: dir,
      encoding: "utf8"
    }).status === 0
  )
}

function ensureFile(file: string): void {
  if (fs.existsSync(file)) return
  writeAt(file, DOMAINS_ARCHITECTURE)
}

// 絶対パスへ書く(write は「ルート + 相対パス」で、解決済みのパスには使えない)。
function writeAt(file: string, content: string): void {
  fs.mkdirSync(path.dirname(file), { recursive: true })
  fs.writeFileSync(file, content)
}

// PATH を空にして関数を呼ぶ(子プロセス側は fakeBin({ git: false }) で同じ状態を作る)。
function withoutGitBinary<T>(fn: () => T): T {
  const saved = process.env.PATH
  process.env.PATH = ""
  try {
    return fn()
  } finally {
    if (saved === undefined) delete process.env.PATH
    else process.env.PATH = saved
  }
}

/**
 * 同一構成に対して metatron と codiel を走らせ、docRoot と解決した ARCHITECTURE / GOTCHAS の
 * パス、既定値へ落とした理由(warnings)、ドメインマップの可読性・値・件数がすべて一致する
 * ことを検証する(契約 §14)。codiel は lib.ts の関数と check-intent-env の出力の両方を比べる。
 *
 * check-intent-env は「存在するファイル」だけを `projectDocs` に返すため、比較の前に metatron が
 * 解決したパスへ実体を置く。2 者が同じ規則で解決していれば check-intent-env も同じ絶対パスを
 * 返し、規則がずれていれば `null`(または別のパス)になって不一致として現れる。
 *
 * warnings は**文言の完全一致までは求めない**。2 実装が同じ規則の写しを独立に持つ設計で
 * 文言まで揃えると同期コストが上がりすぎるため、「警告が出るか出ないか」と
 * 「理由の件数」だけを突き合わせる(契約 §3 規則 3)。
 *
 * ドメインマップの可読性も比較対象に含める。契約 §1 は「独自のフェンス判定を書かない」と
 * 定めており、同じ ARCHITECTURE を 2 実装のうち 1 つだけが読めない状態を検出する唯一の
 * 機械的担保がここである(codiel が正規表現でブロックを切り出していたため、CRLF 改行の
 * 文書を codiel だけが読めない不整合が生じていた)。
 */
function expectTwoWayMatch(
  startDir: string,
  label: string,
  opts: { withoutGit?: boolean; architecture?: string } = {}
): void {
  const call = <T>(fn: () => T): T =>
    opts.withoutGit ? withoutGitBinary(fn) : fn()

  const metatron = call(() => loadConfig(startDir))
  const codiel = call(() => resolveDocPaths(startDir))

  expect(codiel.docRoot, `${label}: metatron と codiel の docRoot`).toBe(
    metatron.docRoot
  )
  expect(
    codiel.architecture,
    `${label}: metatron と codiel の architecture`
  ).toBe(metatron.architecturePath)
  expect(codiel.gotchas, `${label}: metatron と codiel の gotchas`).toBe(
    metatron.gotchasPath
  )
  expect(
    codiel.warnings.length > 0,
    `${label}: metatron と codiel の警告の有無`
  ).toBe(metatron.warnings.length > 0)
  expect(
    codiel.warnings.length,
    `${label}: metatron と codiel の警告の件数`
  ).toBe(metatron.warnings.length)

  // opts.architecture を渡した構成では、解決先へその中身を必ず置く(既存を上書きする)。
  // ドメインマップの形を指定して 2 実装の判定を突き合わせるための口である。
  if (opts.architecture !== undefined)
    writeAt(metatron.architecturePath, opts.architecture)
  else ensureFile(metatron.architecturePath)
  ensureFile(metatron.gotchasPath)

  // 2 実装が同じ ARCHITECTURE から同じドメイン定義を読むか(契約 §1・§4-2)。
  // **「読めたか」の真偽だけでは足りない。** 検証 4 項目のどれかを 1 実装だけが
  // 見ていなければ、同じ `{}` や `{"x":[]}` を片方だけが受け入れる割れになる。
  const architectureText = fs.readFileSync(metatron.architecturePath, "utf8")
  const metatronDomains = extractDomains(architectureText)
  const codielDomains = call(() => readDomainsResult(startDir))

  expect(
    codielDomains.domains,
    `${label}: metatron と codiel のドメイン定義`
  ).toStrictEqual(metatronDomains.ok ? metatronDomains.domains : null)
  expect(
    call(() => readDomains(startDir)) !== null,
    `${label}: codiel のドメインマップ可読性`
  ).toBe(metatronDomains.ok)
  // 重複ブロック・未閉フェンスの警告も揃える(契約 §1「警告は経路を問わず返す」)。
  // 文言までは求めず、有無と件数を突き合わせる(2 実装の同期コストを上げない)。
  expect(
    codielDomains.warnings.length,
    `${label}: metatron と codiel のドメイン警告の件数`
  ).toBe(metatronDomains.warnings.length)

  const script = runScript(
    startDir,
    opts.withoutGit ? [fakeBin({ git: false })] : undefined
  )
  expect(script.docRoot, `${label}: check-intent-env の docRoot`).toBe(
    metatron.docRoot
  )
  expect(
    script.projectDocs.architecture,
    `${label}: check-intent-env の architecture`
  ).toBe(metatron.architecturePath)
  expect(
    script.projectDocs.gotchas,
    `${label}: check-intent-env の gotchas`
  ).toBe(metatron.gotchasPath)
  // check-intent-env は設定の警告と文書構造の警告を configWarnings の 1 本で返すため、
  // 比較相手も metatron の両方(loadConfig + extractDomains)の合計にする。
  const expectedWarnings =
    metatron.warnings.length + metatronDomains.warnings.length
  expect(
    script.configWarnings.length > 0,
    `${label}: check-intent-env の警告の有無`
  ).toBe(expectedWarnings > 0)
  expect(
    script.configWarnings.length,
    `${label}: check-intent-env の警告の件数`
  ).toBe(expectedWarnings)

  expect(
    script.projectDocs.domainsReadable,
    `${label}: check-intent-env のドメインマップ可読性`
  ).toBe(metatronDomains.ok)
  // check-intent-env は定義そのものを返さない。突き合わせられるのは件数まで。
  expect(
    script.projectDocs.domainCount,
    `${label}: check-intent-env のドメイン件数`
  ).toBe(
    metatronDomains.ok ? Object.keys(metatronDomains.domains ?? {}).length : 0
  )
}

test("ケース 16f: 設定ファイル無し + git リポジトリ", () => {
  const dir = gitRepo()
  const sub = mkdir(dir, "a/b")
  expectTwoWayMatch(dir, "git リポジトリのルート")
  expectTwoWayMatch(sub, "git リポジトリのサブディレクトリ")
  expect(loadConfig(sub).docRoot).toBe(dir)
})

test("ケース 16f: 設定ファイル無し + git 管理外", () => {
  const dir = tmpdir()
  const sub = mkdir(dir, "a/b")
  if (insideGitRepo(sub)) return
  expectTwoWayMatch(dir, "git 管理外のルート")
  expectTwoWayMatch(sub, "git 管理外のサブディレクトリ")
  expect(loadConfig(sub).docRoot).toBe(sub)
})

test("ケース 16f: サブディレクトリから実行し祖先に metatron.config.json", () => {
  const dir = gitRepo()
  write(
    dir,
    "metatron.config.json",
    JSON.stringify({
      version: 1,
      paths: { architecture: "arch/MAIN.md", gotchas: "arch/TRAPS.md" }
    })
  )
  const sub = mkdir(dir, "a/b")
  expectTwoWayMatch(sub, "祖先に設定ファイル")
  expect(loadConfig(sub).docRoot).toBe(dir)

  // 最も近い祖先が採られること(中間にもう 1 つ置く)。
  const mid = path.join(dir, "a")
  write(dir, "a/metatron.config.json", JSON.stringify({ version: 1 }))
  expectTwoWayMatch(sub, "最も近い祖先の設定ファイル")
  expect(loadConfig(sub).docRoot).toBe(mid)
})

test("ケース 16f: 開始ディレクトリ自身に metatron.config.json(inclusive)", () => {
  const dir = gitRepo()
  const sub = mkdir(dir, "sub")
  write(dir, "sub/metatron.config.json", JSON.stringify({ version: 1 }))
  expectTwoWayMatch(sub, "開始ディレクトリ自身に設定ファイル")
  expect(loadConfig(sub).docRoot).toBe(sub)
})

test("ケース 16f: repo/metatron.config.json と repo/sub/.codiel の併存", () => {
  const dir = gitRepo()
  write(dir, "metatron.config.json", JSON.stringify({ version: 1 }))
  const sub = mkdir(dir, "sub")
  mkdir(dir, "sub/.codiel")
  expectTwoWayMatch(sub, ".codiel と設定ファイルの併存")
  // 文書のルートは config を持つ祖先で決まり、`.codiel` の位置には引きずられない。
  expect(loadConfig(sub).docRoot).toBe(dir)
})

test("ケース 16f: paths が絶対パス / ルート脱出", () => {
  const abs = gitRepo()
  write(
    abs,
    "metatron.config.json",
    JSON.stringify({
      version: 1,
      paths: { architecture: "/etc/ARCHITECTURE.md", gotchas: "C:/GOTCHAS.md" }
    })
  )
  expectTwoWayMatch(abs, "絶対パス")

  const esc = gitRepo()
  write(
    esc,
    "metatron.config.json",
    JSON.stringify({
      version: 1,
      paths: { architecture: "../outside/ARCHITECTURE.md", gotchas: ".." }
    })
  )
  expectTwoWayMatch(esc, "ルート脱出")
})

test("ケース 16f: シンボリックリンク経由の開始ディレクトリ", () => {
  const base = tmpdir()
  const real = mkdir(base, "real")
  write(base, "real/metatron.config.json", JSON.stringify({ version: 1 }))
  const link = path.join(base, "link")
  try {
    fs.symlinkSync(real, link, "dir")
  } catch {
    return // symlink を作れない環境ではスキップする
  }
  expectTwoWayMatch(link, "シンボリックリンク経由")
  expect(loadConfig(link).docRoot).toBe(real)
})

test("ケース 16f: git バイナリが無い環境", () => {
  const dir = tmpdir()
  const sub = mkdir(dir, "a/b")
  expectTwoWayMatch(sub, "git バイナリ無し", { withoutGit: true })
  expect(withoutGitBinary(() => loadConfig(sub).docRoot)).toBe(sub)
})

test("ケース 16f: ネストした git リポジトリ", () => {
  const outer = gitRepo()
  const inner = mkdir(outer, "inner")
  execFileSync("git", ["init", "-q"], { cwd: inner })
  const sub = mkdir(inner, "sub")
  expectTwoWayMatch(sub, "ネストした git リポジトリ")
  expect(loadConfig(sub).docRoot).toBe(inner)
})

test("ケース 16f: CRLF 改行の ARCHITECTURE", () => {
  // Windows で作られた ARCHITECTURE。契約 §4-2 は判定の前に行末の `\r` を除去すると定める。
  // 独自のフェンス判定を持つ実装はここで開始フェンスを認識できず、その実装だけが
  // 同じ文書を読めない状態になる。以前の契約違反はこのケースがテストに無かったため
  // 見逃された。
  const dir = gitRepo()
  write(
    dir,
    "docs/ARCHITECTURE.md",
    DOMAINS_ARCHITECTURE.replace(/\n/g, "\r\n")
  )
  write(dir, "docs/GOTCHAS.md", "# GOTCHAS\r\n\r\n## 失敗パターン一覧\r\n")
  expectTwoWayMatch(dir, "CRLF 改行の ARCHITECTURE")

  // 2 実装が同じドメイン定義を読めていること(可読性だけでなく中身も確認する)。
  expect(readDomains(dir)).toStrictEqual({
    frontend: ["src/app/**"],
    backend: ["src/server/**"]
  })
  expect(runScript(dir).projectDocs.domainCount).toBe(2)
})

test("ケース 16f: CRLF 改行 + 設定でパスを変えた ARCHITECTURE", () => {
  const dir = gitRepo()
  write(
    dir,
    "metatron.config.json",
    JSON.stringify({
      version: 1,
      paths: { architecture: "arch/MAIN.md", gotchas: "arch/TRAPS.md" }
    })
  )
  write(dir, "arch/MAIN.md", DOMAINS_ARCHITECTURE.replace(/\n/g, "\r\n"))
  const sub = mkdir(dir, "a/b")
  expectTwoWayMatch(sub, "CRLF 改行 + 設定でパスを変えた ARCHITECTURE")
  expect(readDomains(sub)).toStrictEqual({
    frontend: ["src/app/**"],
    backend: ["src/server/**"]
  })
})

test("ケース 16f: Windows 形式のパス区切り", () => {
  const dir = gitRepo()
  write(
    dir,
    "metatron.config.json",
    JSON.stringify({
      version: 1,
      paths: { architecture: "docs\\arch\\MAIN.md", gotchas: "..\\outside.md" }
    })
  )
  expectTwoWayMatch(dir, "Windows 形式の区切り")
})

test("ケース 16f: 正当な Windows 形式のパス区切り(ルート脱出を含まない)", () => {
  // 直前のケースは gotchas が `..\outside.md`(ルート脱出)なので、「正当な区切りでは
  // 警告が出ない」ことを 2 者で突き合わせていない。1 実装だけが正当な相対パスへ
  // 余計な警告を出しても担保をすり抜ける(契約 §14)。
  const dir = gitRepo()
  write(
    dir,
    "metatron.config.json",
    JSON.stringify({
      version: 1,
      paths: {
        architecture: "docs\\arch\\MAIN.md",
        gotchas: "docs\\arch\\TRAPS.md"
      }
    })
  )
  expectTwoWayMatch(dir, "正当な Windows 形式の区切り")

  // 件数の一致だけでは「2 者が揃って誤警告する」を見逃す。0 件で揃うことまで求める。
  expect(loadConfig(dir).warnings, "metatron の警告").toEqual([])
  expect(resolveDocPaths(dir).warnings, "codiel の警告").toEqual([])
  expect(runScript(dir).configWarnings, "check-intent-env の警告").toEqual([])

  // 区切りを "/" に寄せた同じパスへ解決すること(契約 §3 規則 2)。
  expect(loadConfig(dir).architecturePath).toBe(
    path.join(dir, "docs/arch/MAIN.md")
  )
  expect(loadConfig(dir).gotchasPath).toBe(path.join(dir, "docs/arch/TRAPS.md"))
})

test("ケース 16f: 壊れた設定・未知の version・型不整合", () => {
  const broken = gitRepo()
  write(broken, "metatron.config.json", "{ not json")
  expectTwoWayMatch(broken, "壊れた JSON")

  const array = gitRepo()
  write(array, "metatron.config.json", "[1, 2, 3]\n")
  expectTwoWayMatch(array, "トップレベルが配列")

  const unknown = gitRepo()
  write(
    unknown,
    "metatron.config.json",
    JSON.stringify({ version: 99, paths: { architecture: "arch/MAIN.md" } })
  )
  expectTwoWayMatch(unknown, "未知の version")

  const typed = gitRepo()
  write(
    typed,
    "metatron.config.json",
    JSON.stringify({ version: 1, paths: { architecture: 42, gotchas: "" } })
  )
  expectTwoWayMatch(typed, "paths の型不整合")
})

// ---------------------------------------------------------------------------
// 契約 §1 / §4-3: 独立レビューが挙げた欠陥の回帰テスト
// ---------------------------------------------------------------------------

const DUPLICATE_DOMAINS_ARCHITECTURE = [
  DOMAINS_ARCHITECTURE,
  "## ドメインマップ(重複)",
  "",
  "```json metatron:domains",
  '{ "data": ["db/**"] }',
  "```",
  ""
].join("\n")

test("契約 §1: metatron:domains が重複していれば警告を返し、最初のブロックを採る", () => {
  const dir = gitRepo()
  write(dir, "docs/ARCHITECTURE.md", DUPLICATE_DOMAINS_ARCHITECTURE)

  const out = runScript(dir)
  // 最初のブロック(frontend / backend)の 2 件。後ろの data は採らない。
  expect(out.projectDocs.domainsReadable).toBe(true)
  expect(out.projectDocs.domainCount).toBe(2)
  // 警告は経路を問わず返す(契約 §1)。文言は正本(metatron)と一致させる。
  expect(out.configWarnings).toEqual(
    extractDomains(DUPLICATE_DOMAINS_ARCHITECTURE).warnings
  )
  expect(out.configWarnings.length).toBe(1)
})

const UNCLOSED_DOMAINS_ARCHITECTURE = [
  "# ARCHITECTURE",
  "",
  "## ドメインマップ",
  "",
  "```json metatron:domains",
  '{ "frontend": ["src/app/**"] }',
  ""
].join("\n")

test("契約 §4-3: 未閉のドメインブロックは警告を添えて読み取りを続け、exit 0 を保つ", () => {
  const dir = gitRepo()
  write(dir, "docs/ARCHITECTURE.md", UNCLOSED_DOMAINS_ARCHITECTURE)

  // 読み取り経路はフェイルオープン。例外を投げず(runTs は非 0 終了で throw する)続行する。
  expect(() => runScript(dir)).not.toThrow()
  const out = runScript(dir)
  expect(out.projectDocs.domainsReadable).toBe(true)
  expect(out.projectDocs.domainCount).toBe(1)
  expect(out.configWarnings).toEqual(
    extractDomains(UNCLOSED_DOMAINS_ARCHITECTURE).warnings
  )
  expect(out.configWarnings.length).toBe(1)
})

// 手前の未閉フェンスがドメインブロックの開始行を呑み込む構成。ドメインブロック自体は
// 「見つからなかった」扱いになるため、`blocks[0]` 起点の警告では検出できない。
const SWALLOWED_DOMAINS_ARCHITECTURE = [
  "# ARCHITECTURE",
  "",
  "```ts",
  "const x = 1",
  "",
  "## ドメインマップ",
  "",
  "```json metatron:domains",
  '{ "frontend": ["src/app/**"] }',
  ""
].join("\n")

test("契約 §4-3: ドメインブロックを呑み込む未閉フェンスも黙って落とさない", () => {
  const dir = gitRepo()
  // **2 者比較を必ず通す(契約 §14)。** ここを check-intent-env 単体で検証すると、
  // 「1 実装だけが警告を出す」という、まさにこのテストが守るべき割れが素通しになる。
  expectTwoWayMatch(dir, "呑み込む未閉フェンス", {
    architecture: SWALLOWED_DOMAINS_ARCHITECTURE
  })

  // 手前のフェンスが閉じていないため、ドメインブロックの開始行はフェンス内に呑まれて読めない。
  // 警告が無ければ「ドメインが未定義」と区別できない。
  const text = fs.readFileSync(path.join(dir, "docs/ARCHITECTURE.md"), "utf8")
  expect(extractDomains(text).ok).toBe(false)
  expect(extractDomains(text).warnings.length).toBe(1)
  expect(readDomains(dir)).toBe(null)
  expect(readDomainsResult(dir).warnings.length).toBe(1)

  const out = runScript(dir)
  expect(out.projectDocs.domainsReadable).toBe(false)
  expect(out.configWarnings.length).toBe(1)
  expect(out.configWarnings[0]).toContain("閉じていないコードフェンス")
})

// ---------------------------------------------------------------------------
// ケース 16f の強化: ドメインマップの中身・無効な形状・重複警告を 2 者で突き合わせる
//
// 「読めたかどうか」の真偽だけを比べる比較は、検証 4 項目のどれかを 1 実装だけが
// 見ていない割れ(同じ `{}` を片方だけが受け入れる)を素通しする。
// ---------------------------------------------------------------------------

// ドメインマップブロックだけを持つ最小 ARCHITECTURE(契約 §4-1「すべてのセクションは任意」)。
function architectureWith(body: string): string {
  return [
    "# ARCHITECTURE",
    "",
    "## ドメインマップ",
    "",
    "```json metatron:domains",
    body,
    "```",
    ""
  ].join("\n")
}

test("ケース 16f: 2 実装が同じドメイン定義を返す(値まで突き合わせる)", () => {
  const dir = gitRepo()
  const sub = mkdir(dir, "a/b")
  expectTwoWayMatch(sub, "ドメイン定義の一致", {
    architecture: architectureWith(
      '{ "frontend": ["src/app/**", "src/components/**"], "data": ["db/**"] }'
    )
  })
  expect(readDomains(sub)).toStrictEqual({
    frontend: ["src/app/**", "src/components/**"],
    data: ["db/**"]
  })
  expect(runScript(sub).projectDocs.domainCount).toBe(2)
})

test("ケース 16f: 無効な形状は 2 実装が揃って「読めない」と判定する", () => {
  // 契約 §1 の検証 4 項目に反する形。1 実装だけが受け入れれば割れである。
  const invalid = [
    ["キーが 0 個", "{}"],
    ["トップレベルが配列", "[]"],
    ["トップレベルが配列(非空)", '["src/**"]'],
    ["値が空配列", '{ "x": [] }'],
    ["値の要素が文字列でない", '{ "x": [1] }'],
    ["値が配列でない", '{ "x": "src/**" }'],
    ["有効な JSON でない", '{ "x": ']
  ]
  for (const [name, body] of invalid) {
    const dir = gitRepo()
    expectTwoWayMatch(dir, `無効な形状(${name})`, {
      architecture: architectureWith(body)
    })
    expect(readDomains(dir), `codiel: ${name}`).toBe(null)
    const out = runScript(dir)
    expect(out.projectDocs.domainsReadable, `check-intent-env: ${name}`).toBe(
      false
    )
    expect(out.projectDocs.domainCount, `check-intent-env: ${name}`).toBe(0)
  }
})

test("ケース 16f: 重複ブロックで 2 実装が揃って警告を返し、最初のものを採る", () => {
  const dir = gitRepo()
  expectTwoWayMatch(dir, "重複ブロック", {
    architecture: DUPLICATE_DOMAINS_ARCHITECTURE
  })

  // 2 実装とも警告 1 件。読み取り経路なので拒否はしない(契約 §1)。
  const architecturePath = path.join(dir, "docs/ARCHITECTURE.md")
  const text = fs.readFileSync(architecturePath, "utf8")
  expect(extractDomains(text).warnings.length).toBe(1)
  expect(readDomainsResult(dir).warnings.length).toBe(1)
  expect(runScript(dir).configWarnings.length).toBe(1)

  // 採るのは最初のブロック。2 実装でずれない。
  expect(readDomains(dir)).toStrictEqual({
    frontend: ["src/app/**"],
    backend: ["src/server/**"]
  })
  expect(runScript(dir).projectDocs.domainCount).toBe(2)
})

test("ケース 16f: 未閉フェンスでも 2 実装が揃って警告を返し、読み取りは続く", () => {
  const dir = gitRepo()
  expectTwoWayMatch(dir, "未閉フェンス", {
    architecture: UNCLOSED_DOMAINS_ARCHITECTURE
  })
  expect(readDomainsResult(dir).warnings.length).toBe(1)
  expect(readDomains(dir)).toStrictEqual({ frontend: ["src/app/**"] })
})
