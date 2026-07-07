/**
 * unified diff (git diff 形式) の軽量パーサ。
 * code 系ルール(dangerousPatterns / maxDiffLines / testDeletion / newDependency)が依存する。
 */

export interface DiffFile {
  path: string
  oldPath?: string
  /** 追加行(先頭の "+" を除いた内容) */
  additions: string[]
  /** 削除行(先頭の "-" を除いた内容) */
  deletions: string[]
  isNew: boolean
  isDeleted: boolean
  isRename: boolean
  isBinary: boolean
}

export interface ParsedDiff {
  files: DiffFile[]
  totalChangedLines: number
}

const DIFF_GIT_RE = /^diff --git a\/(.+) b\/(.+)$/
const OLD_FILE_RE = /^--- (?:a\/(.+)|\/dev\/null)$/
const NEW_FILE_RE = /^\+\+\+ (?:b\/(.+)|\/dev\/null)$/
const RENAME_FROM_RE = /^rename from (.+)$/
const RENAME_TO_RE = /^rename to (.+)$/
const BINARY_RE =
  /^Binary files (?:a\/(.+)|\/dev\/null) and (?:b\/(.+)|\/dev\/null) differ$/

/** diff --git ヘッダ、または --- / +++ / @@ の組が揃っているかで unified diff らしさを判定する */
function looksLikeDiff(text: string): boolean {
  const lines = text.split("\n")
  if (lines.some((l) => DIFF_GIT_RE.test(l))) return true
  const hasOld = lines.some((l) => l.startsWith("--- "))
  const hasNew = lines.some((l) => l.startsWith("+++ "))
  const hasHunk = lines.some((l) => l.startsWith("@@ "))
  return hasOld && hasNew && hasHunk
}

function emptyFile(path: string): DiffFile {
  return {
    path,
    additions: [],
    deletions: [],
    isNew: false,
    isDeleted: false,
    isRename: false,
    isBinary: false
  }
}

/**
 * unified diff をパースする。git diff 形式でない生コードが渡された場合は
 * files: [] を返す(呼び出し側で「非 diff」フォールバックとして全文検査させる)
 */
export function parseDiff(diff: string): ParsedDiff {
  if (!looksLikeDiff(diff)) {
    return { files: [], totalChangedLines: 0 }
  }

  const lines = diff.split("\n")
  const files: DiffFile[] = []
  let current: DiffFile | null = null
  let inHunk = false

  const flush = () => {
    if (current) files.push(current)
    current = null
    inHunk = false
  }

  for (const line of lines) {
    const gitMatch = line.match(DIFF_GIT_RE)
    if (gitMatch) {
      flush()
      current = emptyFile(gitMatch[2] ?? "")
      continue
    }
    if (!current) continue // diff --git より前のプリアンブルは無視

    if (line.startsWith("new file mode")) {
      current.isNew = true
      continue
    }
    if (line.startsWith("deleted file mode")) {
      current.isDeleted = true
      continue
    }

    const renameFrom = line.match(RENAME_FROM_RE)
    if (renameFrom) {
      current.oldPath = renameFrom[1]
      current.isRename = true
      continue
    }
    const renameTo = line.match(RENAME_TO_RE)
    if (renameTo) {
      current.path = renameTo[1] ?? current.path
      current.isRename = true
      continue
    }

    const binary = line.match(BINARY_RE)
    if (binary) {
      current.isBinary = true
      if (binary[1]) current.oldPath = binary[1]
      if (binary[2]) current.path = binary[2]
      continue
    }

    const oldFile = line.match(OLD_FILE_RE)
    if (oldFile) {
      if (oldFile[1]) {
        current.oldPath = oldFile[1]
      } else {
        current.isNew = true
      }
      continue
    }
    const newFile = line.match(NEW_FILE_RE)
    if (newFile) {
      if (newFile[1]) {
        current.path = newFile[1]
      } else {
        current.isDeleted = true
      }
      continue
    }

    if (line.startsWith("@@")) {
      inHunk = true
      continue
    }
    if (!inHunk) continue

    if (line.startsWith("+")) {
      current.additions.push(line.slice(1))
    } else if (line.startsWith("-")) {
      current.deletions.push(line.slice(1))
    }
    // コンテキスト行(先頭スペース)・"\ No newline at end of file" は無視
  }
  flush()

  const totalChangedLines = files.reduce(
    (sum, f) => sum + f.additions.length + f.deletions.length,
    0
  )

  return { files, totalChangedLines }
}
