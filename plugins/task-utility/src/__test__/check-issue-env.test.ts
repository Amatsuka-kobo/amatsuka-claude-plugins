import { execFileSync } from "node:child_process"
import fs from "node:fs"
import os from "node:os"
import path from "node:path"
import { fileURLToPath } from "node:url"
import { expect, test } from "vitest"
import { runTs } from "../testing/run-ts.js"

const SCRIPT = fileURLToPath(new URL("../check-issue-env.ts", import.meta.url))

const mockEnv = (binDir: string) => ({
  ...process.env,
  PATH: `${binDir}${path.delimiter}${path.dirname(process.execPath)}`,
})

// スクリプトを起動し stdout の JSON を返す。pathDirs 指定時は PATH を差し替える(gh 検出テスト用)
function runScript(cwd: string, pathDirs?: string[]) {
  const env = pathDirs ? mockEnv(pathDirs.join(path.delimiter)) : process.env
  const stdout = runTs(SCRIPT, [cwd], { env })
  return JSON.parse(stdout)
}

function tmpdir(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), "issue-env-"))
}

function gitRepo(remoteUrl: string | null): string {
  const dir = tmpdir()
  execFileSync("git", ["init", "-q"], { cwd: dir })
  if (remoteUrl) execFileSync("git", ["remote", "add", "origin", remoteUrl], { cwd: dir })
  return dir
}

test("git リポジトリでないディレクトリでは isGitRepo: false", () => {
  const out = runScript(tmpdir())
  expect(out.isGitRepo).toBe(false)
  expect(out.remoteUrl).toBe(null)
  expect(out.repoSlug).toBe(null)
})

test("リモート未設定の git リポジトリでは remoteUrl/repoSlug が null", () => {
  const out = runScript(gitRepo(null))
  expect(out.isGitRepo).toBe(true)
  expect(out.remoteUrl).toBe(null)
  expect(out.repoSlug).toBe(null)
})

test("GitHub SSH リモートから repoSlug を抽出する", () => {
  const out = runScript(gitRepo("git@github.com:owner/my-repo.git"))
  expect(out.remoteUrl).toBe("git@github.com:owner/my-repo.git")
  expect(out.repoSlug).toBe("owner/my-repo")
})

test("GitHub HTTPS リモート(.git なし)から repoSlug を抽出する", () => {
  const out = runScript(gitRepo("https://github.com/owner/my-repo"))
  expect(out.repoSlug).toBe("owner/my-repo")
})

test("GitHub 以外のリモートでは repoSlug が null", () => {
  const out = runScript(gitRepo("git@gitlab.com:owner/repo.git"))
  expect(out.remoteUrl).toBe("git@gitlab.com:owner/repo.git")
  expect(out.repoSlug).toBe(null)
})

test("github.com を含むだけの別ホストでは repoSlug が null", () => {
  expect(runScript(gitRepo("git@notgithub.com:owner/repo.git")).repoSlug).toBe(null)
  expect(runScript(gitRepo("https://mygithub.com/owner/repo")).repoSlug).toBe(null)
})

// PATH 制御用: 実物の git だけを持つ bin ディレクトリを作る(スクリプトが spawn するのは git と gh のみ)
function fakeBin({ gh }: { gh?: string } = {}): string {
  const dir = tmpdir()
  const realGit = execFileSync("sh", ["-c", "command -v git"], { encoding: "utf8" }).trim()
  fs.symlinkSync(realGit, path.join(dir, "git"))
  if (gh) {
    const file = path.join(dir, "gh")
    fs.writeFileSync(file, gh)
    fs.chmodSync(file, 0o755)
  }
  return dir
}

test("gh が PATH に無ければ ghInstalled/ghAuthenticated とも false", () => {
  const out = runScript(tmpdir(), [fakeBin()])
  expect(out.ghInstalled).toBe(false)
  expect(out.ghAuthenticated).toBe(false)
})

test("gh はあるが未認証なら ghInstalled: true, ghAuthenticated: false", () => {
  const bin = fakeBin({ gh: '#!/bin/sh\n[ "$1" = "--version" ] && exit 0\nexit 1\n' })
  const out = runScript(tmpdir(), [bin])
  expect(out.ghInstalled).toBe(true)
  expect(out.ghAuthenticated).toBe(false)
})

test("gh があり認証済みなら両方 true", () => {
  const bin = fakeBin({ gh: "#!/bin/sh\nexit 0\n" })
  const out = runScript(tmpdir(), [bin])
  expect(out.ghInstalled).toBe(true)
  expect(out.ghAuthenticated).toBe(true)
})

function withTemplates(files: Record<string, string>): string {
  const dir = gitRepo("git@github.com:owner/repo.git")
  const tplDir = path.join(dir, ".github", "ISSUE_TEMPLATE")
  fs.mkdirSync(tplDir, { recursive: true })
  for (const [name, content] of Object.entries(files)) {
    fs.writeFileSync(path.join(tplDir, name), content)
  }
  return dir
}

test("テンプレートが無ければ templates は空、blankIssuesEnabled は true", () => {
  const out = runScript(gitRepo("git@github.com:owner/repo.git"))
  expect(out.templates).toEqual([])
  expect(out.blankIssuesEnabled).toBe(true)
})

test("md テンプレートの frontmatter からトップレベルキーを抽出する", () => {
  const dir = withTemplates({
    "bug_report.md": [
      "---",
      "name: バグ報告",
      "about: 動作不良の報告",
      'title: "[Bug] "',
      "labels: bug, help wanted",
      "---",
      "",
      "## 再現手順",
    ].join("\n"),
  })
  const out = runScript(dir)
  expect(out.templates).toEqual([
    {
      file: "bug_report.md",
      name: "バグ報告",
      about: "動作不良の報告",
      title: "[Bug] ",
      labels: ["bug", "help wanted"],
    },
  ])
})

test("yml フォームは description を about に正規化し、複数行 labels も拾う", () => {
  const dir = withTemplates({
    "feature.yml": [
      "name: 機能要望",
      "description: 新機能の提案",
      "labels:",
      "  - enhancement",
      '  - "needs triage"',
      "body:",
      "  - type: markdown",
      "    attributes:",
      "      value: 説明",
    ].join("\n"),
  })
  const out = runScript(dir)
  expect(out.templates.length).toBe(1)
  expect(out.templates[0].name).toBe("機能要望")
  expect(out.templates[0].about).toBe("新機能の提案")
  expect(out.templates[0].labels).toEqual(["enhancement", "needs triage"])
})

test("inline 配列の labels もパースでき、config.yml は templates に含めない", () => {
  const dir = withTemplates({
    "task.yml": 'name: タスク\nlabels: ["chore", "docs"]\n',
    "config.yml": "blank_issues_enabled: false\n",
  })
  const out = runScript(dir)
  expect(out.templates.map((t: { file: string }) => t.file)).toEqual(["task.yml"])
  expect(out.templates[0].labels).toEqual(["chore", "docs"])
  expect(out.blankIssuesEnabled).toBe(false)
})

test("サブディレクトリから実行してもリポジトリルートのテンプレートを検出する", () => {
  const dir = withTemplates({ "bug.md": "---\nname: Bug\n---\n" })
  const sub = path.join(dir, "src")
  fs.mkdirSync(sub)
  const out = runScript(sub)
  expect(out.templates.length).toBe(1)
  expect(out.templates[0].name).toBe("Bug")
})

test("読めないエントリ(ディレクトリ等)はスキップして exit 0 を保つ", () => {
  const dir = withTemplates({ "bug.md": "---\nname: Bug\n---\n" })
  fs.mkdirSync(path.join(dir, ".github", "ISSUE_TEMPLATE", "weird.yml"))
  const out = runScript(dir)
  expect(out.templates.map((t: { file: string }) => t.file)).toEqual(["bug.md"])
})

test("ISSUE_TEMPLATE がディレクトリでなくファイルでも exit 0 でテンプレート無し扱い", () => {
  const dir = gitRepo("git@github.com:owner/repo.git")
  fs.mkdirSync(path.join(dir, ".github"), { recursive: true })
  fs.writeFileSync(path.join(dir, ".github", "ISSUE_TEMPLATE"), "not a directory")
  const out = runScript(dir)
  expect(out.templates).toEqual([])
  expect(out.blankIssuesEnabled).toBe(true)
})

test("複数テンプレートはファイル名昇順で返る", () => {
  const dir = withTemplates({
    "b_bug.md": "---\nname: Bug\n---\n",
    "a_feature.yml": "name: Feature\n",
  })
  const out = runScript(dir)
  expect(out.templates.map((t: { file: string }) => t.file)).toEqual(["a_feature.yml", "b_bug.md"])
})
