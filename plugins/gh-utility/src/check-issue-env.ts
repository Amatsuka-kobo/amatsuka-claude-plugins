#!/usr/bin/env node
// GitHub Issue 起票に必要な環境の事実(git リポジトリ・リモート・gh・Issue テンプレート)を
// JSON で stdout に出力する。判断(STOP するか等)はスキル側が行い、このスクリプトは常に exit 0。
// issue-craft スキル専用ではなく、Issue 系スキル共通の前提チェックとして使う。
// 使い方: node check-issue-env.mjs [projectDir]
import { spawnSync } from "node:child_process"
import fs from "node:fs"
import path from "node:path"

const cwd = process.argv[2] ?? process.cwd()

function git(...args: string[]): string | null {
  const res = spawnSync("git", args, { cwd, encoding: "utf8" })
  return res.status === 0 ? res.stdout.trim() : null
}

const isGitRepo = git("rev-parse", "--is-inside-work-tree") === "true"
const remoteUrl = isGitRepo ? git("remote", "get-url", "origin") : null

// SSH (git@github.com:owner/repo.git) と HTTPS (https://github.com/owner/repo) の両形式に対応。
// ホスト名は github.com 完全一致(notgithub.com 等の部分一致を弾く)
const repoSlug =
  remoteUrl?.match(
    /^(?:git@|ssh:\/\/git@|https?:\/\/)github\.com[/:]([^/]+\/[^/]+?)(?:\.git)?\/?$/
  )?.[1] ?? null

// gh 未インストール時、spawnSync は ENOENT で status: null を返す(例外は投げない)
const ghInstalled =
  spawnSync("gh", ["--version"], { encoding: "utf8" }).status === 0
const ghAuthenticated =
  ghInstalled &&
  spawnSync("gh", ["auth", "status"], { encoding: "utf8" }).status === 0

// テンプレートはリポジトリルート直下の .github/ISSUE_TEMPLATE/ から検出する
const repoRoot = isGitRepo ? git("rev-parse", "--show-toplevel") : null
const tplDir = repoRoot
  ? path.join(repoRoot, ".github", "ISSUE_TEMPLATE")
  : null

const unquote = (v: string): string => v.replace(/^(["'])(.*)\1$/, "$2")

// YAML パーサは使わず、トップレベル(行頭・インデント無し)のキーのみ簡易抽出する。
// labels は inline 配列・カンマ区切り・直後の「- item」複数行リストの3形式に対応
function parseTopLevel(src: string): Record<string, string> {
  const top: Record<string, string> = {}
  const lines = src.split("\n")
  for (let i = 0; i < lines.length; i++) {
    const m = lines[i].match(/^([A-Za-z_][\w-]*):\s*(.*)$/)
    if (!m) continue
    let value = m[2].trim()
    if (!value) {
      const items: string[] = []
      while (i + 1 < lines.length && /^\s+-\s+/.test(lines[i + 1])) {
        items.push(lines[++i].replace(/^\s+-\s+/, "").trim())
      }
      value = items.join(",")
    }
    top[m[1]] = value
  }
  return top
}

function parseTemplate(file: string, content: string) {
  let src = content
  if (file.endsWith(".md")) {
    src = content.match(/^---\n([\s\S]*?)\n---/)?.[1] ?? ""
  }
  const top = parseTopLevel(src)
  const labelsRaw = top.labels?.match(/^\[(.*)\]$/)?.[1] ?? top.labels ?? ""
  return {
    file,
    name: unquote(top.name ?? ""),
    about: unquote(top.description ?? top.about ?? ""),
    title: unquote(top.title ?? ""),
    labels: labelsRaw
      .split(",")
      .map((s) => unquote(s.trim()))
      .filter(Boolean)
  }
}

let templates: ReturnType<typeof parseTemplate>[] = []
let blankIssuesEnabled = true
if (tplDir) {
  let files: string[] = []
  try {
    // ISSUE_TEMPLATE がディレクトリでない・読めない場合はテンプレート無し扱い(exit 0 を保つ)
    files = fs.readdirSync(tplDir).sort()
  } catch {}
  // 読めないエントリ(ディレクトリ・権限なし等)はスキップし、常に JSON 出力までたどり着く
  const read = (f: string): string | null => {
    try {
      return fs.readFileSync(path.join(tplDir, f), "utf8")
    } catch {
      return null
    }
  }
  templates = files
    .filter((f) => /\.(md|ya?ml)$/.test(f) && f !== "config.yml")
    .map((f) => ({ f, content: read(f) }))
    .filter(
      (entry): entry is { f: string; content: string } => entry.content !== null
    )
    .map(({ f, content }) => parseTemplate(f, content))
  const configRaw = files.includes("config.yml") ? read("config.yml") : null
  if (configRaw !== null) {
    const config = parseTopLevel(configRaw)
    if (config.blank_issues_enabled !== undefined) {
      blankIssuesEnabled = config.blank_issues_enabled !== "false"
    }
  }
}

console.log(
  JSON.stringify(
    {
      isGitRepo,
      remoteUrl,
      repoSlug,
      ghInstalled,
      ghAuthenticated,
      templates,
      blankIssuesEnabled
    },
    null,
    2
  )
)
