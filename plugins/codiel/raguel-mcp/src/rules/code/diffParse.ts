/**
 * unified diff(Raguel が固定した書式で作る git diff)の解析。設計書 §6.2.2・§6.4.2。
 * 引用符付きのパスと 8 進エスケープを復号し、解釈できないファイル見出しを malformedHeaders に集める。
 * hunk の中は `@@` の行数で読み、削除行の `--- ` をファイル見出しと取り違えない。
 */

import type { DiffFile, ParsedDiff } from "../../core/types.js"

export interface DetailedDiffFile extends DiffFile {
  /** additions と同じ並びの、diff の本文での 1 始まりの行番号 */
  additionLines: number[]
  /** hunk ごとの行。先頭の 1 文字(" "・"+"・"-"・"\")を付けたまま持つ */
  hunks: string[][]
  /** このファイルの区間。diff の本文の 0 始まりの行番号で、start を含み end を含まない */
  start: number
  end: number
}

export interface DetailedParsedDiff extends ParsedDiff {
  files: DetailedDiffFile[]
  /** ファイル見出しの行(diff --git から最初の @@ までの行)。0 始まり */
  headingLines: number[]
}

const C_ESCAPES: Record<string, number> = {
  a: 7,
  b: 8,
  t: 9,
  n: 10,
  v: 11,
  f: 12,
  r: 13,
  '"': 34,
  "\\": 92
}

/** s[i] の `"` から始まる C 形式の引用符付きの文字列を読む。バイト列を UTF-8 として復号する */
function readQuoted(
  s: string,
  i: number
): { value: string; end: number } | null {
  const bytes: number[] = []
  let j = i + 1
  while (j < s.length) {
    const ch = s[j]
    if (ch === '"') {
      return { value: Buffer.from(bytes).toString("utf8"), end: j + 1 }
    }
    if (ch === "\\") {
      const oct = s.slice(j + 1, j + 4)
      if (/^[0-7]{3}$/.test(oct)) {
        bytes.push(Number.parseInt(oct, 8))
        j += 4
        continue
      }
      const code = C_ESCAPES[s[j + 1] ?? ""]
      if (code === undefined) return null
      bytes.push(code)
      j += 2
      continue
    }
    const cp = String.fromCodePoint(s.codePointAt(j) ?? 0)
    bytes.push(...Buffer.from(cp, "utf8"))
    j += cp.length
  }
  return null
}

/** 行の残り全体を 1 つのパスとして読む。引用符付きなら復号する */
function readWholePath(s: string): string | null {
  if (!s.startsWith('"')) return s
  const q = readQuoted(s, 0)
  return q && q.end === s.length ? q.value : null
}

function stripPrefix(value: string, prefix: "a/" | "b/"): string | null {
  return value.startsWith(prefix) ? value.slice(prefix.length) : null
}

/** `diff --git ` の後ろを読み、変更前と変更後のパスを返す */
function parseGitHeader(
  rest: string
): { oldPath: string; newPath: string } | null {
  if (rest.startsWith('"')) {
    const a = readQuoted(rest, 0)
    if (!a || rest[a.end] !== " ") return null
    const b = readWholePath(rest.slice(a.end + 1))
    const oldPath = stripPrefix(a.value, "a/")
    const newPath = b === null ? null : stripPrefix(b, "b/")
    return oldPath !== null && newPath !== null ? { oldPath, newPath } : null
  }
  if (!rest.startsWith("a/")) return null
  const quotedB = rest.indexOf(' "b/')
  if (quotedB >= 0) {
    const b = readWholePath(rest.slice(quotedB + 1))
    const newPath = b === null ? null : stripPrefix(b, "b/")
    return newPath === null
      ? null
      : { oldPath: rest.slice(2, quotedB), newPath }
  }
  // 空白を含む名前は区切りが決まらないので、変更前と変更後が同じ名前になる区切りを先に試す
  if ((rest.length - 5) % 2 === 0) {
    const n = (rest.length - 5) / 2
    const oldPath = rest.slice(2, 2 + n)
    if (rest.slice(2 + n, 5 + n) === " b/" && rest.slice(5 + n) === oldPath) {
      return { oldPath, newPath: oldPath }
    }
  }
  const sep = rest.indexOf(" b/")
  if (sep < 0) return null
  return { oldPath: rest.slice(2, sep), newPath: rest.slice(sep + 3) }
}

/** `--- ` と `+++ ` の後ろを読む。/dev/null は null、解釈できなければ undefined */
function parseFileLine(
  rest: string,
  prefix: "a/" | "b/"
): string | null | undefined {
  // git は空白を含む名前の後ろにタブを付ける
  const value = rest.replace(/\t$/, "")
  if (value === "/dev/null") return null
  const path = readWholePath(value)
  return path === null ? undefined : (stripPrefix(path, prefix) ?? undefined)
}

/**
 * ファイルの判定に使うパス。名前の変更なら移動先と移動元の 2 つ、それ以外は変更後のパスだけを返す。
 * 保護パスのファイルを外へ移して判定を抜ける経路を塞ぐため、移動元も見る(設計書 §6.4.2)
 */
export function sidePaths(file: DiffFile): string[] {
  return file.oldPath !== undefined && file.oldPath !== file.path
    ? [file.path, file.oldPath]
    : [file.path]
}

const HUNK_RE = /^@@ -\d+(?:,(\d+))? \+\d+(?:,(\d+))? @@/

function emptyFile(start: number): DetailedDiffFile {
  return {
    path: "",
    additions: [],
    deletions: [],
    isNew: false,
    isDeleted: false,
    isRename: false,
    isBinary: false,
    additionLines: [],
    hunks: [],
    start,
    end: start
  }
}

/** unified diff を解析する。`diff --git` より前の行と、diff でない本文は読み飛ばす */
export function parseDiff(diff: string): DetailedParsedDiff {
  const lines = diff === "" ? [] : diff.split("\n")
  const files: DetailedDiffFile[] = []
  const headingLines: number[] = []
  const malformedHeaders: string[] = []
  let current: DetailedDiffFile | null = null
  let oldLeft = 0
  let newLeft = 0

  lines.forEach((line, i) => {
    if (current && (oldLeft > 0 || newLeft > 0)) {
      const hunk = current.hunks[current.hunks.length - 1]
      hunk.push(line)
      const mark = line[0]
      if (mark === "+") {
        current.additions.push(line.slice(1))
        current.additionLines.push(i + 1)
        newLeft--
      } else if (mark === "-") {
        current.deletions.push(line.slice(1))
        oldLeft--
      } else if (mark !== "\\") {
        // コンテキスト行。末尾の空白を落とされた空行もここに入る
        oldLeft--
        newLeft--
      }
      current.end = i + 1
      return
    }

    if (line.startsWith("diff --git ")) {
      current = emptyFile(i)
      files.push(current)
      const header = parseGitHeader(line.slice("diff --git ".length))
      if (header) {
        current.path = header.newPath
        if (header.oldPath !== header.newPath) current.oldPath = header.oldPath
      } else {
        malformedHeaders.push(line)
      }
      headingLines.push(i)
      current.end = i + 1
      return
    }
    if (!current) return
    current.end = i + 1
    if (line.startsWith("\\") && current.hunks.length > 0) {
      // 最後の行の後ろの "\ No newline at end of file"
      current.hunks[current.hunks.length - 1].push(line)
      return
    }

    const hunk = line.match(HUNK_RE)
    if (hunk) {
      oldLeft = hunk[1] === undefined ? 1 : Number(hunk[1])
      newLeft = hunk[2] === undefined ? 1 : Number(hunk[2])
      current.hunks.push([])
      return
    }
    if (line.startsWith("@@")) {
      malformedHeaders.push(line)
      return
    }

    headingLines.push(i)
    if (line.startsWith("new file mode")) current.isNew = true
    else if (line.startsWith("deleted file mode")) current.isDeleted = true
    else if (line.startsWith("Binary files ")) current.isBinary = true
    else if (line.startsWith("rename from ") || line.startsWith("rename to ")) {
      const isFrom = line.startsWith("rename from ")
      const path = readWholePath(line.slice(isFrom ? 12 : 10))
      if (path === null) malformedHeaders.push(line)
      else if (isFrom) current.oldPath = path
      else current.path = path
      current.isRename = true
    } else if (line.startsWith("--- ") || line.startsWith("+++ ")) {
      const isOld = line.startsWith("--- ")
      const path = parseFileLine(line.slice(4), isOld ? "a/" : "b/")
      if (path === undefined) malformedHeaders.push(line)
      else if (path === null) {
        if (isOld) current.isNew = true
        else current.isDeleted = true
      } else if (isOld) {
        if (path !== current.path) current.oldPath = path
      } else {
        current.path = path
      }
    }
  })

  const totalChangedLines = files.reduce(
    (sum, f) => sum + f.additions.length + f.deletions.length,
    0
  )
  return { files, totalChangedLines, malformedHeaders, headingLines }
}
