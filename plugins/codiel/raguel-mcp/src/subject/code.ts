/**
 * evaluate_code の評価対象を git から取る(設計書 §6.2.1、§6.2.2)。
 * 入力の誤りは SubjectInputError で投げ、想定外の git の失敗は通常の Error で投げる。
 */
import { spawnSync } from "node:child_process"
import { createHash } from "node:crypto"
import * as fs from "node:fs"
import * as path from "node:path"
import { type Subject, type SubjectFile, SubjectInputError } from "./types"

/** 差分の上限。メモリを守るためのもので、内容の大きさは common/max-size が扱う */
export const MAX_DIFF_BYTES = 20 * 1024 * 1024

/** 利用者の git 設定で出力の書式が変わらないように固定する設定 */
const FIXED_CONFIG = [
  "-c",
  "core.quotePath=false",
  "-c",
  "diff.noprefix=false",
  "-c",
  "diff.mnemonicPrefix=false",
  "-c",
  "diff.relative=false",
  "-c",
  "color.ui=never"
]

interface GitResult {
  ok: boolean
  stdout: Buffer
  stderr: string
  overflow: boolean
}

/** git を実行する。パス指定は常に文字どおりに解釈させる */
export function runGit(
  cwd: string,
  args: string[],
  maxBuffer = 64 * 1024 * 1024
): GitResult {
  const res = spawnSync("git", ["-C", cwd, ...args], {
    env: { ...process.env, GIT_LITERAL_PATHSPECS: "1" },
    maxBuffer,
    stdio: ["ignore", "pipe", "pipe"]
  })
  const overflow =
    (res.error as NodeJS.ErrnoException | undefined)?.code === "ENOBUFS"
  return {
    ok: !res.error && res.status === 0,
    stdout: res.stdout ?? Buffer.alloc(0),
    stderr: res.stderr?.toString("utf-8") ?? String(res.error ?? ""),
    overflow
  }
}

function gitText(cwd: string, args: string[]): string | null {
  const res = runGit(cwd, args)
  return res.ok ? res.stdout.toString("utf-8").trim() : null
}

function commonDir(dir: string): string | null {
  const out = gitText(dir, [
    "rev-parse",
    "--path-format=absolute",
    "--git-common-dir"
  ])
  if (out === null) return null
  try {
    return fs.realpathSync(out)
  } catch {
    return null
  }
}

/**
 * repoPath を検証して、git を実行する作業ツリーを返す。
 * 省略時はプロジェクトルートを使う。照合するのは git の共通ディレクトリである。
 */
export function resolveRepoPath(
  repoPath: string | undefined,
  projectRoot: string
): string {
  if (repoPath === undefined) return projectRoot
  if (!path.isAbsolute(repoPath)) {
    throw new SubjectInputError(`repoPath は絶対パスで渡す: ${repoPath}`)
  }
  if (!fs.existsSync(repoPath) || !fs.statSync(repoPath).isDirectory()) {
    throw new SubjectInputError(`repoPath のディレクトリが無い: ${repoPath}`)
  }
  const rootCommon = commonDir(projectRoot)
  if (rootCommon === null) {
    throw new SubjectInputError(
      "プロジェクトルートが git の管理外なので repoPath を受けない"
    )
  }
  const repoCommon = commonDir(repoPath)
  if (repoCommon === null) {
    throw new SubjectInputError(
      `repoPath が git の作業ツリーでない: ${repoPath}`
    )
  }
  if (repoCommon !== rootCommon) {
    throw new SubjectInputError(
      `repoPath がプロジェクトルートと別のリポジトリにある: ${repoPath}`
    )
  }
  return repoPath
}

/** HEAD の 40 桁のコミットを返す。解決できなければ null */
export function readHead(repoPath: string): string | null {
  return gitText(repoPath, ["rev-parse", "--verify", "--quiet", "HEAD"])
}

/** baseRef をコミットに解決する */
export function resolveBaseRef(repoPath: string, baseRef: string): string {
  if (baseRef.startsWith("-")) {
    throw new SubjectInputError(`baseRef は - で始められない: ${baseRef}`)
  }
  const out = gitText(repoPath, [
    "rev-parse",
    "--verify",
    "--quiet",
    "--end-of-options",
    `${baseRef}^{commit}`
  ])
  if (!out) {
    throw new SubjectInputError(`baseRef をコミットに解決できない: ${baseRef}`)
  }
  return out
}

/** paths を検証する。repoPath 相対で、外へ出ないものだけを受ける */
export function validateRelativePaths(paths: string[]): void {
  for (const p of paths) {
    const norm = path.posix.normalize(p.replaceAll("\\", "/"))
    if (
      p === "" ||
      path.isAbsolute(p) ||
      norm === ".." ||
      norm.startsWith("../")
    ) {
      throw new SubjectInputError(
        `paths に repoPath 相対でないパスがある: ${p}`
      )
    }
  }
}

/** paths の範囲(無ければ作業ツリー全体)に未コミットの変更があれば入力の誤りにする */
export function assertNoUncommitted(repoPath: string, paths?: string[]): void {
  const res = runGit(repoPath, [
    ...FIXED_CONFIG,
    "status",
    "--porcelain",
    "--untracked-files=no",
    "--",
    ...(paths ?? [])
  ])
  if (!res.ok) throw new Error(`git status が失敗した: ${res.stderr}`)
  const changed = res.stdout.toString("utf-8").trim()
  if (changed !== "") {
    const first = changed.split("\n")[0]
    throw new SubjectInputError(
      `未コミットの変更があるので評価できない(${first} ほか)。コミットしてから呼び直す`
    )
  }
}

/** HEAD にあるパスの blob を返す。無ければ null。spec は "HEAD:<path>" の形 */
export function readBlob(repoPath: string, spec: string): Buffer | null {
  const res = runGit(repoPath, ["cat-file", "blob", spec])
  return res.ok ? res.stdout : null
}

export function sha256Hex(data: Buffer | string): string {
  return createHash("sha256").update(data).digest("hex")
}

interface NameStatus {
  status: string
  path: string
}

/** `git diff --name-status -z` の出力を読む。名前の変更とコピーは移った先のパスを採る */
export function parseNameStatusZ(out: string): NameStatus[] {
  const tokens = out.split("\0")
  const result: NameStatus[] = []
  let i = 0
  while (i < tokens.length && tokens[i] !== "") {
    const status = tokens[i] as string
    const twoPaths = status.startsWith("R") || status.startsWith("C")
    const p = tokens[twoPaths ? i + 2 : i + 1]
    if (p === undefined) throw new Error(`name-status を読めない: ${status}`)
    result.push({ status: status[0] as string, path: p })
    i += twoPaths ? 3 : 2
  }
  return result
}

export interface CodeSubjectInput {
  /** 呼び出し側が解決したプロジェクトルート */
  projectRoot: string
  repoPath?: string
  baseRef: string
  paths?: string[]
}

export interface CodeSubject {
  subject: Subject
  /** 固定した書式の unified diff */
  diff: string
  /** 差分が空なら true。入力の誤りにせず、変更なしとして扱う(R22) */
  empty: boolean
}

/** 設計書 §6.2.2 の手順 1〜6 のうち取得の部分を行う */
export function collectCodeSubject(input: CodeSubjectInput): CodeSubject {
  const repoPath = resolveRepoPath(input.repoPath, input.projectRoot)
  if (input.paths) validateRelativePaths(input.paths)
  const pathspec = input.paths ?? []

  const base = resolveBaseRef(repoPath, input.baseRef)
  const head = readHead(repoPath)
  if (head === null) {
    throw new SubjectInputError(`HEAD をコミットに解決できない: ${repoPath}`)
  }
  // 空の差分より先に見る。コミットし忘れたまま「変更なし」で通さない
  assertNoUncommitted(repoPath, input.paths)

  const diffRes = runGit(
    repoPath,
    [
      ...FIXED_CONFIG,
      "diff",
      "--no-ext-diff",
      "--no-textconv",
      "--no-color",
      "--src-prefix=a/",
      "--dst-prefix=b/",
      "--find-renames",
      "--unified=3",
      base,
      head,
      "--",
      ...pathspec
    ],
    MAX_DIFF_BYTES
  )
  if (diffRes.overflow) {
    throw new SubjectInputError(
      `差分が上限の ${MAX_DIFF_BYTES} バイトを超える。paths で範囲を絞る`
    )
  }
  if (!diffRes.ok) throw new Error(`git diff が失敗した: ${diffRes.stderr}`)
  const diff = diffRes.stdout.toString("utf-8")

  const nsRes = runGit(repoPath, [
    ...FIXED_CONFIG,
    "diff",
    "--no-ext-diff",
    "--name-status",
    "-z",
    "--find-renames",
    base,
    head,
    "--",
    ...pathspec
  ])
  if (!nsRes.ok) {
    throw new Error(`git diff --name-status が失敗した: ${nsRes.stderr}`)
  }
  const files: SubjectFile[] = parseNameStatusZ(
    nsRes.stdout.toString("utf-8")
  ).map(({ status, path: p }) => {
    if (status === "D") return { path: p, sha256: null, isNew: false }
    const blob = readBlob(repoPath, `${head}:${p}`)
    return {
      path: p,
      sha256: blob === null ? null : sha256Hex(blob),
      isNew: status === "A"
    }
  })

  const subject: Subject = { repoPath, head, base, files }
  if (input.paths) subject.paths = input.paths
  return { subject, diff, empty: diff === "" }
}
