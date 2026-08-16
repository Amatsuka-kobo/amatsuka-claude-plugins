// ADR(`## ADR 一覧` 配下の `### ADR-NNN:` ブロック)の分解・採番・追加・状態変更。
//
// 規則の正本はファイル契約
// `harness-docs/design/2026-08-16-file-contract-freeze.md` の
// §5(エントリ書式・状態変更の履歴・何を ADR にするか)、§4(セクション分割)、
// §11(採番の読み取りをロック下で行う)。設計書は §6-6・§7-4・§12-2。
//
// このモジュールは**書き込みを行わない**。`stage-adr` が必要とする
// 「新しいファイル内容」を計算して返すところまでを担い、確定は
// `commit-architecture`(staging.ts + CLI)が行う。
//
// セクションの切り出しは architecture.ts の分解器をそのまま使う。独自に `##` を
// 解析し直すと分解が食い違い、ADR 節の範囲が壊れる。節の中を `###` で刻むときの
// フェンス判定も architecture.ts の `scanFences` を使う(同じ規則の実装を 2 つ作らない)。
//
// 位置づけは第 1 層(フェイルクローズド)。壊れた内容・値域外・必須欠落は
// `AdrError` を投げて拒否し、`stagingId` を発行させない。解析
// (`parseAdrDocument`)だけは読み取り経路からも使うため例外を投げない。

import fs from "node:fs"
import {
  ADR_HEADING,
  type ArchitectureLine,
  applySectionChanges,
  findSection,
  parseArchitecture,
  scanFences
} from "./architecture.js"
import { withFileLock } from "./gotchas.js"

/** 契約 §5-1。`状態` の値域はこの 3 つ。他は拒否する。 */
export const ADR_STATUSES = ["採用", "提案", "廃止"] as const
export type AdrStatus = (typeof ADR_STATUSES)[number]

/**
 * 追加時に `status` を省略したときの値。
 *
 * 設計書 §7-4 の `mode: "add"` の入力に `status` が無く、契約 §5-1 はエントリに
 * `状態` 行を要求するため、既定値が要る。新規に書き起こす ADR は
 * 「採用した結論」を必須項目に持つ判断の記録であり、`採用` が既定として妥当である。
 * `提案` として起こしたい場合は `status` を明示する。
 */
export const DEFAULT_ADR_STATUS: AdrStatus = "採用"

export type AdrErrorCode =
  | "invalid_input"
  | "invalid_status"
  | "invalid_entry"
  | "not_found"
  | "unclosed_fence"
  | "lock_timeout"

/**
 * 書き込み経路の拒否。CLI はこれを捕捉して `{ error: code }` を stdout へ出し、
 * 非 0 終了する(gotchas.ts の `GotchaError` と同じ扱い)。
 */
export class AdrError extends Error {
  readonly code: AdrErrorCode
  readonly details: string[]

  constructor(code: AdrErrorCode, message: string, details: string[] = []) {
    super(message)
    this.name = "AdrError"
    this.code = code
    this.details = details
  }
}

// ---------------------------------------------------------------------------
// 行の書式(契約 §5-1・§5-2)
// ---------------------------------------------------------------------------

// エントリ見出し。1=番号までの接頭辞 / 2=番号 / 3=コロン以降。
// `#### 背景` などの小見出しは `###` の直後が `#` なので一致しない。
const ENTRY_HEADING_RE = /^( {0,3}###[ \t]+ADR-(\d+):)(.*)$/

// `- 状態: 採用`。1=値の直前までの接頭辞 / 2=値。
// `- 状態変更(...)` は `状態` の直後が `変` なので一致しない。
const STATUS_LINE_RE = /^( {0,3}-[ \t]+状態[ \t]*:[ \t]*)(.*)$/
const DECIDED_ON_RE = /^ {0,3}-[ \t]+決定日[ \t]*:[ \t]*(.*)$/
const DECIDED_BY_RE = /^ {0,3}-[ \t]+決定者[ \t]*:[ \t]*(.*)$/

// 契約 §5-2 の履歴行 `- 状態変更(YYYY-MM-DD): 旧 → 新。理由`。
const STATUS_CHANGE_RE =
  /^ {0,3}-[ \t]+状態変更\((\d{4}-\d{2}-\d{2})\)[ \t]*:[ \t]*(.*)$/
// 履歴行の値の分解(読み取り専用の寛容さ。生成は常に固定の形で出す)。
const STATUS_CHANGE_VALUE_RE = /^(.*?)[ \t]*→[ \t]*([^。]*)。?(.*)$/

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/

export function formatAdrId(num: number): string {
  return `ADR-${String(num).padStart(3, "0")}`
}

/** `ADR-003` / `adr-3` / `3` のいずれも受け付ける。 */
export function parseAdrId(raw: unknown): number | null {
  if (typeof raw !== "string") return null
  const m = /^(?:ADR-)?(\d+)$/i.exec(raw.trim())
  if (m === null) return null
  const num = Number.parseInt(m[1], 10)
  return Number.isFinite(num) ? num : null
}

function isAdrStatus(value: unknown): value is AdrStatus {
  return (
    typeof value === "string" &&
    (ADR_STATUSES as readonly string[]).includes(value)
  )
}

// ---------------------------------------------------------------------------
// 解析
// ---------------------------------------------------------------------------

export interface AdrStatusChange {
  /** `状態変更(YYYY-MM-DD)` の日付。 */
  date: string
  /** コロン以降の生の値。 */
  raw: string
  from: string | null
  to: string | null
  reason: string
  /** 節本文の中での 0 始まり行番号。 */
  lineIndex: number
}

export interface AdrEntry {
  /** `ADR-003` の形。 */
  id: string
  /** 採番に使う数値。 */
  number: number
  /** コロン以降のタイトル。 */
  title: string
  /** 見出し行(`\r` を落とした判定用の形)。 */
  headingLine: string
  /** 値域内なら `AdrStatus`、`- 状態:` 行が無い / 値域外なら null。 */
  status: AdrStatus | null
  /** `- 状態:` 行の生の値。行が無ければ null。 */
  statusRaw: string | null
  /** `- 状態:` 行の 0 始まり行番号(節本文の中)。無ければ null。 */
  statusLineIndex: number | null
  decidedOn: string | null
  decidedBy: string | null
  /** 見出し行の 0 始まり行番号(節本文の中)。 */
  startIndex: number
  /** 末尾の空行を除いた終端(この行は含まない)。追記位置でもある。 */
  contentEndIndex: number
  /** エントリの終端(この行は含まない)。次のエントリ見出し、または節末。 */
  endIndex: number
  /** 見出しを含むエントリ全体の原文。 */
  raw: string
  /** 契約 §5-2 の履歴行。古いものから順に並ぶ。 */
  statusChanges: AdrStatusChange[]
}

export interface AdrDocument {
  /** 与えられた ARCHITECTURE 全文。 */
  text: string
  /** `## ADR 一覧` 節があるか。 */
  hasSection: boolean
  /** 節本文(見出し行を含まない)。節が無ければ ""。 */
  sectionBody: string
  /** 出現順のエントリ。 */
  entries: AdrEntry[]
  maxNumber: number
  /** 契約 §5-1: 全件走査して最大値 + 1。 */
  nextNumber: number
  /** 契約 §4-2 規則 5。書き込み経路はこれを見て拒否する。 */
  unclosedFence: boolean
  warnings: string[]
}

function joinRaw(
  lines: ArchitectureLine[],
  start: number,
  end: number
): string {
  let out = ""
  for (let i = start; i < end; i++) out += lines[i].raw
  return out
}

function parseStatusChangeValue(value: string): {
  from: string | null
  to: string | null
  reason: string
} {
  const m = STATUS_CHANGE_VALUE_RE.exec(value)
  if (m === null) return { from: null, to: null, reason: value.trim() }
  return { from: m[1].trim(), to: m[2].trim(), reason: m[3].trim() }
}

function parseEntries(sectionBody: string): AdrEntry[] {
  const scan = scanFences(sectionBody)
  const lines = scan.lines

  // フェンスの外側にあるエントリ見出しだけを刻み目にする(契約 §4-2 規則 3)。
  const starts: { index: number; number: number; title: string }[] = []
  for (let i = 0; i < lines.length; i++) {
    if (scan.insideFence[i]) continue
    const m = ENTRY_HEADING_RE.exec(lines[i].text)
    if (m === null) continue
    starts.push({
      index: i,
      number: Number.parseInt(m[2], 10),
      title: m[3].trim()
    })
  }

  const entries: AdrEntry[] = []
  for (let s = 0; s < starts.length; s++) {
    const { index: startIndex, number, title } = starts[s]
    const endIndex = s + 1 < starts.length ? starts[s + 1].index : lines.length
    let contentEndIndex = endIndex
    while (
      contentEndIndex > startIndex + 1 &&
      lines[contentEndIndex - 1].text.trim() === ""
    ) {
      contentEndIndex--
    }

    let statusRaw: string | null = null
    let statusLineIndex: number | null = null
    let decidedOn: string | null = null
    let decidedBy: string | null = null
    const statusChanges: AdrStatusChange[] = []

    for (let i = startIndex + 1; i < contentEndIndex; i++) {
      if (scan.insideFence[i]) continue
      const text = lines[i].text

      const change = STATUS_CHANGE_RE.exec(text)
      if (change !== null) {
        statusChanges.push({
          date: change[1],
          raw: change[2],
          lineIndex: i,
          ...parseStatusChangeValue(change[2])
        })
        continue
      }
      // 同名の行が複数あるときは最初のものを採る(契約 §4-2 の重複の扱いと同じ)。
      if (statusRaw === null) {
        const status = STATUS_LINE_RE.exec(text)
        if (status !== null) {
          statusRaw = status[2].trim()
          statusLineIndex = i
          continue
        }
      }
      if (decidedOn === null) {
        const on = DECIDED_ON_RE.exec(text)
        if (on !== null) {
          decidedOn = on[1].trim()
          continue
        }
      }
      if (decidedBy === null) {
        const by = DECIDED_BY_RE.exec(text)
        if (by !== null) decidedBy = by[1].trim()
      }
    }

    entries.push({
      id: formatAdrId(number),
      number,
      title,
      headingLine: lines[startIndex].text,
      status: isAdrStatus(statusRaw) ? statusRaw : null,
      statusRaw,
      statusLineIndex,
      decidedOn,
      decidedBy,
      startIndex,
      contentEndIndex,
      endIndex,
      raw: joinRaw(lines, startIndex, endIndex),
      statusChanges
    })
  }

  return entries
}

/**
 * ARCHITECTURE 全文から ADR を取り出す。読み取り経路からも使うため例外を投げない。
 *
 * 節の切り出しは architecture.ts の分解器に委ねる。ここで `##` を解析し直すと
 * 分解が食い違い、ADR 節の範囲が壊れる。
 */
export function parseAdrDocument(text: string | null | undefined): AdrDocument {
  const source = text ?? ""
  const doc = parseArchitecture(source)
  const warnings = [...doc.warnings]
  const section = findSection(doc, ADR_HEADING)

  const sectionBody = section?.body ?? ""
  const entries = section ? parseEntries(sectionBody) : []

  const seen = new Map<number, number>()
  for (const entry of entries) {
    seen.set(entry.number, (seen.get(entry.number) ?? 0) + 1)
  }
  for (const [num, count] of seen) {
    if (count > 1) {
      warnings.push(
        `${formatAdrId(num)} が ${count} 個あります。採番は最大値 + 1 で行うため衝突は起きませんが、手編集で重複したものと思われます。`
      )
    }
  }

  let maxNumber = 0
  for (const entry of entries) {
    if (entry.number > maxNumber) maxNumber = entry.number
  }

  return {
    text: source,
    hasSection: section !== undefined,
    sectionBody,
    entries,
    maxNumber,
    nextNumber: maxNumber + 1,
    unclosedFence: doc.error === "unclosed_fence",
    warnings
  }
}

export function findAdrByNumber(
  doc: AdrDocument,
  num: number
): AdrEntry | null {
  return doc.entries.find((entry) => entry.number === num) ?? null
}

// ---------------------------------------------------------------------------
// フィルタ(契約 §11 の `get adr [--id | --status]`)
// ---------------------------------------------------------------------------

export interface AdrFilter {
  /** `ADR-003` 等での絞り込み。 */
  id?: string
  /** `採用` / `提案` / `廃止` での絞り込み。 */
  status?: string
}

export function filterAdrEntries(
  entries: AdrEntry[],
  filter: AdrFilter = {}
): AdrEntry[] {
  let result = entries
  if (filter.id !== undefined) {
    const num = parseAdrId(filter.id)
    result = num === null ? [] : result.filter((e) => e.number === num)
  }
  if (filter.status !== undefined && filter.status !== "") {
    // 値域外の指定は 0 件になる(拒否はしない。読み取り経路のため)。
    result = result.filter((e) => e.status === filter.status)
  }
  return result
}

// ---------------------------------------------------------------------------
// 入力と検証(契約 §5-1・§5-2、設計書 §7-4)
// ---------------------------------------------------------------------------

export interface AdrAddInput {
  mode: "add"
  title: string
  /** 省略時は `採用`(DEFAULT_ADR_STATUS)。値域外は拒否する。 */
  status?: string
  /** 省略時は当日日付。 */
  decidedOn?: string
  decidedBy: string
  background: string
  /** `#### 検討した選択肢` の番号付きリストになる。1 要素以上が必須。 */
  options: string[]
  conclusion: string
  rationale: string
  impact: string
}

export interface AdrStatusInput {
  mode: "status"
  /** `ADR-003` の形。数値だけでも受け付ける。 */
  id: string
  status: string
  /** 契約 §5-2: 理由は必須。省略された状態変更は拒否する。 */
  reason: string
  /** 省略時は当日日付。 */
  changedOn?: string
}

export type AdrInput = AdrAddInput | AdrStatusInput

export interface AdrValidationResult {
  errors: string[]
  warnings: string[]
}

function requireSingleLine(
  value: unknown,
  label: string,
  errors: string[]
): string {
  if (typeof value !== "string") {
    errors.push(`${label} が文字列ではありません。`)
    return ""
  }
  if (value.includes("\n") || value.includes("\r")) {
    errors.push(`${label} に改行が含まれています。1 行で書いてください。`)
    return ""
  }
  if (value.trim() === "") {
    errors.push(`${label} が空です。`)
    return ""
  }
  return value
}

function requireText(value: unknown, label: string, errors: string[]): string {
  if (typeof value !== "string") {
    errors.push(`${label} が文字列ではありません。`)
    return ""
  }
  if (value.trim() === "") {
    errors.push(`${label} が空です。`)
    return ""
  }
  return value
}

function validateStatusValue(
  value: unknown,
  label: string,
  errors: string[]
): void {
  if (!isAdrStatus(value)) {
    errors.push(
      `${label} は ${ADR_STATUSES.join(" / ")} のみを受け付けます(受領: ${JSON.stringify(value)})。`
    )
  }
}

export function validateAdrAddInput(input: AdrAddInput): AdrValidationResult {
  const errors: string[] = []
  const warnings: string[] = []

  requireSingleLine(input?.title, "title", errors)
  requireSingleLine(input?.decidedBy, "decidedBy", errors)
  requireText(input?.background, "background", errors)
  requireText(input?.conclusion, "conclusion", errors)
  requireText(input?.rationale, "rationale", errors)
  requireText(input?.impact, "impact", errors)

  if (input?.status !== undefined) {
    validateStatusValue(input.status, "status", errors)
  }
  if (input?.decidedOn !== undefined) {
    if (typeof input.decidedOn !== "string" || !DATE_RE.test(input.decidedOn)) {
      errors.push("decidedOn は YYYY-MM-DD の形式で指定してください。")
    }
  }

  if (!Array.isArray(input?.options) || input.options.length === 0) {
    errors.push(
      "options が 1 要素以上の配列ではありません。比較した選択肢を挙げてください。"
    )
  } else {
    input.options.forEach((option, i) => {
      requireSingleLine(option, `options[${i}]`, errors)
    })
    // 契約 §5-3 の 3 基準のうち「選択肢が実在した」だけが機械的に近似できる。
    // 判定そのものは人間とモデルが行うため、拒否ではなく警告にとどめる。
    if (input.options.length === 1) {
      warnings.push(
        "options が 1 件だけです。比較した代替を挙げられないものは判断ではなく制約であり、`## 技術スタック` や `## 規約` に属する可能性があります(契約 §5-3)。"
      )
    }
  }

  return { errors, warnings }
}

export function validateAdrStatusInput(
  input: AdrStatusInput
): AdrValidationResult {
  const errors: string[] = []
  const warnings: string[] = []

  if (parseAdrId(input?.id) === null) {
    errors.push(
      `id は ADR-NNN の形式で指定してください(受領: ${JSON.stringify(input?.id)})。`
    )
  }
  validateStatusValue(input?.status, "status", errors)

  // 契約 §5-2: 理由は必須。理由を残さない状態変更は、後から見て
  // 「誰かが気分で廃止した」のと区別がつかない。
  if (input?.reason === undefined || input?.reason === null) {
    errors.push("reason が指定されていません。状態変更の理由は必須です。")
  } else {
    const reasonErrors: string[] = []
    requireSingleLine(input.reason, "reason", reasonErrors)
    if (reasonErrors.length > 0) {
      errors.push(...reasonErrors)
      errors.push("状態変更の理由は必須です。")
    }
  }

  if (input?.changedOn !== undefined) {
    if (typeof input.changedOn !== "string" || !DATE_RE.test(input.changedOn)) {
      errors.push("changedOn は YYYY-MM-DD の形式で指定してください。")
    }
  }

  return { errors, warnings }
}

function throwOnErrors(result: AdrValidationResult): void {
  if (result.errors.length === 0) return
  const status = result.errors.some((e) => e.startsWith("status は"))
  throw new AdrError(
    status ? "invalid_status" : "invalid_input",
    `入力が書式を満たしていません: ${result.errors.join(" / ")}`,
    result.errors
  )
}

// ---------------------------------------------------------------------------
// エントリの生成(契約 §5-1)
// ---------------------------------------------------------------------------

/** 契約 §5-1 のエントリ書式。改行を含まない行の配列で返す。 */
export function renderAdrEntryLines(
  num: number,
  input: AdrAddInput,
  date: string,
  status: AdrStatus
): string[] {
  const lines: string[] = [
    `### ${formatAdrId(num)}: ${input.title.trim()}`,
    "",
    `- 状態: ${status}`,
    `- 決定日: ${date}`,
    `- 決定者: ${input.decidedBy.trim()}`,
    "",
    "#### 背景",
    "",
    ...blockLines(input.background),
    "",
    "#### 検討した選択肢",
    ""
  ]
  input.options.forEach((option, i) => {
    lines.push(`${i + 1}. ${option.trim()}`)
  })
  lines.push(
    "",
    "#### 採用した結論",
    "",
    ...blockLines(input.conclusion),
    "",
    "#### 理由",
    "",
    ...blockLines(input.rationale),
    "",
    "#### 影響範囲",
    "",
    ...blockLines(input.impact)
  )
  return lines
}

// 複数行を許す項目を行の配列にする。改行コードは節の再結合時に揃うため、
// ここでは `\n` に寄せておけばよい(architecture.ts の normalizeBody が変換する)。
function blockLines(value: string): string[] {
  return value
    .replace(/\r\n/g, "\n")
    .replace(/\r/g, "\n")
    .replace(/[ \t\n]+$/, "")
    .replace(/^\n+/, "")
    .split("\n")
}

function normalizeSectionBody(body: string): string {
  return body
    .replace(/\r\n/g, "\n")
    .replace(/\r/g, "\n")
    .replace(/[ \t\n]+$/, "")
    .replace(/^\n+/, "")
}

// ---------------------------------------------------------------------------
// 追加(契約 §5-1「追加位置は節の末尾」)
// ---------------------------------------------------------------------------

export interface BuildAdrAddResult {
  /** 更新後の ARCHITECTURE 全文。書き込みは行わない。 */
  text: string
  id: string
  number: number
  /** ARCHITECTURE を新規作成したか。 */
  created: boolean
  /** 既存文書へ `## ADR 一覧` 節を足したか。 */
  sectionCreated: boolean
  status: AdrStatus
  date: string
  warnings: string[]
}

function applyAdrSection(
  current: string | null | undefined,
  body: string
): { text: string; created: boolean; warnings: string[] } {
  // 節の差し替えは architecture.ts に委ねる。対象セクション以外はバイト単位で
  // 不変であること、節が無ければ契約 §4-1 の順序で追加されることが保証される。
  const result = applySectionChanges(current, [{ heading: ADR_HEADING, body }])
  if (!result.ok) {
    if (result.error === "unclosed_fence") {
      throw new AdrError(
        "unclosed_fence",
        "閉じていないコードフェンスがあるため、ADR の更新を行いません。フェンスを閉じてから再実行してください。",
        result.warnings
      )
    }
    throw new AdrError("invalid_input", result.message, result.warnings)
  }
  return {
    text: result.text,
    created: result.created,
    warnings: result.warnings
  }
}

/**
 * 新しい ADR を `## ADR 一覧` 節の**末尾**へ追加した全文を返す(純関数)。
 *
 * GOTCHAS の先頭挿入と逆向きである。ADR は番号順に読まれる記録であり、
 * 昇順に並べたほうが「この判断の後に何が決まったか」を追える(設計書 §7-4)。
 * 節が無ければ節ごと作る。既存エントリのバイト列は変わらない。
 */
export function buildAdrAddition(
  current: string | null | undefined,
  input: AdrAddInput,
  date: string
): BuildAdrAddResult {
  const validation = validateAdrAddInput(input)
  throwOnErrors(validation)

  const status = isAdrStatus(input.status) ? input.status : DEFAULT_ADR_STATUS
  const doc = parseAdrDocument(current)
  if (doc.unclosedFence) {
    throw new AdrError(
      "unclosed_fence",
      "閉じていないコードフェンスがあるため、ADR の追加を行いません。フェンスを閉じてから再実行してください。",
      doc.warnings
    )
  }

  const num = doc.nextNumber
  const rendered = renderAdrEntryLines(num, input, date, status).join("\n")
  const existing = normalizeSectionBody(doc.sectionBody)
  const body = existing === "" ? rendered : `${existing}\n\n${rendered}`

  const applied = applyAdrSection(current, body)
  return {
    text: applied.text,
    id: formatAdrId(num),
    number: num,
    created: applied.created,
    sectionCreated: !doc.hasSection,
    status,
    date,
    warnings: [...validation.warnings, ...doc.warnings]
  }
}

// ---------------------------------------------------------------------------
// 状態変更(契約 §5-2)
// ---------------------------------------------------------------------------

export interface BuildAdrStatusResult {
  text: string
  id: string
  number: number
  /** 変更前の `- 状態:` 行の値(値域外の手編集もそのまま返す)。 */
  from: string
  to: AdrStatus
  date: string
  warnings: string[]
}

/**
 * `- 状態:` 行を最新値に書き換え、エントリ末尾へ履歴行を 1 行**追記**した全文を返す。
 *
 * 過去の状態変更行は消さない。エントリも削除しない(契約 §5-1・§5-2)。
 * 変更は「状態行の値」と「末尾 1 行の追加」の 2 箇所だけで、他のフィールドは不変。
 */
export function buildAdrStatusChange(
  current: string | null | undefined,
  input: AdrStatusInput,
  date: string
): BuildAdrStatusResult {
  const validation = validateAdrStatusInput(input)
  throwOnErrors(validation)

  const to = input.status as AdrStatus
  const num = parseAdrId(input.id) ?? 0
  const doc = parseAdrDocument(current)
  if (doc.unclosedFence) {
    throw new AdrError(
      "unclosed_fence",
      "閉じていないコードフェンスがあるため、状態変更を行いません。フェンスを閉じてから再実行してください。",
      doc.warnings
    )
  }

  const entry = findAdrByNumber(doc, num)
  if (entry === null) {
    throw new AdrError(
      "not_found",
      `${formatAdrId(num)} が \`## ${ADR_HEADING}\` にありません。エントリは削除されないため、番号を確認してください。`
    )
  }
  if (entry.statusLineIndex === null || entry.statusRaw === null) {
    // 契約 §5-2 は「`状態` 行そのものは最新の値に書き換える」と定める。
    // 書き換える対象が無いエントリは書式が壊れており、書き込み経路は拒否する。
    throw new AdrError(
      "invalid_entry",
      `${entry.id} に \`- 状態:\` 行がありません。契約 §5-1 の書式に直してから再実行してください。`
    )
  }

  const warnings: string[] = [...validation.warnings, ...doc.warnings]
  const from = entry.statusRaw
  if (entry.status === null) {
    warnings.push(
      `${entry.id} の現在の状態「${from}」は値域(${ADR_STATUSES.join(" / ")})の外です。履歴行にはこの値をそのまま書きます。`
    )
  }
  if (from === to) {
    warnings.push(
      `${entry.id} の状態は既に「${to}」です。履歴行だけが追記されます。`
    )
  }

  const scan = scanFences(doc.sectionBody)
  const chunks = scan.lines.map((line) => line.raw)

  // 1. `- 状態:` 行の値だけを差し替える。接頭辞と行末は原文のまま残す。
  const statusLine = scan.lines[entry.statusLineIndex]
  const m = STATUS_LINE_RE.exec(statusLine.text)
  if (m === null) {
    throw new AdrError(
      "invalid_entry",
      `${entry.id} の \`- 状態:\` 行を解析できませんでした。`
    )
  }
  const lineEnding = statusLine.raw.slice(statusLine.text.length)
  chunks[entry.statusLineIndex] = `${m[1]}${to}${lineEnding}`

  // 2. エントリ末尾(末尾の空行より前)へ履歴行を 1 行追記する。
  // 直前が履歴行なら続けて積み、そうでなければ区切りの空行を 1 行挟む。
  // 散文の直後に `- ` 行を密着させると、本文の続きなのか履歴なのかが読めなくなる。
  const previous = scan.lines[entry.contentEndIndex - 1]
  const continues =
    previous !== undefined && STATUS_CHANGE_RE.test(previous.text)
  const history = `- 状態変更(${date}): ${from} → ${to}。${input.reason.trim()}`
  chunks.splice(
    entry.contentEndIndex,
    0,
    continues ? `${history}\n` : `\n${history}\n`
  )

  const applied = applyAdrSection(current, chunks.join(""))
  return {
    text: applied.text,
    id: entry.id,
    number: entry.number,
    from,
    to,
    date,
    warnings: [...warnings, ...applied.warnings]
  }
}

// ---------------------------------------------------------------------------
// ファイル入口(契約 §11: 採番の読み取りは ARCHITECTURE のロック下)
// ---------------------------------------------------------------------------

function formatToday(now: Date): string {
  const y = String(now.getFullYear()).padStart(4, "0")
  const m = String(now.getMonth() + 1).padStart(2, "0")
  const d = String(now.getDate()).padStart(2, "0")
  return `${y}-${m}-${d}`
}

function readTextIfExists(filePath: string): string | null {
  try {
    return fs.readFileSync(filePath, "utf8")
  } catch (error) {
    const code = (error as NodeJS.ErrnoException | undefined)?.code
    if (code === "ENOENT") return null
    throw error
  }
}

/**
 * ARCHITECTURE のロックを取って `fn` を実行する。
 *
 * 契約 §11 の表のとおり、`stage-adr`(採番の読み取り)は
 * `<architecture パス>.lock` を取る。ロックの実装は gotchas.ts の
 * `withFileLock` が唯一の実装であり、対象パスが違えば別のロックになる。
 * GOTCHAS 側とは互いをブロックしない。
 */
function withArchitectureLock<T>(architecturePath: string, fn: () => T): T {
  try {
    return withFileLock(architecturePath, fn)
  } catch (error) {
    if (error instanceof AdrError) throw error
    const code = (error as { code?: string } | undefined)?.code
    if (code === "lock_timeout") {
      throw new AdrError("lock_timeout", (error as Error).message)
    }
    throw error
  }
}

export interface StageAdrOptions {
  /** 日付の既定値を決めるための現在時刻。テストから固定するために使う。 */
  now?: Date
}

export interface StageAdrResult {
  mode: "add" | "status"
  path: string
  /** 採番の読み取り時点で対象ファイルが存在したか。 */
  baseExists: boolean
  /** 採番の読み取り時点の全文。staging のハッシュ照合に使う。 */
  baseText: string
  /** commit 時に書き込む全文。この関数は書き込まない。 */
  nextText: string
  id: string
  number: number
  /** 追加時に割り当てた ID。状態変更では null。 */
  assignedId: string | null
  /** 状態変更の変更前の値。追加では null。 */
  previousStatus: string | null
  status: AdrStatus
  date: string
  created: boolean
  sectionCreated: boolean
  warnings: string[]
}

/**
 * `stage-adr` の本体。採番の読み取りから新しい全文の算出までをロック下で行う。
 *
 * **書き込みは行わない。** 返した `nextText` を `createStaging` に載せ、
 * `commit-architecture` で確定する(設計書 §7-4)。
 */
export function stageAdr(
  architecturePath: string,
  input: AdrInput,
  options: StageAdrOptions = {}
): StageAdrResult {
  const now = options.now ?? new Date()

  if (input?.mode === "status") {
    // ロックを取る前に、入力だけで分かる拒否を済ませる。
    throwOnErrors(validateAdrStatusInput(input))
    const date = input.changedOn ?? formatToday(now)
    return withArchitectureLock(architecturePath, () => {
      const baseText = readTextIfExists(architecturePath)
      if (baseText === null) {
        throw new AdrError(
          "not_found",
          `${architecturePath} が存在しません。状態を変更する ADR がありません。`
        )
      }
      const built = buildAdrStatusChange(baseText, input, date)
      return {
        mode: "status" as const,
        path: architecturePath,
        baseExists: true,
        baseText,
        nextText: built.text,
        id: built.id,
        number: built.number,
        assignedId: null,
        previousStatus: built.from,
        status: built.to,
        date: built.date,
        created: false,
        sectionCreated: false,
        warnings: built.warnings
      }
    })
  }

  if (input?.mode !== "add") {
    throw new AdrError(
      "invalid_input",
      `mode は "add" または "status" のみを受け付けます(受領: ${JSON.stringify(
        (input as { mode?: unknown } | undefined)?.mode
      )})。`
    )
  }

  throwOnErrors(validateAdrAddInput(input))
  const date = input.decidedOn ?? formatToday(now)
  return withArchitectureLock(architecturePath, () => {
    const baseText = readTextIfExists(architecturePath)
    const built = buildAdrAddition(baseText, input, date)
    return {
      mode: "add" as const,
      path: architecturePath,
      baseExists: baseText !== null,
      baseText: baseText ?? "",
      nextText: built.text,
      id: built.id,
      number: built.number,
      assignedId: built.id,
      previousStatus: null,
      status: built.status,
      date: built.date,
      created: built.created,
      sectionCreated: built.sectionCreated,
      warnings: built.warnings
    }
  })
}
