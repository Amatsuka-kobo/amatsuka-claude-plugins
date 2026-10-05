import { execFileSync } from "node:child_process"
import * as fs from "node:fs"
import * as os from "node:os"
import * as path from "node:path"

/** テスト用に git を実行する。利用者の設定で署名などが走らないように固定する */
export function git(cwd: string, ...args: string[]): string {
  return execFileSync(
    "git",
    [
      "-c",
      "user.name=raguel-test",
      "-c",
      "user.email=raguel-test@example.invalid",
      "-c",
      "commit.gpgsign=false",
      "-c",
      "init.defaultBranch=main",
      ...args
    ],
    { cwd, encoding: "utf-8", stdio: ["ignore", "pipe", "pipe"] }
  ).trim()
}

export function writeFile(root: string, rel: string, content: string | Buffer) {
  const abs = path.join(root, rel)
  fs.mkdirSync(path.dirname(abs), { recursive: true })
  fs.writeFileSync(abs, content)
}

/** すべてをコミットして HEAD を返す */
export function commitAll(repo: string, message = "commit"): string {
  git(repo, "add", "-A")
  git(repo, "commit", "-q", "--allow-empty", "-m", message)
  return git(repo, "rev-parse", "HEAD")
}

export function makeTmpDir(prefix = "raguel-subject-"): string {
  return fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), prefix)))
}

/** 最初のコミットを持つ一時リポジトリを作る */
export function makeRepo(files: Record<string, string> = {}): string {
  const repo = makeTmpDir()
  git(repo, "init", "-q")
  for (const [rel, content] of Object.entries(files)) {
    writeFile(repo, rel, content)
  }
  commitAll(repo, "init")
  return repo
}
