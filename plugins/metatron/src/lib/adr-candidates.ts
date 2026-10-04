// 持続層(`<repoRoot>/docs/intents/domains/*.md`)にある `[ADR 候補]` の走査と、
// ADR を確定させた後の参照形への縮約(codiel intent 駆動化の設計書 §6.11)。
//
// 書式(印・候補 ID・エントリの範囲・5 つの小見出し・参照形・ADR の背景に書く
// `ADR 候補 ID:` の行)の正本は codiel の `references/intent-format.md` の
// 「持続層」セクションにある。metatron は codiel のコードを import せず、
// ファイルの書式だけで連携する。
//
// 走査は読み取り経路であり、読めないものは warnings に積んで続ける。
// 縮約は書き込み経路であり、拒否と失敗を `AdrCandidateError` で投げる。
// 縮約が書き換えるのはエントリの範囲だけで、範囲の外はバイト列のまま残す。

import { spawnSync } from "node:child_process"
import crypto from "node:crypto"
import fs from "node:fs"
import path from "node:path"
import {
  type AdrEntry,
  findAdrByNumber,
  formatAdrId,
  parseAdrDocument
} from "./adr.js"
import { scanFences } from "./architecture.js"
import { hashContent } from "./staging.js"

/** repoRoot からの持続層の置き場。設定では変えない(codiel の書式の正本と同じ)。 */
export const DOMAINS_DIR_RELATIVE = "docs/intents/domains"

/** 5 つの小見出し。`key` は stage-adr の入力の名前に揃えてある。 */
export const CANDIDATE_SECTIONS = [
  { key: "background", heading: "背景" },
  { key: "options", heading: "検討した選択肢" },
  { key: "conclusion", heading: "採用した結論" },
  { key: "rationale", heading: "理由" },
  { key: "impact", heading: "影響範囲" }
] as const

export type CandidateSectionKey = (typeof CANDIDATE_SECTIONS)[number]["key"]

export interface AdrCandidate {
  /** 持続層のファイルの絶対パス。`shrink-adr-candidate --file` にそのまま渡せる。 */
  file: string
  /** repoRoot からの相対パス(区切りは "/")。 */
  relative: string
  candidateId: string
  /** 印を含む見出し行。 */
  heading: string
  /** 印を外したタイトル。 */
  title: string
  constraint: string | null
  decidedOn: string | null
  sourceIntents: string[]
  sections: Record<CandidateSectionKey, string>
  /** エントリの範囲のバイト列の sha256(hex)。縮約の `--hash` に渡す。 */
  hash: string
  /** 本文に `ADR 候補 ID: <候補 ID>` の行を持つ ADR の番号。無ければ null。 */
  adoptedAs: string | null
}

export interface ScanAdrCandidatesResult {
  /** 走査の基準。git リポジトリでない・git が無いときは null で、走査しない。 */
  repoRoot: string | null
  candidates: AdrCandidate[]
  warnings: string[]
}

export type AdrCandidateErrorCode =
  | "not_git_repository"
  | "outside_domains_dir"
  | "file_not_found"
  | "candidate_not_found"
  | "duplicate_candidate"
  | "adr_not_found"
  | "candidate_id_line_missing"
  | "hash_mismatch"
  | "write_failed"

/** 縮約の拒否と失敗。投げたときは持続層に何も書いていない。 */
export class AdrCandidateError extends Error {
  readonly code: AdrCandidateErrorCode

  constructor(code: AdrCandidateErrorCode, message: string) {
    super(message)
    this.name = "AdrCandidateError"
    this.code = code
  }
}

// ---------------------------------------------------------------------------
// 行の書式
// ---------------------------------------------------------------------------

// エントリの範囲を閉じる `##` と `###` の見出し。`####` は範囲の中の小見出しである。
const BOUNDARY_RE = /^ {0,3}#{2,3}(?:[ \t]|$)/
const H3_RE = /^ {0,3}###[ \t]+(.*)$/
const SUBHEADING_RE = /^ {0,3}####[ \t]+(.*?)[ \t]*$/
const FIELD_RE =
  /^ {0,3}-[ \t]+(制約|決定日|出典 intent)[ \t]*:[ \t]*(.*?)[ \t]*$/
// 印の検索に使う語。これを含むのに下の形に合わない見出しは「候補 ID の無い印」とする。
const MARK_PREFIX = "[ADR 候補"
const MARKED_HEADING_RE = /^(.*?)[ \t]*\[ADR 候補: ([^\]\s]+-\d+)\][ \t]*$/
const MARK_STRIP_RE = /[ \t]*\[ADR 候補: [^\]]+\][ \t]*$/
// 参照形の `(候補 ID: <候補 ID>)`。取り出した値全体を候補 ID と比べ、部分一致を拾わない。
const REFERENCE_TOKEN_RE = /\(候補 ID: ([^)]+)\)/g
const ADR_CANDIDATE_LINE_RE = /^ADR 候補 ID: (.+)$/

// ---------------------------------------------------------------------------
// repoRoot
// ---------------------------------------------------------------------------

/**
 * docRoot から `git rev-parse --show-toplevel` で repoRoot を求める。
 * git リポジトリでない・git が無い・その他の失敗は区別せず null を返す
 * (config.ts の段 2 と同じ扱い。config.ts はこの関数を公開していない)。
 */
export function findRepoRoot(docRoot: string): string | null {
  try {
    const res = spawnSync("git", ["rev-parse", "--show-toplevel"], {
      cwd: docRoot,
      encoding: "utf8",
      timeout: 5000,
      windowsHide: true
    })
    if (res.status !== 0) return null
    const out = res.stdout?.trim()
    return out ? path.resolve(out) : null
  } catch {
    return null
  }
}

export function realpathOrSelf(p: string): string {
  try {
    return fs.realpathSync(p)
  } catch {
    return p
  }
}

function isInside(root: string, target: string): boolean {
  const rel = path.relative(root, target)
  return (
    rel !== ".." && !rel.startsWith(`..${path.sep}`) && !path.isAbsolute(rel)
  )
}

/**
 * 領域ディレクトリの実パスがリポジトリの実パスの配下にあるか。
 * ディレクトリ自体か祖先が外へ出るリンクなら false(リポジトリの中を指すリンクは true)。
 */
export function domainsDirStaysInRepo(repoRoot: string, dir: string): boolean {
  return isInside(realpathOrSelf(repoRoot), realpathOrSelf(dir))
}

// ---------------------------------------------------------------------------
// 持続層のファイルの解析
// ---------------------------------------------------------------------------

interface MarkedEntry {
  candidateId: string
  heading: string
  title: string
  /** 見出し行の 0 始まり行番号。 */
  start: number
  /** エントリの範囲の終端(この行は含まない)。次の `##` / `###` 見出し、または末尾。 */
  end: number
  /** 範囲の末尾の空行を除いた終端。縮約はここまでを置き換え、空行は残す。 */
  contentEnd: number
  constraintLine: string | null
  constraint: string | null
  decidedOn: string | null
  sourceIntents: string[]
  sections: Partial<Record<CandidateSectionKey, string>>
}

interface DomainFile {
  entries: MarkedEntry[]
  /** 印を持つが候補 ID の形に合わない見出し行。 */
  idlessHeadings: string[]
  /** 参照形の `(候補 ID: …)` から取り出した候補 ID。 */
  referenceIds: string[]
  /** 行の先頭のバイト位置。`lines.length` 番目はファイルの長さを返す。 */
  offsetOf: (lineIndex: number) => number
  buf: Buffer
}

function trimBlankLines(lines: string[]): string {
  let s = 0
  let e = lines.length
  while (s < e && lines[s].trim() === "") s++
  while (e > s && lines[e - 1].trim() === "") e--
  return lines.slice(s, e).join("\n")
}

// 行の境界をバイト列で求める。範囲の外を 1 バイトも変えずに差し替えるため、
// 文字列へ復号した長さではなく元のバイト位置を使う(0x0A は UTF-8 の復号で
// 他のバイトに飲み込まれないので、scanFences の行と 1 対 1 に対応する)。
function lineOffsets(buf: Buffer): (lineIndex: number) => number {
  const offsets = [0]
  for (let i = 0; i < buf.length; i++) {
    if (buf[i] === 0x0a) offsets.push(i + 1)
  }
  return (lineIndex) => offsets[lineIndex] ?? buf.length
}

function parseDomainFile(buf: Buffer): DomainFile {
  const { lines, insideFence } = scanFences(buf.toString("utf8"))

  const boundaries: number[] = []
  const referenceIds: string[] = []
  for (let i = 0; i < lines.length; i++) {
    if (insideFence[i]) continue
    if (BOUNDARY_RE.test(lines[i].text)) boundaries.push(i)
    for (const m of lines[i].text.matchAll(REFERENCE_TOKEN_RE)) {
      referenceIds.push(m[1].trim())
    }
  }

  const entries: MarkedEntry[] = []
  const idlessHeadings: string[] = []
  boundaries.forEach((start, k) => {
    const h3 = H3_RE.exec(lines[start].text)
    if (h3 === null || !h3[1].includes(MARK_PREFIX)) return
    const mark = MARKED_HEADING_RE.exec(h3[1])
    if (mark === null) {
      idlessHeadings.push(lines[start].text.trim())
      return
    }
    const end = boundaries[k + 1] ?? lines.length

    let contentEnd = end
    while (
      contentEnd > start + 1 &&
      !insideFence[contentEnd - 1] &&
      lines[contentEnd - 1].text.trim() === ""
    ) {
      contentEnd--
    }

    const entry: MarkedEntry = {
      candidateId: mark[2],
      heading: lines[start].text,
      title: mark[1].trim(),
      start,
      end,
      contentEnd,
      constraintLine: null,
      constraint: null,
      decidedOn: null,
      sourceIntents: [],
      sections: {}
    }

    // 5 つの小見出しだけが本文を区切る。ほかの `####` や重複した小見出しは、
    // 直前の小見出しの本文として扱い、内容を落とさない。
    const bodies: Partial<Record<CandidateSectionKey, string[]>> = {}
    let current: CandidateSectionKey | null = null
    for (let i = start + 1; i < end; i++) {
      const text = lines[i].text
      if (!insideFence[i]) {
        const sub = SUBHEADING_RE.exec(text)
        const def = sub && CANDIDATE_SECTIONS.find((s) => s.heading === sub[1])
        if (def && bodies[def.key] === undefined) {
          current = def.key
          bodies[current] = []
          continue
        }
        if (current === null) {
          const field = FIELD_RE.exec(text)
          if (field !== null) {
            if (field[1] === "出典 intent") {
              entry.sourceIntents.push(field[2])
            } else if (field[1] === "制約" && entry.constraint === null) {
              entry.constraint = field[2]
              entry.constraintLine = text
            } else if (field[1] === "決定日" && entry.decidedOn === null) {
              entry.decidedOn = field[2]
            }
            continue
          }
        }
      }
      if (current !== null) bodies[current]?.push(text)
    }
    for (const [key, body] of Object.entries(bodies)) {
      entry.sections[key as CandidateSectionKey] = trimBlankLines(body ?? [])
    }
    entries.push(entry)
  })

  return {
    entries,
    idlessHeadings,
    referenceIds,
    offsetOf: lineOffsets(buf),
    buf
  }
}

function entryHash(file: DomainFile, entry: MarkedEntry): string {
  return hashContent(
    file.buf.subarray(file.offsetOf(entry.start), file.offsetOf(entry.end))
  )
}

// ---------------------------------------------------------------------------
// ADR の `ADR 候補 ID:` の行
// ---------------------------------------------------------------------------

// 行の完全一致で読む。前後の空白だけは除く。部分文字列やタイトルでは判定しない。
function candidateIdsIn(entry: AdrEntry): string[] {
  const ids: string[] = []
  for (const line of entry.raw.split("\n")) {
    const m = ADR_CANDIDATE_LINE_RE.exec(line.trim())
    if (m !== null) ids.push(m[1])
  }
  return ids
}

function readTextOrNull(filePath: string): string | null {
  try {
    return fs.readFileSync(filePath, "utf8")
  } catch {
    return null
  }
}

// ---------------------------------------------------------------------------
// 走査(scan-adr-candidates)
// ---------------------------------------------------------------------------

export function scanAdrCandidates(
  docRoot: string,
  architecturePath: string
): ScanAdrCandidatesResult {
  const repoRoot = findRepoRoot(docRoot)
  if (repoRoot === null) return { repoRoot: null, candidates: [], warnings: [] }

  const warnings: string[] = []
  const dir = path.join(repoRoot, DOMAINS_DIR_RELATIVE)
  if (!domainsDirStaysInRepo(repoRoot, dir)) {
    warnings.push(
      `${DOMAINS_DIR_RELATIVE} の実体がリポジトリの外にあります。走査しません。`
    )
    return { repoRoot, candidates: [], warnings }
  }
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

  // 同じ候補 ID の行を持つ ADR が複数あれば、文書で先に現れるものを採る。
  const adopted = new Map<string, string>()
  const adrDoc = parseAdrDocument(readTextOrNull(architecturePath))
  for (const entry of adrDoc.entries) {
    for (const id of candidateIdsIn(entry)) {
      if (!adopted.has(id)) adopted.set(id, entry.id)
    }
  }

  const candidates: AdrCandidate[] = []
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

    for (const heading of parsed.idlessHeadings) {
      warnings.push(
        `${relative}: 見出し「${heading}」の印に候補 ID がありません。候補にしません。`
      )
    }

    const counts = new Map<string, number>()
    for (const id of [
      ...parsed.entries.map((e) => e.candidateId),
      ...parsed.referenceIds
    ]) {
      counts.set(id, (counts.get(id) ?? 0) + 1)
    }

    for (const entry of parsed.entries) {
      const count = counts.get(entry.candidateId) ?? 0
      if (count > 1) {
        warnings.push(
          `${relative}: 候補 ID ${entry.candidateId} がこのファイルに ${count} 回現れます。候補にしません。`
        )
        continue
      }
      const missing = CANDIDATE_SECTIONS.filter(
        (s) => entry.sections[s.key] === undefined
      ).map((s) => s.heading)
      if (missing.length > 0) {
        warnings.push(
          `${relative}: 候補 ${entry.candidateId} に小見出しが揃っていません(欠け: ${missing.join("、")})。候補にしません。`
        )
        continue
      }
      candidates.push({
        file: filePath,
        relative,
        candidateId: entry.candidateId,
        heading: entry.heading,
        title: entry.title,
        constraint: entry.constraint,
        decidedOn: entry.decidedOn,
        sourceIntents: entry.sourceIntents,
        sections: entry.sections as Record<CandidateSectionKey, string>,
        hash: entryHash(parsed, entry),
        adoptedAs: adopted.get(entry.candidateId) ?? null
      })
    }
  }

  return { repoRoot, candidates, warnings }
}

// ---------------------------------------------------------------------------
// 縮約(shrink-adr-candidate)
// ---------------------------------------------------------------------------

export interface ShrinkAdrCandidateInput {
  docRoot: string
  architecturePath: string
  /** 縮約する持続層のファイル(絶対パス)。 */
  file: string
  candidateId: string
  adrNumber: number
  /** 走査のときのエントリの範囲のハッシュ。 */
  hash: string
}

export interface ShrinkAdrCandidateResult {
  file: string
  candidateId: string
  adr: string
  /** false は、エントリが既に参照形だったこと(何も書いていない)を表す。 */
  written: boolean
}

// 手順 1: 書き込み先が repoRoot の docs/intents/domains/*.md であること。
// docRoot の外にあってよい。シンボリックリンクそのものは書き換えない。
function resolveDomainFile(
  repoRoot: string,
  file: string
): { target: string; mode: number } {
  const dir = path.join(repoRoot, DOMAINS_DIR_RELATIVE)
  const target = path.resolve(file)
  const outside = new AdrCandidateError(
    "outside_domains_dir",
    `${file} は ${dir} の直下にある .md ではありません。縮約はそこにある持続層のファイルだけを書き換えます。`
  )
  if (path.extname(target) !== ".md") throw outside
  // 領域ディレクトリ自体か祖先が外へ出るリンクなら、実体が外にあるので拒否する。
  if (!domainsDirStaysInRepo(repoRoot, dir)) throw outside
  if (realpathOrSelf(path.dirname(target)) !== realpathOrSelf(dir)) {
    throw outside
  }
  let stat: fs.Stats
  try {
    stat = fs.lstatSync(target)
  } catch {
    throw new AdrCandidateError("file_not_found", `${target} がありません。`)
  }
  if (!stat.isFile()) throw outside
  return { target, mode: stat.mode & 0o777 }
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
    throw new AdrCandidateError(
      "write_failed",
      `${target} を書き込めませんでした: ${reason}`
    )
  }
}

/**
 * 印付きのエントリを参照形に縮める(設計書 §6.11.4 の手順 2)。
 *
 * 拒否と失敗は `AdrCandidateError` で投げ、そのとき持続層には何も書いていない。
 * 毎回そのときのファイルを読むので、同じファイルの候補を順に縮約しても
 * 先に縮約したエントリは参照形のまま残る。
 */
export function shrinkAdrCandidate(
  input: ShrinkAdrCandidateInput
): ShrinkAdrCandidateResult {
  const { candidateId } = input
  const adr = formatAdrId(input.adrNumber)

  // 1. 書き込み先
  const repoRoot = findRepoRoot(input.docRoot)
  if (repoRoot === null) {
    throw new AdrCandidateError(
      "not_git_repository",
      `${input.docRoot} は git リポジトリの中にないため、持続層の置き場を決められません。`
    )
  }
  const { target, mode } = resolveDomainFile(repoRoot, input.file)

  // 2. 候補 ID でエントリを特定する。既に参照形なら何もしない。
  const parsed = parseDomainFile(fs.readFileSync(target))
  const marked = parsed.entries.filter((e) => e.candidateId === candidateId)
  const references = parsed.referenceIds.filter((id) => id === candidateId)
  if (marked.length === 0) {
    if (references.length > 0) {
      return { file: target, candidateId, adr, written: false }
    }
    throw new AdrCandidateError(
      "candidate_not_found",
      `${target} に候補 ID ${candidateId} のエントリがありません。`
    )
  }
  if (marked.length + references.length > 1) {
    throw new AdrCandidateError(
      "duplicate_candidate",
      `${target} に候補 ID ${candidateId} が ${marked.length + references.length} 回現れます。どのエントリを縮めるか決められません。`
    )
  }
  const entry = marked[0]

  // 3. ADR が在り、本文に `ADR 候補 ID: <候補 ID>` の行を持つこと。
  const adrEntry = findAdrByNumber(
    parseAdrDocument(readTextOrNull(input.architecturePath)),
    input.adrNumber
  )
  if (adrEntry === null) {
    throw new AdrCandidateError(
      "adr_not_found",
      `${input.architecturePath} に ${adr} がありません。`
    )
  }
  if (!candidateIdsIn(adrEntry).includes(candidateId)) {
    throw new AdrCandidateError(
      "candidate_id_line_missing",
      `${adr} の本文に「ADR 候補 ID: ${candidateId}」の行がありません。`
    )
  }

  // 4. 走査のときからエントリが変わっていないこと。
  if (entryHash(parsed, entry) !== input.hash) {
    throw new AdrCandidateError(
      "hash_mismatch",
      `候補 ${candidateId} のエントリが走査のときから変わっています。走査し直してください。`
    )
  }

  // 5. エントリの範囲だけを参照形に置き換える。末尾の空行と範囲の外はそのまま残す。
  const heading = parsed.buf.subarray(
    parsed.offsetOf(entry.start),
    parsed.offsetOf(entry.start + 1)
  )
  const eol = heading.toString("utf8").endsWith("\r\n") ? "\r\n" : "\n"
  const lastLine = parsed.buf
    .subarray(
      parsed.offsetOf(entry.contentEnd - 1),
      parsed.offsetOf(entry.contentEnd)
    )
    .toString("utf8")
  const terminator = lastLine.endsWith("\r\n")
    ? "\r\n"
    : lastLine.endsWith("\n")
      ? "\n"
      : ""
  const replacement = [
    entry.heading.replace(MARK_STRIP_RE, ""),
    ...(entry.constraintLine === null ? [] : [entry.constraintLine]),
    `- 関連 ADR: ${adr}(候補 ID: ${candidateId})`
  ].join(eol)

  const next = Buffer.concat([
    parsed.buf.subarray(0, parsed.offsetOf(entry.start)),
    Buffer.from(`${replacement}${terminator}`, "utf8"),
    parsed.buf.subarray(parsed.offsetOf(entry.contentEnd))
  ])
  writeAtomically(target, next, mode)
  return { file: target, candidateId, adr, written: true }
}
