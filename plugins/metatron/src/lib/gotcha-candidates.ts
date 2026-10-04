// 持続層(`<repoRoot>/docs/intents/domains/*.md`)にある `[GOTCHAS 候補]` の走査と、
// 台帳へ移した(または移さないと決めた)候補のエントリの削除。
//
// 書式(印・エントリの範囲・キー)の正本は codiel の `references/intent-format.md` の
// 「GOTCHAS 候補」にある。metatron は codiel のコードを import せず、
// ファイルの書式だけで連携する。
//
// 走査は読み取り経路であり、読めないものは warnings に積んで続ける。
// 削除は書き込み経路であり、拒否と失敗を `GotchaCandidateError` で投げる。
// 削除するのはエントリの範囲(と、空になった `## GOTCHAS 候補`)だけで、
// 範囲の外はバイト列のまま残す。

import crypto from "node:crypto"
import fs from "node:fs"
import path from "node:path"
import { DOMAINS_DIR_RELATIVE, findRepoRoot } from "./adr-candidates.js"
import { scanFences } from "./architecture.js"
import { parseGotchas } from "./gotchas.js"
import { hashContent } from "./staging.js"

/** 候補のキー。`append-gotcha` の入力のキーと同じ名前である。 */
export const CANDIDATE_KEYS = [
  "date",
  "run",
  "task",
  "mistake",
  "cause",
  "countermeasure",
  "promotionCandidate"
] as const

export type CandidateKey = (typeof CANDIDATE_KEYS)[number]

export interface GotchaCandidate {
  /** 持続層のファイルの絶対パス。`remove-gotcha-candidate --file` にそのまま渡せる。 */
  file: string
  /** repoRoot からの相対パス(区切りは "/")。 */
  relative: string
  /** 印を含む見出し行。 */
  heading: string
  /** 印を外し、前後の空白を落としたタイトル。 */
  title: string
  /** 値の行が無い・空のキーは null。`promotionCandidate` が Yes/No 以外のときは原文を残す。 */
  fields: Record<CandidateKey, string | null>
  /** 値が無いキーと、`promotionCandidate` が Yes/No 以外であることを表す文字列。 */
  problems: string[]
  /** エントリの範囲のバイト列の sha256(hex)。削除の `--hash` に渡す。 */
  hash: string
  /** 領域ファイル全体のバイト列の sha256(hex)。削除の `--file-hash` に渡す。 */
  fileHash: string
  /** 台帳のエントリのうち、タイトルが一致するものの ID。台帳が無ければ空。 */
  ledgerMatches: string[]
}

export interface ScanGotchaCandidatesResult {
  /** 走査の基準。git リポジトリでない・git が無いときは null で、走査しない。 */
  repoRoot: string | null
  candidates: GotchaCandidate[]
  warnings: string[]
}

export type GotchaCandidateErrorCode =
  | "not_git_repository"
  | "outside_domains_dir"
  | "file_not_found"
  | "file_changed"
  | "candidate_not_found"
  | "write_failed"

/** 削除の拒否と失敗。投げたときは持続層に何も書いていない。 */
export class GotchaCandidateError extends Error {
  readonly code: GotchaCandidateErrorCode

  constructor(code: GotchaCandidateErrorCode, message: string) {
    super(message)
    this.name = "GotchaCandidateError"
    this.code = code
  }
}

// ---------------------------------------------------------------------------
// 行の書式
// ---------------------------------------------------------------------------

// エントリの範囲を閉じる `##` と `###` の見出し。`####` 以下は範囲の中である。
const BOUNDARY_RE = /^ {0,3}#{2,3}(?:[ \t]|$)/
const H2_RE = /^ {0,3}##[ \t]+(.*?)[ \t]*$/
const H3_RE = /^ {0,3}###[ \t]+(.*)$/
// 印は見出しの末尾に置く。
const MARKED_HEADING_RE = /^(.*?)[ \t]*\[GOTCHAS 候補\][ \t]*$/
const FIELD_RE = new RegExp(
  `^ {0,3}-[ \\t]+(${CANDIDATE_KEYS.join("|")})[ \\t]*:[ \\t]*(.*?)[ \\t]*$`
)
const PARENT_HEADING = "GOTCHAS 候補"

// ---------------------------------------------------------------------------
// 持続層のファイルの解析
// ---------------------------------------------------------------------------

interface MarkedEntry {
  heading: string
  title: string
  /** 見出し行の 0 始まり行番号。 */
  start: number
  /** エントリの範囲の終端(この行は含まない)。次の `##` / `###` 見出し、または末尾。 */
  end: number
  /** 直前の `##` 見出しの行番号と、その範囲の終端(次の `##` 見出し、または末尾)。 */
  parent: { start: number; end: number; title: string } | null
  fields: Record<CandidateKey, string | null>
  problems: string[]
}

interface DomainFile {
  entries: MarkedEntry[]
  /** 行の先頭のバイト位置。`lines.length` 番目はファイルの長さを返す。 */
  offsetOf: (lineIndex: number) => number
  /** 行の本文(改行を除く)。 */
  lines: string[]
  buf: Buffer
}

// 行の境界をバイト列で求める。範囲の外を 1 バイトも変えずに差し替えるため、
// 文字列へ復号した長さではなく元のバイト位置を使う。
function lineOffsets(buf: Buffer): (lineIndex: number) => number {
  const offsets = [0]
  for (let i = 0; i < buf.length; i++) {
    if (buf[i] === 0x0a) offsets.push(i + 1)
  }
  return (lineIndex) => offsets[lineIndex] ?? buf.length
}

function parseDomainFile(buf: Buffer): DomainFile {
  const scan = scanFences(buf.toString("utf8"))
  const { insideFence } = scan
  const lines = scan.lines.map((l) => l.text)

  const boundaries: number[] = []
  for (let i = 0; i < lines.length; i++) {
    if (!insideFence[i] && BOUNDARY_RE.test(lines[i])) boundaries.push(i)
  }
  const h2s = boundaries.filter((i) => H2_RE.test(lines[i]))

  const entries: MarkedEntry[] = []
  boundaries.forEach((start, k) => {
    const h3 = H3_RE.exec(lines[start])
    if (h3 === null) return
    const mark = MARKED_HEADING_RE.exec(h3[1])
    if (mark === null) return
    const end = boundaries[k + 1] ?? lines.length

    let parent: MarkedEntry["parent"] = null
    const parentIndex = h2s.filter((i) => i < start).at(-1)
    if (parentIndex !== undefined) {
      parent = {
        start: parentIndex,
        end: h2s.find((i) => i > parentIndex) ?? lines.length,
        title: H2_RE.exec(lines[parentIndex])?.[1] ?? ""
      }
    }

    // キーの行は最初の 1 件を採る。
    const seen: Partial<Record<CandidateKey, string>> = {}
    for (let i = start + 1; i < end; i++) {
      if (insideFence[i]) continue
      const field = FIELD_RE.exec(lines[i])
      if (field === null) continue
      const key = field[1] as CandidateKey
      if (seen[key] === undefined) seen[key] = field[2]
    }

    const fields = {} as Record<CandidateKey, string | null>
    const problems: string[] = []
    for (const key of CANDIDATE_KEYS) {
      const value = seen[key]
      if (value === undefined || value === "") {
        fields[key] = null
        problems.push(`${key} の値がありません`)
        continue
      }
      fields[key] = value
      if (key === "promotionCandidate" && value !== "Yes" && value !== "No") {
        problems.push(
          `promotionCandidate は Yes か No にしてください(受領: ${value})`
        )
      }
    }

    entries.push({
      heading: lines[start],
      title: mark[1].trim(),
      start,
      end,
      parent,
      fields,
      problems
    })
  })

  return { entries, offsetOf: lineOffsets(buf), lines, buf }
}

function entryHash(file: DomainFile, entry: MarkedEntry): string {
  return hashContent(
    file.buf.subarray(file.offsetOf(entry.start), file.offsetOf(entry.end))
  )
}

function realpathOrSelf(p: string): string {
  try {
    return fs.realpathSync(p)
  } catch {
    return p
  }
}

// ---------------------------------------------------------------------------
// 走査(scan-gotcha-candidates)
// ---------------------------------------------------------------------------

function readTextOrNull(filePath: string): string | null {
  try {
    return fs.readFileSync(filePath, "utf8")
  } catch {
    return null
  }
}

export function scanGotchaCandidates(
  docRoot: string,
  gotchasPath: string
): ScanGotchaCandidatesResult {
  const repoRoot = findRepoRoot(docRoot)
  if (repoRoot === null) return { repoRoot: null, candidates: [], warnings: [] }

  const warnings: string[] = []
  const dir = path.join(repoRoot, DOMAINS_DIR_RELATIVE)
  let names: string[]
  try {
    names = fs
      .readdirSync(dir, { withFileTypes: true })
      .filter((d) => d.isFile() && d.name.endsWith(".md"))
      .map((d) => d.name)
      .sort()
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") {
      warnings.push(`${DOMAINS_DIR_RELATIVE} を読めませんでした。`)
    }
    return { repoRoot, candidates: [], warnings }
  }

  // 台帳のタイトルごとの ID。台帳が無ければ空のまま。
  const ledger = new Map<string, string[]>()
  const ledgerText = readTextOrNull(gotchasPath)
  if (ledgerText !== null) {
    for (const entry of parseGotchas(ledgerText).entries) {
      ledger.set(entry.title, [...(ledger.get(entry.title) ?? []), entry.id])
    }
  }

  const candidates: GotchaCandidate[] = []
  for (const name of names) {
    const filePath = path.join(dir, name)
    const relative = `${DOMAINS_DIR_RELATIVE}/${name}`
    let parsed: DomainFile
    try {
      parsed = parseDomainFile(fs.readFileSync(filePath))
    } catch {
      warnings.push(`${relative} を読めませんでした。`)
      continue
    }
    const fileHash = hashContent(parsed.buf)

    for (const entry of parsed.entries) {
      candidates.push({
        file: filePath,
        relative,
        heading: entry.heading,
        title: entry.title,
        fields: entry.fields,
        problems: entry.problems,
        hash: entryHash(parsed, entry),
        fileHash,
        ledgerMatches: ledger.get(entry.title) ?? []
      })
    }
  }

  return { repoRoot, candidates, warnings }
}

// ---------------------------------------------------------------------------
// 削除(remove-gotcha-candidate)
// ---------------------------------------------------------------------------

export interface RemoveGotchaCandidateInput {
  docRoot: string
  /** 削除する持続層のファイル(絶対パス)。 */
  file: string
  /** 走査のときのエントリの範囲のハッシュ。 */
  hash: string
  /** 走査のときの領域ファイル全体のハッシュ。 */
  fileHash: string
}

export interface RemoveGotchaCandidateResult {
  file: string
  title: string
}

// 書き込み先が repoRoot の docs/intents/domains/*.md であること。
// docRoot の外にあってよい。シンボリックリンクそのものは書き換えない。
function resolveDomainFile(
  repoRoot: string,
  file: string
): { target: string; mode: number } {
  const dir = path.join(repoRoot, DOMAINS_DIR_RELATIVE)
  const target = path.resolve(file)
  const outside = new GotchaCandidateError(
    "outside_domains_dir",
    `${file} は ${dir} の直下にある .md ではありません。削除はそこにある持続層のファイルだけを書き換えます。`
  )
  if (path.extname(target) !== ".md") throw outside
  if (realpathOrSelf(path.dirname(target)) !== realpathOrSelf(dir)) {
    throw outside
  }
  let stat: fs.Stats
  try {
    stat = fs.lstatSync(target)
  } catch {
    throw new GotchaCandidateError("file_not_found", `${target} がありません。`)
  }
  if (!stat.isFile()) throw outside
  return { target, mode: stat.mode & 0o777 }
}

function readTarget(target: string): Buffer {
  try {
    return fs.readFileSync(target)
  } catch {
    throw new GotchaCandidateError("file_not_found", `${target} を読めません。`)
  }
}

function writeAtomically(target: string, content: Buffer, mode: number): void {
  const tmp = `${target}.tmp-${crypto.randomUUID()}`
  try {
    fs.writeFileSync(tmp, content, { mode })
    fs.renameSync(tmp, target)
  } catch (error) {
    try {
      fs.rmSync(tmp, { force: true })
    } catch {
      // 後始末の失敗は握りつぶす
    }
    const reason = error instanceof Error ? error.message : String(error)
    throw new GotchaCandidateError(
      "write_failed",
      `${target} を書き込めませんでした: ${reason}`
    )
  }
}

function changedError(target: string): GotchaCandidateError {
  return new GotchaCandidateError(
    "file_changed",
    `${target} が走査のときから変わっています。走査し直してください。`
  )
}

/**
 * 印付きのエントリを持続層から消す。
 *
 * 消すのはエントリの範囲だけである。消した後、親の見出しが `## GOTCHAS 候補` で
 * その配下に空白だけの行しか残らなければ、見出しから次の `##` 見出しの直前
 * (無ければ末尾)までも消す。親が別の見出しのときは、見出しを残す。
 *
 * 拒否と失敗は `GotchaCandidateError` で投げ、そのとき持続層には何も書いていない。
 */
export function removeGotchaCandidate(
  input: RemoveGotchaCandidateInput
): RemoveGotchaCandidateResult {
  // 1. 書き込み先
  const repoRoot = findRepoRoot(input.docRoot)
  if (repoRoot === null) {
    throw new GotchaCandidateError(
      "not_git_repository",
      `${input.docRoot} は git リポジトリの中にないため、持続層の置き場を決められません。`
    )
  }
  const { target, mode } = resolveDomainFile(repoRoot, input.file)

  // 2. 走査の後にファイルが書き換わっていないこと。
  const buf = readTarget(target)
  if (hashContent(buf) !== input.fileHash) throw changedError(target)

  // 3. ハッシュが一致するエントリ。同じハッシュが複数あれば先頭の 1 件
  // (バイト列が同じなので、どれを消しても結果は同じ)。
  const parsed = parseDomainFile(buf)
  const entry = parsed.entries.find((e) => entryHash(parsed, e) === input.hash)
  if (entry === undefined) {
    throw new GotchaCandidateError(
      "candidate_not_found",
      `${target} にハッシュ ${input.hash} のエントリがありません。`
    )
  }

  // 4. 消す行の範囲。親が空になる `## GOTCHAS 候補` なら、親ごと消す。
  let from = entry.start
  let to = entry.end
  const parent = entry.parent
  if (parent !== null && parent.title === PARENT_HEADING) {
    let onlyBlank = true
    for (let i = parent.start + 1; i < parent.end; i++) {
      if (i >= entry.start && i < entry.end) continue
      if (parsed.lines[i].trim() !== "") {
        onlyBlank = false
        break
      }
    }
    if (onlyBlank) {
      from = parent.start
      to = parent.end
    }
  }
  const next = Buffer.concat([
    buf.subarray(0, parsed.offsetOf(from)),
    buf.subarray(parsed.offsetOf(to))
  ])

  // 5. 書き込みの直前に読み直し、2 と同じ照合をする。
  if (hashContent(readTarget(target)) !== input.fileHash) {
    throw changedError(target)
  }
  writeAtomically(target, next, mode)
  return { file: target, title: entry.title }
}
