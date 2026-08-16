// ARCHITECTURE.md の解析・セクション置換・ドメインマップの抽出と検証。
//
// 規則の正本はファイル契約
// `harness-docs/design/2026-08-16-file-contract-freeze.md` の
// §1(マーカー `metatron:domains` と検証 4 項目)と
// §4(セクション構成・分割の規範アルゴリズム・`unclosed_fence` の 2 層)。
//
// このモジュールは**例外を投げない**。異常はすべて結果オブジェクトの
// `error` / `warnings` に載せて返し、「拒否するか続行するか」の判断は
// 呼び出し元に委ねる。書き込み経路(第 1 層・フェイルクローズド)は
// `parseArchitectureForWrite` / `prepareArchitectureUpdate` を、
// 読み取り・注入経路(第 2 層・フェイルオープン)は
// `parseArchitectureForRead` を使う(契約 §4-3)。
//
// パス解決は config.ts の責務であり、このモジュールは文字列
// (または既に解決済みの絶対パス)だけを受け取る。

import fs from "node:fs"

/** 契約 §4-1。ファイルタイトルの行。 */
export const ARCHITECTURE_TITLE = "# ARCHITECTURE"

/** 契約 §4-1 の 10 セクション。見出し名と順序を固定する。 */
export const ARCHITECTURE_HEADINGS = [
  "システム概要",
  "技術スタック",
  "レイヤー構造",
  "ディレクトリ構成と責務",
  "ドメインマップ",
  "コマンド定義",
  "テスト方針",
  "保護パス",
  "規約",
  "ADR 一覧"
] as const

export type ArchitectureHeading = (typeof ARCHITECTURE_HEADINGS)[number]

export const ADR_HEADING = "ADR 一覧"
export const DOMAINS_HEADING = "ドメインマップ"

/** 契約 §1。旧マーカー `codiel:domains` は読まない。 */
export const DOMAINS_MARKER = "metatron:domains"

/** 廃止済みの疑似キー(契約 §4-1)。小文字で比較する。 */
const RETIRED_PSEUDO_KEYS = new Set(["overview"])

export const UNCLOSED_FENCE_WARNING =
  "閉じていないコードフェンスがあります。未閉フェンス以降を 1 セクションとして扱いました。"

// ---------------------------------------------------------------------------
// 行の分割と正規化(契約 §4-2「行の正規化」)
// ---------------------------------------------------------------------------

export interface ArchitectureLine {
  /** 改行を含む原文のまま。連結すると元の文字列に戻る。 */
  raw: string
  /** 判定用。末尾の改行と `\r` を除いたもの。 */
  text: string
}

type Line = ArchitectureLine

// 改行の直後で分割する。`raw` を連結すると元の文字列に戻る(バイト単位の再結合)。
function splitLines(text: string): Line[] {
  if (text === "") return []
  return text.split(/(?<=\n)/).map((raw) => ({
    raw,
    text: raw.replace(/\n$/, "").replace(/\r$/, "")
  }))
}

function joinRaw(lines: Line[], start: number, end: number): string {
  let out = ""
  for (let i = start; i < end; i++) out += lines[i].raw
  return out
}

function detectEol(text: string): "\n" | "\r\n" {
  return text.includes("\r\n") ? "\r\n" : "\n"
}

// 契約 §4-2 規則 1。行頭は 0〜3 個の半角スペースのインデントを許容する
// (タブは行頭のインデントとして扱わない)。
const FENCE_OPEN_RE = /^ {0,3}(`{3,}|~{3,})(.*)$/
// 契約 §4-2 規則 2。開始と同じ文字を同数以上連続させ、その後に info string を
// 持たない行。連続の後に半角スペース・タブのみが続く場合も終了フェンスとする。
const FENCE_CLOSE_RE = /^ {0,3}(`+|~+)[ \t]*$/
// 契約 §4-2 規則 4。`#` 2 個の直後に半角スペース。`#` 1 個と `###` 以下は見出しにしない。
const HEADING_RE = /^ {0,3}## (.*)$/

interface FenceState {
  char: string
  count: number
  info: string
}

function matchFenceOpen(lineText: string): FenceState | null {
  const m = FENCE_OPEN_RE.exec(lineText)
  if (!m) return null
  return { char: m[1][0], count: m[1].length, info: m[2] }
}

function isFenceClose(lineText: string, fence: FenceState): boolean {
  const m = FENCE_CLOSE_RE.exec(lineText)
  if (!m) return false
  if (m[1][0] !== fence.char) return false
  return m[1].length >= fence.count
}

export interface FenceScan {
  /** 行の分割結果。`raw` を連結すると元の文字列に戻る。 */
  lines: ArchitectureLine[]
  /** フェンスの内側(開始行・終了行を含む)。見出し判定から除外する。 */
  insideFence: boolean[]
  /** 契約 §4-2 規則 5。終端に達してもフェンスが閉じていない。 */
  unclosed: boolean
  /** 支配的な改行コード。 */
  eol: "\n" | "\r\n"
}

/**
 * 契約 §4-2 の状態機械そのもの。行を走査し、フェンスの内側に印を付ける。
 *
 * セクション分解(`parseArchitecture`)と、節の中を `###` で刻む adr.ts が
 * **同一の実装**でフェンスを扱うための唯一の入口である。フェンス判定を各所で
 * 書き直すと、同じ文書に対して分解が食い違う(契約 §1 の「独自のフェンス判定を
 * 書かない」と同じ理由)。
 */
export function scanFences(text: string): FenceScan {
  const lines = splitLines(text)
  const insideFence = new Array<boolean>(lines.length).fill(false)

  let fence: FenceState | null = null
  for (let i = 0; i < lines.length; i++) {
    const t = lines[i].text
    if (fence === null) {
      // 規則 1: フェンスの開始。
      const open = matchFenceOpen(t)
      if (open !== null) {
        fence = open
        insideFence[i] = true
      }
      continue
    }
    // 規則 2・3: フェンス内は本文。閉じるまで見出し判定を行わない。
    insideFence[i] = true
    if (isFenceClose(t, fence)) fence = null
  }

  return { lines, insideFence, unclosed: fence !== null, eol: detectEol(text) }
}

// ---------------------------------------------------------------------------
// セクション分解
// ---------------------------------------------------------------------------

export interface ArchitectureSection {
  /** `## ` を除いた見出し名(前後の空白を除去したもの)。 */
  heading: string
  /** 原文の見出し行(改行を含まない)。 */
  headingLine: string
  /** 見出し行の行番号(0 始まり)。 */
  startLine: number
  /** 末尾の空行を除いた本文の終端(排他的)。 */
  contentEndLine: number
  /** セクションの終端(排他的)。次の見出し行、または EOF。 */
  endLine: number
  /** 見出し行を除く本文。原文のまま(末尾の空行を含む)。 */
  body: string
  /** 見出し行を含むセクション全文。原文のまま。 */
  raw: string
}

export type ArchitectureError = "unclosed_fence"

export interface ArchitectureDocument {
  /** 与えられた原文。 */
  text: string
  /** 支配的な改行コード。書き戻すときはこれを使う。 */
  eol: "\n" | "\r\n"
  /** 最初の `##` 見出しより前の区画(ファイルタイトルを含む)。原文のまま。 */
  preamble: string
  /** 出現順のセクション。同名が複数あっても全件を保持する。 */
  sections: ArchitectureSection[]
  /** 契約 §4-2 規則 5。未閉フェンスなら `"unclosed_fence"`。 */
  error: ArchitectureError | null
  /** 拒否しない指摘(前置きの本文・同名見出しの重複)。 */
  warnings: string[]
}

/**
 * 契約 §4-2 の状態機械によるセクション分解。
 *
 * 例外を投げない。未閉フェンスは `error` に載せて返し、拒否するかどうかは
 * 呼び出し元(書き込み経路 / 読み取り経路)が決める。
 * 未閉フェンス以降はフェンス内として走査を続けるため、結果として
 * 「未閉フェンス以降が 1 セクション扱い」になる(契約 §4-3)。
 */
export function parseArchitecture(text: string): ArchitectureDocument {
  const scan = scanFences(text)
  const lines = scan.lines
  const eol = scan.eol

  const starts: number[] = []
  const headings: string[] = []

  for (let i = 0; i < lines.length; i++) {
    // 規則 3: フェンス内の行は本文。行頭が `## ` でも見出しにしない。
    if (scan.insideFence[i]) continue
    const heading = HEADING_RE.exec(lines[i].text)
    if (heading) {
      starts.push(i)
      headings.push(heading[1].trim())
    }
  }

  const sections: ArchitectureSection[] = []
  for (let s = 0; s < starts.length; s++) {
    const startLine = starts[s]
    const endLine = s + 1 < starts.length ? starts[s + 1] : lines.length
    let contentEndLine = endLine
    while (
      contentEndLine > startLine + 1 &&
      lines[contentEndLine - 1].text.trim() === ""
    ) {
      contentEndLine--
    }
    const body = joinRaw(lines, startLine + 1, endLine)
    sections.push({
      heading: headings[s],
      headingLine: lines[startLine].text,
      startLine,
      contentEndLine,
      endLine,
      body,
      raw: lines[startLine].raw + body
    })
  }

  const preambleEnd = starts.length > 0 ? starts[0] : lines.length
  const warnings: string[] = []

  // 契約 §4-1: `# ARCHITECTURE` と最初の `##` の間に本文を置かない。
  // あっても拒否せず警告する。
  let strayLines = 0
  for (let i = 0; i < preambleEnd; i++) {
    const t = lines[i].text
    if (t.trim() === "") continue
    if (/^ {0,3}# /.test(t)) continue
    strayLines++
  }
  if (strayLines > 0) {
    warnings.push(
      `${ARCHITECTURE_TITLE} と最初の ## 見出しの間に本文が ${strayLines} 行あります。` +
        "冒頭の概要は `## システム概要` に移してください。"
    )
  }

  // 契約 §4-2: 同名の見出しが複数あるときは最初のものを採り、重複を警告する。
  const counts = new Map<string, number>()
  for (const h of headings) counts.set(h, (counts.get(h) ?? 0) + 1)
  for (const [h, n] of counts) {
    if (n > 1) {
      warnings.push(
        `## ${h} が ${n} 個あります。最初のものだけを対象にします。`
      )
    }
  }

  return {
    text,
    eol,
    preamble: joinRaw(lines, 0, preambleEnd),
    sections,
    error: scan.unclosed ? "unclosed_fence" : null,
    warnings
  }
}

/**
 * 読み取り・注入経路(第 2 層・フェイルオープン)用の入口。
 * 未閉フェンスでも結果を返し、警告を 1 行添える(契約 §4-3)。
 */
export function parseArchitectureForRead(text: string): ArchitectureDocument {
  const doc = parseArchitecture(text)
  if (doc.error === null) return doc
  return { ...doc, warnings: [...doc.warnings, UNCLOSED_FENCE_WARNING] }
}

export type ArchitectureParseForWrite =
  | { ok: true; doc: ArchitectureDocument; warnings: string[] }
  | {
      ok: false
      error: ArchitectureError
      message: string
      warnings: string[]
    }

/**
 * 書き込み経路(第 1 層・フェイルクローズド)用の入口。
 * 未閉フェンスは拒否する。壊れた構造の上でセクションを差し替えると、
 * 対象外セクションを巻き込んで破壊しうるため(契約 §4-3)。
 */
export function parseArchitectureForWrite(
  text: string
): ArchitectureParseForWrite {
  const doc = parseArchitecture(text)
  if (doc.error !== null) {
    return {
      ok: false,
      error: doc.error,
      message:
        "閉じていないコードフェンスがあるため、セクションの差し替えを行いません。" +
        "フェンスを閉じてから再実行してください。",
      warnings: doc.warnings
    }
  }
  return { ok: true, doc, warnings: doc.warnings }
}

/** 同名の見出しが複数あるときは最初のものを返す(契約 §4-2)。 */
export function findSection(
  doc: ArchitectureDocument,
  heading: string
): ArchitectureSection | undefined {
  return doc.sections.find((s) => s.heading === heading)
}

export function isArchitectureHeading(
  value: string
): value is ArchitectureHeading {
  return (ARCHITECTURE_HEADINGS as readonly string[]).includes(value)
}

function canonicalIndex(heading: string): number {
  return (ARCHITECTURE_HEADINGS as readonly string[]).indexOf(heading)
}

// ---------------------------------------------------------------------------
// 見出しキーの検証(契約 §4-1)
// ---------------------------------------------------------------------------

export type HeadingKeyError =
  | "adr_heading"
  | "retired_overview_key"
  | "unknown_heading"

export type HeadingKeyValidation =
  | { ok: true; heading: ArchitectureHeading }
  | { ok: false; error: HeadingKeyError; message: string }

/**
 * `heading` キーの検証。契約 §4-1 の 10 キー以外はエラー。
 *
 * - `ADR 一覧` は専用のエラーにし、`stage-adr` へ誘導する。
 *   丸ごと差し替えを許すと採番・状態の値域・状態変更履歴の追記を迂回できるため。
 * - `overview` 疑似キーは廃止済み。
 */
export function validateHeadingKey(heading: unknown): HeadingKeyValidation {
  if (typeof heading !== "string" || heading.trim() === "") {
    return {
      ok: false,
      error: "unknown_heading",
      message: `heading が空です。指定できるのは ${ARCHITECTURE_HEADINGS.join(" / ")} のいずれかです。`
    }
  }
  const value = heading.trim()
  if (value === ADR_HEADING) {
    return {
      ok: false,
      error: "adr_heading",
      message:
        "`ADR 一覧` は stage-architecture では変更できません。ADR の追加・状態変更は stage-adr を使ってください。" +
        "節ごとの差し替えを許すと、採番・`状態` の値域・状態変更履歴の追記をすべて迂回できるためです。"
    }
  }
  if (RETIRED_PSEUDO_KEYS.has(value.toLowerCase())) {
    return {
      ok: false,
      error: "retired_overview_key",
      message:
        "`overview` 疑似キーは廃止しました。冒頭の概要は `システム概要` セクションに書いてください。"
    }
  }
  if (!isArchitectureHeading(value)) {
    return {
      ok: false,
      error: "unknown_heading",
      message: `未知の見出し「${value}」です。指定できるのは ${ARCHITECTURE_HEADINGS.join(" / ")} のいずれかです。`
    }
  }
  return { ok: true, heading: value }
}

// ---------------------------------------------------------------------------
// ドメインマップ(契約 §1)
// ---------------------------------------------------------------------------

export interface DomainsBlock {
  /** 開始フェンス行の行番号(0 始まり)。 */
  fenceLine: number
  /** 開始行と終了フェンスの間の文字列。原文のまま。 */
  content: string
  /** 終了フェンスが見つかったか。 */
  closed: boolean
}

// 開始行は ```json metatron:domains に固定する(契約 §1)。
// info string の空白の量は契約 §4-2 の正規化に従って許容するが、
// トークンの構成は固定する。`codiel:domains` は一致しない。
function isDomainsInfo(info: string): boolean {
  const tokens = info
    .trim()
    .split(/[ \t]+/)
    .filter(Boolean)
  return (
    tokens.length === 2 && tokens[0] === "json" && tokens[1] === DOMAINS_MARKER
  )
}

export interface DomainsBlockLookup {
  block: DomainsBlock | null
  warnings: string[]
}

/**
 * `metatron:domains` ブロックを探す。フェンスの判定は §4-2 の状態機械と同一の
 * 規則で行う(独自のフェンス判定を書かない。契約 §1)。
 */
export function findDomainsBlock(text: string): DomainsBlockLookup {
  const lines = splitLines(text)
  const blocks: DomainsBlock[] = []
  const warnings: string[] = []

  let fence: FenceState | null = null
  let openIndex = -1
  let isTarget = false

  for (let i = 0; i < lines.length; i++) {
    const t = lines[i].text
    if (fence) {
      if (isFenceClose(t, fence)) {
        if (isTarget) {
          blocks.push({
            fenceLine: openIndex,
            content: joinRaw(lines, openIndex + 1, i),
            closed: true
          })
        }
        fence = null
        isTarget = false
      }
      continue
    }
    const open = matchFenceOpen(t)
    if (open) {
      fence = open
      openIndex = i
      isTarget = isDomainsInfo(open.info)
    }
  }

  if (fence && isTarget) {
    blocks.push({
      fenceLine: openIndex,
      content: joinRaw(lines, openIndex + 1, lines.length),
      closed: false
    })
  }

  if (blocks.length > 1) {
    // 契約 §1 に未確定として残っている点。最初のものを採り、そのことを警告する。
    warnings.push(
      `\`${DOMAINS_MARKER}\` ブロックが ${blocks.length} 個あります。最初のものだけを使用します。`
    )
  }
  if (blocks.length > 0 && !blocks[0].closed) {
    warnings.push(
      `\`${DOMAINS_MARKER}\` ブロックが閉じていません。ファイル終端までを内容として扱いました。`
    )
  }

  return { block: blocks[0] ?? null, warnings }
}

export type DomainsReason =
  | "block_not_found"
  | "invalid_json"
  | "not_an_object"
  | "no_domains"
  | "invalid_globs"

export type DomainsValidation =
  | { ok: true; domains: Record<string, string[]> }
  | { ok: false; reason: DomainsReason; message: string }

/**
 * 契約 §1 の検証 4 項目のうち 2〜4(値の形)。1(有効な JSON)は
 * `parseDomainsContent` が担う。
 */
export function validateDomainsValue(value: unknown): DomainsValidation {
  // 2. トップレベルがオブジェクトで、配列でない。
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return {
      ok: false,
      reason: "not_an_object",
      message: `\`${DOMAINS_MARKER}\` のトップレベルはオブジェクトである必要があります(配列・null は不可)。`
    }
  }
  const entries = Object.entries(value as Record<string, unknown>)
  // 4. キーが 1 個以上ある。
  if (entries.length === 0) {
    return {
      ok: false,
      reason: "no_domains",
      message: `\`${DOMAINS_MARKER}\` にドメインが 1 個もありません。分割が馴染まない場合は {"generic": ["**"]} に縮退させてください。`
    }
  }
  // 3. 各値が 1 要素以上の文字列配列である。
  for (const [key, globs] of entries) {
    if (!Array.isArray(globs) || globs.length === 0) {
      return {
        ok: false,
        reason: "invalid_globs",
        message: `ドメイン「${key}」の値が 1 要素以上の配列ではありません。`
      }
    }
    if (globs.some((g) => typeof g !== "string")) {
      return {
        ok: false,
        reason: "invalid_globs",
        message: `ドメイン「${key}」の値に文字列でない要素があります。`
      }
    }
  }
  return { ok: true, domains: value as Record<string, string[]> }
}

/** ブロック内の文字列を JSON として解釈し、契約 §1 の 4 項目を検証する。 */
export function parseDomainsContent(content: string): DomainsValidation {
  let parsed: unknown
  try {
    parsed = JSON.parse(content)
  } catch {
    return {
      ok: false,
      reason: "invalid_json",
      message: `\`${DOMAINS_MARKER}\` ブロックが有効な JSON ではありません。`
    }
  }
  return validateDomainsValue(parsed)
}

export interface DomainsResult {
  ok: boolean
  domains: Record<string, string[]> | null
  reason: DomainsReason | null
  message: string | null
  warnings: string[]
}

/**
 * 文書から `metatron:domains` を抽出する。読み取り経路で使う。
 * 読めない場合は例外ではなく `{ ok: false, reason }` を返す(契約 §1)。
 */
export function extractDomains(text: string): DomainsResult {
  const { block, warnings } = findDomainsBlock(text)
  if (!block) {
    return {
      ok: false,
      domains: null,
      reason: "block_not_found",
      message: `\`${DOMAINS_MARKER}\` ブロックが見つかりません。`,
      warnings
    }
  }
  const result = parseDomainsContent(block.content)
  if (!result.ok) {
    return {
      ok: false,
      domains: null,
      reason: result.reason,
      message: result.message,
      warnings
    }
  }
  return {
    ok: true,
    domains: result.domains,
    reason: null,
    message: null,
    warnings
  }
}

// ---------------------------------------------------------------------------
// セクションの置換
// ---------------------------------------------------------------------------

export interface SectionChange {
  heading: string
  body: string
}

export interface AppliedChange {
  heading: string
  mode: "replaced" | "added"
}

export type ArchitectureUpdateError =
  | ArchitectureError
  | HeadingKeyError
  | "empty_changes"
  | "duplicate_heading"
  | "invalid_body"
  | "invalid_domains"

export type ArchitectureUpdate =
  | {
      ok: true
      text: string
      created: boolean
      applied: AppliedChange[]
      warnings: string[]
    }
  | {
      ok: false
      error: ArchitectureUpdateError
      message: string
      warnings: string[]
    }

// 与えられた本文を「見出し行の下に置ける形」に整える。
// 先頭の空行と末尾の空白を落とし、改行コードを文書に合わせる。
function normalizeBody(body: string, eol: string): string {
  const unified = body.replace(/\r\n/g, "\n").replace(/\r/g, "\n")
  const trimmed = unified.replace(/^\n+/, "").replace(/[ \t\n]+$/, "")
  if (trimmed === "") return ""
  return trimmed.split("\n").join(eol)
}

function buildSectionText(
  heading: string,
  body: string,
  eol: string,
  trailingBlank: boolean
): string {
  const normalized = normalizeBody(body, eol)
  if (normalized === "") {
    return trailingBlank ? `## ${heading}${eol}${eol}` : `## ${heading}${eol}`
  }
  const head = `## ${heading}${eol}${eol}`
  return `${head}${normalized}${eol}${trailingBlank ? eol : ""}`
}

interface SpliceOp {
  start: number
  end: number
  text: string
  order: number
}

// 契約 §4-1 の順序に従って、新しいセクションを差し込む位置を決める。
// 未知の見出し(手書きで増えたもの)は順序判断の足がかりにしない。
function insertionAnchor(
  doc: ArchitectureDocument,
  heading: string
): number | null {
  const target = canonicalIndex(heading)
  if (target < 0) return null
  for (const section of doc.sections) {
    const idx = canonicalIndex(section.heading)
    if (idx >= 0 && idx > target) return section.startLine
  }
  return null
}

function createArchitecture(changes: SectionChange[], eol: string): string {
  const ordered = [...changes].sort(
    (a, b) => canonicalIndex(a.heading) - canonicalIndex(b.heading)
  )
  let out = `${ARCHITECTURE_TITLE}${eol}${eol}`
  for (const change of ordered) {
    out += buildSectionText(change.heading, change.body, eol, true)
  }
  return out.replace(/(\r?\n)+$/, eol)
}

/**
 * セクションの適用そのもの。見出しキーの検証は行わない。
 *
 * - 指定セクション以外は**バイト単位で不変**。元ファイルを行単位で保持し、
 *   対象セクションの本文だけを差し替えて再結合する(契約 §4-1・設計 §7-4)。
 * - 見出し行そのものも書き換えない。差し替えるのは本文だけである。
 * - `current` が `null` または空白のみのときは新規作成として全文を組み立てる。
 * - 未閉フェンスは拒否する(書き込み経路・第 1 層)。
 * - 例外は**節の追加**のみ。新しい節を差し込む境界には区切りの空行が 1 行入る
 *   (末尾へ追加した場合、その空行は直前の節の末尾に付く)。既存の本文の
 *   バイト列は変わらない。
 *
 * `## ADR 一覧` を対象にできるのは adr.ts のためである。CLI の
 * `stage-architecture` は `prepareArchitectureUpdate` を使うこと。
 */
export function applySectionChanges(
  current: string | null | undefined,
  changes: SectionChange[]
): ArchitectureUpdate {
  const warnings: string[] = []
  const text = current ?? ""
  const eol = detectEol(text)

  if (text.trim() === "") {
    return {
      ok: true,
      text: createArchitecture(changes, eol),
      created: true,
      applied: changes.map((c) => ({
        heading: c.heading,
        mode: "added" as const
      })),
      warnings
    }
  }

  const parsed = parseArchitectureForWrite(text)
  if (!parsed.ok) {
    return {
      ok: false,
      error: parsed.error,
      message: parsed.message,
      warnings: [...warnings, ...parsed.warnings]
    }
  }
  const doc = parsed.doc
  warnings.push(...doc.warnings)

  const lines = splitLines(text)
  const chunks = lines.map((l) => l.raw)
  const ops: SpliceOp[] = []
  const applied: AppliedChange[] = []

  for (const change of changes) {
    const order = canonicalIndex(change.heading)
    const section = findSection(doc, change.heading)
    if (section) {
      const body = normalizeBody(change.body, eol)
      ops.push({
        start: section.startLine + 1,
        end: section.contentEndLine,
        text: body === "" ? "" : `${eol}${body}${eol}`,
        order
      })
      applied.push({ heading: change.heading, mode: "replaced" })
      continue
    }
    const anchor = insertionAnchor(doc, change.heading)
    if (anchor !== null) {
      ops.push({
        start: anchor,
        end: anchor,
        text: buildSectionText(change.heading, change.body, eol, true),
        order
      })
    } else {
      const last = lines[lines.length - 1]
      let prefix = ""
      if (!last.raw.endsWith("\n")) prefix += eol
      if (last.text.trim() !== "") prefix += eol
      ops.push({
        start: lines.length,
        end: lines.length,
        text:
          prefix + buildSectionText(change.heading, change.body, eol, false),
        order
      })
    }
    applied.push({ heading: change.heading, mode: "added" })
  }

  // 後ろから適用して行番号のずれを避ける。同じ位置に複数を差し込む場合は、
  // 契約 §4-1 の順序で並ぶよう、後ろのキーから先に差し込む。
  ops.sort((a, b) => b.start - a.start || b.order - a.order)
  for (const op of ops) chunks.splice(op.start, op.end - op.start, op.text)

  return { ok: true, text: chunks.join(""), created: false, applied, warnings }
}

/**
 * `stage-architecture` の本体。契約 §4-1 の見出しキー検証と §1 のドメインマップ
 * 検証を通したうえで、更新後の全文を返す。
 *
 * 実際の書き込みは行わない。diff の計算と staging は呼び出し元の責務。
 */
export function prepareArchitectureUpdate(
  current: string | null | undefined,
  changes: SectionChange[]
): ArchitectureUpdate {
  const warnings: string[] = []

  if (!Array.isArray(changes) || changes.length === 0) {
    return {
      ok: false,
      error: "empty_changes",
      message:
        "sections が空です。差し替える見出しを 1 つ以上指定してください。",
      warnings
    }
  }

  const normalizedChanges: SectionChange[] = []
  const seen = new Set<string>()
  for (const change of changes) {
    const validated = validateHeadingKey(change?.heading)
    if (!validated.ok) {
      return {
        ok: false,
        error: validated.error,
        message: validated.message,
        warnings
      }
    }
    if (seen.has(validated.heading)) {
      return {
        ok: false,
        error: "duplicate_heading",
        message: `「${validated.heading}」が sections に 2 回以上あります。1 回にまとめてください。`,
        warnings
      }
    }
    seen.add(validated.heading)
    if (typeof change?.body !== "string") {
      return {
        ok: false,
        error: "invalid_body",
        message: `「${validated.heading}」の body が文字列ではありません。`,
        warnings
      }
    }
    normalizedChanges.push({ heading: validated.heading, body: change.body })
  }

  // 契約 §1: ドメインマップを含む場合は 4 項目を検証し、失敗なら書き込まない。
  const domainsChange = normalizedChanges.find(
    (c) => c.heading === DOMAINS_HEADING
  )
  if (domainsChange) {
    const lookup = findDomainsBlock(domainsChange.body)
    if (!lookup.block) {
      // 「ブロックが無い」は契約 §1 の 4 項目に含まれないため拒否しない。
      warnings.push(
        `\`## ${DOMAINS_HEADING}\` に \`${DOMAINS_MARKER}\` ブロックがありません。機械可読な写像が失われます。`
      )
    } else {
      warnings.push(...lookup.warnings)
      const validated = parseDomainsContent(lookup.block.content)
      if (!validated.ok) {
        return {
          ok: false,
          error: "invalid_domains",
          message: validated.message,
          warnings
        }
      }
    }
  }

  const result = applySectionChanges(current, normalizedChanges)
  return { ...result, warnings: [...warnings, ...result.warnings] }
}

// ---------------------------------------------------------------------------
// ファイル入口(パスは config.ts が解決したものを受け取る)
// ---------------------------------------------------------------------------

export interface ArchitectureFile {
  path: string
  /** 読み取りに成功したか。存在しない・読めないのいずれも false。 */
  exists: boolean
  text: string
  doc: ArchitectureDocument
  warnings: string[]
}

/**
 * 読み取り経路の入口。存在しない場合も読めない場合も例外を投げず、
 * 空文書として返す(第 2 層・フェイルオープン)。
 */
export function readArchitectureFile(filePath: string): ArchitectureFile {
  const warnings: string[] = []
  let text = ""
  let exists = false
  try {
    text = fs.readFileSync(filePath, "utf8")
    exists = true
  } catch (err) {
    const code = (err as NodeJS.ErrnoException | undefined)?.code
    if (code !== "ENOENT") {
      warnings.push(
        `ARCHITECTURE(${filePath})を読めませんでした。未作成として扱います。`
      )
    }
  }
  const doc = parseArchitectureForRead(text)
  return {
    path: filePath,
    exists,
    text,
    doc,
    warnings: [...warnings, ...doc.warnings]
  }
}
