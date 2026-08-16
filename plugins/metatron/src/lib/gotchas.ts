// GOTCHAS 台帳の解析・採番・先頭挿入・タグ付与。
//
// 規則の正本はファイル契約
// `harness-docs/design/2026-08-16-file-contract-freeze.md` の §6(GOTCHAS の書式)と
// §11(採番と挿入の原子性)。設計書は §6-3・§6-3b・§7-4・§12-2。
//
// この層の位置づけ:
// - 入力の検証と書き込みは第 1 層(フェイルクローズド)。壊れた内容は書かずに投げる。
// - 解析(parseGotchas)は読み取り経路からも使うため例外を投げず、warnings に理由を積む。
//
// CLI・hook・テストがこのファイルだけを窓口にする。ファイルへの書き込み経路は
// appendGotcha / tagGotcha の 2 つしか無く、「削除・改変禁止」が指示ではなく構造として成立する。

import fs from "node:fs"
import path from "node:path"

/** タグの値域(契約 §6-4)。この 2 リテラル以外はタグとして認識も付与もしない。 */
export const GOTCHA_TAGS = ["解決済み", "対象外"] as const
export type GotchaTag = (typeof GOTCHA_TAGS)[number]

/** エントリを解析する唯一の節(契約 §6-2)。 */
export const LIST_SECTION_TITLE = "失敗パターン一覧"

export type GotchaErrorCode =
  | "invalid_input"
  | "invalid_tag"
  | "not_found"
  | "lock_timeout"

/**
 * 書き込み経路の拒否。CLI はこれを捕捉して `{ error: code }` を stdout へ出し、非 0 終了する。
 */
export class GotchaError extends Error {
  readonly code: GotchaErrorCode
  readonly details: string[]

  constructor(code: GotchaErrorCode, message: string, details: string[] = []) {
    super(message)
    this.name = "GotchaError"
    this.code = code
    this.details = details
  }
}

// ---------------------------------------------------------------------------
// 行の正規化(契約 §4-2)
// ---------------------------------------------------------------------------

// CRLF のファイルで判定が割れないよう、判定の前に末尾の \r を落とす。
// 書き戻すときは元の行をそのまま使うため、既存行はバイト単位で不変になる。
function stripCr(line: string): string {
  return line.endsWith("\r") ? line.slice(0, -1) : line
}

interface FenceState {
  char: string
  count: number
}

const FENCE_OPEN_RE = /^ {0,3}(`{3,}|~{3,})/
const FENCE_CLOSE_RE = /^ {0,3}(`{3,}|~{3,})[ \t]*$/

function matchFenceOpen(line: string): FenceState | null {
  const m = FENCE_OPEN_RE.exec(line)
  if (m === null) return null
  return { char: m[1][0], count: m[1].length }
}

// 開始と同じ文字を開始と同数以上連続させ、その後に info string を持たない行。
// 連続の後の半角スペース・タブは info string とみなさない(末尾空白で閉じ損ねない)。
function isFenceClose(line: string, fence: FenceState): boolean {
  const m = FENCE_CLOSE_RE.exec(line)
  if (m === null) return false
  return m[1][0] === fence.char && m[1].length >= fence.count
}

interface FenceScan {
  /** フェンスの内側(開始行・終了行を含む)。見出し判定から除外する。 */
  blocked: boolean[]
  unclosedFence: boolean
}

function scanFences(lines: string[], ignoreFences: boolean): FenceScan {
  const blocked = new Array<boolean>(lines.length).fill(false)
  if (ignoreFences) return { blocked, unclosedFence: false }

  let fence: FenceState | null = null
  for (let i = 0; i < lines.length; i++) {
    const line = stripCr(lines[i])
    if (fence === null) {
      const open = matchFenceOpen(line)
      if (open !== null) {
        fence = open
        blocked[i] = true
      }
      continue
    }
    blocked[i] = true
    if (isFenceClose(line, fence)) fence = null
  }
  return { blocked, unclosedFence: fence !== null }
}

const SECTION_HEADING_RE = /^ {0,3}## (.*)$/
const SUB_HEADING_RE = /^ {0,3}### /

// 契約 §6-2 のエントリ見出し。1=見出し接頭辞 / 2=日付 / 3=番号 / 4=コロン以降の残り。
const ENTRY_HEADING_RE =
  /^( {0,3}###[ \t]+\[(\d{4}-\d{2}-\d{2})\][ \t]+GOTCHA-(\d+):)(.*)$/

// 契約 §6-4: 位置は GOTCHA-NNN: の直後、区切りは半角スペース 1 個、リテラル 2 種のみ。
// 半角スペース 2 個以上・全角スペース・タブ・変形したリテラルはいずれもタグ無しになる。
const TAG_RE = /^ (\[解決済み\]|\[対象外\])(?:[ \t](.*))?$/

const FIELD_LINE_RE = /^ {0,3}\*\*(.+?)\*\*[ \t]*:[ \t]*(.*)$/

// ---------------------------------------------------------------------------
// 解析
// ---------------------------------------------------------------------------

export interface GotchaFields {
  task: string
  mistake: string
  cause: string
  countermeasure: string
  /** `Yes` / `No` のいずれか。書式が崩れている場合は null。 */
  promotionCandidate: "Yes" | "No" | null
}

export interface GotchaEntry extends GotchaFields {
  /** `GOTCHA-007` の形。 */
  id: string
  /** 採番に使う数値。 */
  number: number
  /** 見出しの `[YYYY-MM-DD]`。 */
  date: string
  /** 契約 §6-4 の規則で検出したタグ。 */
  tag: GotchaTag | null
  /** タグを除いたタイトル。 */
  title: string
  /** 見出し行(生のまま。\r を含みうる)。 */
  headingLine: string
  /** 見出し行の 0 始まり行番号。 */
  startIndex: number
  /** エントリの終端(この行は含まない)。 */
  endIndex: number
  /** 見出しを含むエントリ全体の生テキスト。 */
  raw: string
  /** `**名前**: 値` を素のまま集めたもの。未知の名前も入る。 */
  fields: Record<string, string>
}

export interface GotchasSection {
  headingIndex: number
  /** 次の `##` 見出し、または文末(この行は含まない)。 */
  endIndex: number
}

export interface GotchasDocument {
  text: string
  /** `text.split("\n")` の結果。行末の \r は落としていない。 */
  lines: string[]
  /** 挿入行に付ける改行コードの判定に使う。 */
  crlf: boolean
  /** `## 失敗パターン一覧` 節。無ければ null。 */
  listSection: GotchasSection | null
  /** `## 失敗パターン一覧` 配下のエントリだけ。記入テンプレートは含まない。 */
  entries: GotchaEntry[]
  maxNumber: number
  nextNumber: number
  unclosedFence: boolean
  warnings: string[]
}

function parseTagAndTitle(rest: string): {
  tag: GotchaTag | null
  title: string
} {
  const m = TAG_RE.exec(rest)
  if (m === null) return { tag: null, title: rest.trim() }
  const literal = m[1]
  const tag = (literal === "[解決済み]" ? "解決済み" : "対象外") as GotchaTag
  return { tag, title: (m[2] ?? "").trim() }
}

// 「原因 (推測)」と「原因(推測)」を同じフィールドとして読む(読み取りだけの寛容さ)。
function normalizeFieldName(name: string): string {
  return name.replace(/[\s　]/g, "")
}

const FIELD_KEYS: Record<string, keyof GotchaFields> = {
  タスク: "task",
  失敗内容: "mistake",
  "原因(推測)": "cause",
  対策: "countermeasure",
  昇格候補: "promotionCandidate"
}

function parseEntryFields(bodyLines: string[]): {
  fields: Record<string, string>
  values: GotchaFields
} {
  const fields: Record<string, string> = {}
  const values: GotchaFields = {
    task: "",
    mistake: "",
    cause: "",
    countermeasure: "",
    promotionCandidate: null
  }

  for (const raw of bodyLines) {
    const m = FIELD_LINE_RE.exec(stripCr(raw))
    if (m === null) continue
    const name = m[1].trim()
    const value = m[2].trim()
    if (fields[name] === undefined) fields[name] = value

    const key = FIELD_KEYS[normalizeFieldName(name)]
    if (key === undefined) continue
    if (key === "promotionCandidate") {
      if (
        values.promotionCandidate === null &&
        (value === "Yes" || value === "No")
      ) {
        values.promotionCandidate = value
      }
      continue
    }
    if (values[key] === "") values[key] = value
  }

  return { fields, values }
}

function parseWith(text: string, ignoreFences: boolean): GotchasDocument {
  const lines = text.split("\n")
  const { blocked, unclosedFence } = scanFences(lines, ignoreFences)
  const warnings: string[] = []

  // 契約 §6-2: `## 失敗パターン一覧` 配下だけを解析する。同名が複数あれば最初を採る。
  let listSection: GotchasSection | null = null
  for (let i = 0; i < lines.length; i++) {
    if (blocked[i]) continue
    const m = SECTION_HEADING_RE.exec(stripCr(lines[i]))
    if (m === null) continue
    if (listSection === null && m[1].trim() === LIST_SECTION_TITLE) {
      listSection = { headingIndex: i, endIndex: lines.length }
      continue
    }
    if (listSection !== null && listSection.endIndex === lines.length) {
      listSection.endIndex = i
      break
    }
  }

  const entries: GotchaEntry[] = []
  if (listSection !== null) {
    const starts: number[] = []
    for (let i = listSection.headingIndex + 1; i < listSection.endIndex; i++) {
      if (blocked[i]) continue
      if (!SUB_HEADING_RE.test(stripCr(lines[i]))) continue
      // GOTCHA 形式でない `###` はエントリではないが、区切りとしては働かせる。
      starts.push(i)
    }
    for (let s = 0; s < starts.length; s++) {
      const startIndex = starts[s]
      const endIndex =
        s + 1 < starts.length ? starts[s + 1] : listSection.endIndex
      const headingLine = lines[startIndex]
      const m = ENTRY_HEADING_RE.exec(stripCr(headingLine))
      if (m === null) continue
      const bodyLines = lines.slice(startIndex + 1, endIndex)
      const { fields, values } = parseEntryFields(bodyLines)
      const { tag, title } = parseTagAndTitle(m[4])
      const num = Number.parseInt(m[3], 10)
      entries.push({
        ...values,
        id: formatGotchaId(num),
        number: num,
        date: m[2],
        tag,
        title,
        headingLine,
        startIndex,
        endIndex,
        raw: lines.slice(startIndex, endIndex).join("\n"),
        fields
      })
    }
  }

  // 契約 §6-3: 全エントリを走査して最大値 + 1。並びが崩れていても衝突しない。
  let maxNumber = 0
  for (const entry of entries) {
    if (entry.number > maxNumber) maxNumber = entry.number
  }

  if (unclosedFence) {
    warnings.push(
      "未閉のコードフェンスがあります。エントリの範囲が正しく取れていない可能性があります。"
    )
  }

  return {
    text,
    lines,
    crlf: text.includes("\r\n"),
    listSection,
    entries,
    maxNumber,
    nextNumber: maxNumber + 1,
    unclosedFence,
    warnings
  }
}

/**
 * 台帳を解析する。例外を投げない(読み取り経路からも使うため)。
 *
 * 未閉フェンスがある場合は、フェンスを無視した走査も行って結果をマージする。
 * フェンスに飲み込まれた見出しを数え落として採番が衝突するのを防ぐためで、
 * 採番は必ず両者の大きいほうを採る(番号を使い回さない方向へ倒す)。
 */
export function parseGotchas(text: string): GotchasDocument {
  const primary = parseWith(text, false)
  if (!primary.unclosedFence) return primary

  const fallback = parseWith(text, true)
  const useFallback =
    primary.listSection === null && fallback.listSection !== null
  const base = useFallback ? fallback : primary
  const maxNumber = Math.max(primary.maxNumber, fallback.maxNumber)
  const warnings = [...primary.warnings]
  if (useFallback) {
    warnings.push(
      "未閉フェンスのため、フェンスを無視した走査で `## 失敗パターン一覧` を特定しました。"
    )
  }

  return {
    ...base,
    maxNumber,
    nextNumber: maxNumber + 1,
    unclosedFence: true,
    warnings
  }
}

export function formatGotchaId(num: number): string {
  return `GOTCHA-${String(num).padStart(3, "0")}`
}

/** `GOTCHA-003` / `gotcha-3` / `3` のいずれも受け付ける。 */
export function parseGotchaId(raw: string): number | null {
  const m = /^(?:GOTCHA-)?(\d+)$/i.exec(raw.trim())
  if (m === null) return null
  const num = Number.parseInt(m[1], 10)
  return Number.isFinite(num) ? num : null
}

export function findGotchaByNumber(
  doc: GotchasDocument,
  num: number
): GotchaEntry | null {
  return doc.entries.find((entry) => entry.number === num) ?? null
}

// ---------------------------------------------------------------------------
// フィルタ(契約 §11 の `get gotchas` オプション)
// ---------------------------------------------------------------------------

export interface GotchaFilter {
  /** `[解決済み]` / `[対象外]` タグの付いたエントリを除く。 */
  excludeTagged?: boolean
  /** `昇格候補: Yes` のエントリだけを残す。 */
  promotionCandidates?: boolean
  /** ID(`GOTCHA-003` 等)での絞り込み。 */
  id?: string
  /** 見出し・本文への部分一致。 */
  query?: string
  /** 先頭から N 件(台帳の並びは新しいものが上)。 */
  recent?: number
}

export function filterGotchas(
  entries: GotchaEntry[],
  filter: GotchaFilter = {}
): GotchaEntry[] {
  let result = entries

  if (filter.id !== undefined) {
    const num = parseGotchaId(filter.id)
    result = num === null ? [] : result.filter((e) => e.number === num)
  }
  if (filter.query !== undefined && filter.query !== "") {
    const needle = filter.query.toLowerCase()
    result = result.filter((e) => e.raw.toLowerCase().includes(needle))
  }
  if (filter.excludeTagged === true) {
    result = result.filter((e) => e.tag === null)
  }
  if (filter.promotionCandidates === true) {
    result = result.filter((e) => e.promotionCandidate === "Yes")
  }
  if (filter.recent !== undefined && filter.recent >= 0) {
    result = result.slice(0, filter.recent)
  }
  return result
}

// ---------------------------------------------------------------------------
// 検証(契約 §6-2、設計書 §7-4)
// ---------------------------------------------------------------------------

export interface GotchaInput {
  title: string
  /** 省略時は当日日付。 */
  date?: string
  task: string
  mistake: string
  cause: string
  countermeasure: string
  /** `Yes` / `No` のみ。他は拒否する。 */
  promotionCandidate: string
}

export interface ValidationResult {
  errors: string[]
  warnings: string[]
}

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/

// 「気をつける」だけの対策を弾くための正規化。判定を厳密にすると正当な対策まで
// 弾いてしまうため、完全一致する短い定型句だけを対象にする(拒否ではなく警告)。
const PLATITUDES = new Set([
  "気をつける",
  "気を付ける",
  "気をつけたい",
  "気をつけること",
  "気を付けること",
  "注意",
  "注意する",
  "注意したい",
  "注意すること"
])

function normalizeForPlatitude(value: string): string {
  return value.replace(/[\s　]/g, "").replace(/[。.、,!！]+$/, "")
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
    errors.push(
      `${label} に改行が含まれています。1 行で書ける内容に要約してください。`
    )
    return ""
  }
  return value
}

export function validateGotchaInput(input: GotchaInput): ValidationResult {
  const errors: string[] = []
  const warnings: string[] = []

  const title = requireSingleLine(input.title, "title", errors)
  if (title.trim() === "") errors.push("title が空です。")

  if (input.date !== undefined) {
    if (typeof input.date !== "string" || !DATE_RE.test(input.date)) {
      errors.push("date は YYYY-MM-DD の形式で指定してください。")
    }
  }

  const task = requireSingleLine(input.task, "task", errors)
  const mistake = requireSingleLine(input.mistake, "mistake", errors)
  const cause = requireSingleLine(input.cause, "cause", errors)
  const countermeasure = requireSingleLine(
    input.countermeasure,
    "countermeasure",
    errors
  )

  // 契約 §6-2: 昇格候補は Yes / No のみ。値域が 2 つしかなく、
  // 揺れると 5 件ルールの集計ができなくなるため拒否する。
  if (input.promotionCandidate !== "Yes" && input.promotionCandidate !== "No") {
    errors.push(
      `promotionCandidate は "Yes" または "No" のみを受け付けます(受領: ${JSON.stringify(
        input.promotionCandidate
      )})。`
    )
  }

  for (const [label, value] of [
    ["task", task],
    ["mistake", mistake],
    ["cause", cause]
  ] as const) {
    if (value.trim() === "") warnings.push(`${label} が空です。`)
  }

  // 設計書 §7-4: 空・精神論のみは警告(拒否はしない)。
  const normalized = normalizeForPlatitude(countermeasure)
  if (normalized === "") {
    warnings.push(
      "countermeasure が空です。次のエージェントがそのまま実行できる行動に落としてください。"
    )
  } else if (PLATITUDES.has(normalized)) {
    warnings.push(
      "countermeasure が精神論のみです。「〜する前に〜を Read して確認する」の形に書き換えてください。"
    )
  }

  return { errors, warnings }
}

// ---------------------------------------------------------------------------
// 雛形とエントリの生成(契約 §6-1)
// ---------------------------------------------------------------------------

const TEMPLATE_LINES = [
  "# GOTCHAS",
  "",
  "このプロジェクトで AI が実際にやってしまった失敗のパターンを蓄積する。",
  "発見された失敗を、下記のフォーマットで追記していく。",
  "",
  "## 運用ルール",
  "",
  "- 新しいものを上に追加する。",
  "- 同じパターンが 5 件以上蓄積されたら、スキルまたは Hook への昇格を検討する。",
  "- 解決済みの項目は `[解決済み]` タグを付けて残す。削除しない。",
  "- 陳腐化した項目は `[対象外]` タグを付けて残す。削除しない。",
  "",
  "## 記入テンプレート",
  "",
  "### [YYYY-MM-DD] GOTCHA-NNN: 失敗のタイトル",
  "",
  "**タスク**: (何をしようとしていたか)",
  "**失敗内容**: (具体的に何を間違えたか)",
  "**原因 (推測)**: (なぜそうなったか)",
  "**対策**: (今後 AI はどう振る舞うべきか)",
  "**昇格候補**: Yes / No (スキルや Hook にするべきか)",
  "",
  `## ${LIST_SECTION_TITLE}`,
  ""
]

/** 契約 §6-1 の雛形。台帳が無いときはこれを作ってから先頭挿入する。 */
export function renderGotchasTemplate(): string {
  return TEMPLATE_LINES.join("\n")
}

function renderEntryLines(
  num: number,
  date: string,
  input: GotchaInput
): string[] {
  return [
    `### [${date}] ${formatGotchaId(num)}: ${input.title.trim()}`,
    "",
    `**タスク**: ${input.task.trim()}`,
    `**失敗内容**: ${input.mistake.trim()}`,
    `**原因 (推測)**: ${input.cause.trim()}`,
    `**対策**: ${input.countermeasure.trim()}`,
    `**昇格候補**: ${input.promotionCandidate}`
  ]
}

function applyEol(lines: string[], crlf: boolean): string[] {
  return crlf ? lines.map((line) => `${line}\r`) : lines
}

function isBlank(line: string): boolean {
  return stripCr(line).trim() === ""
}

// ---------------------------------------------------------------------------
// 先頭挿入(契約 §6-3)
// ---------------------------------------------------------------------------

export interface BuildAppendResult {
  text: string
  id: string
  number: number
  /** 台帳を雛形ごと新規作成したか。 */
  created: boolean
  /** 既存文書へ `## 失敗パターン一覧` 節を足したか。 */
  sectionCreated: boolean
  warnings: string[]
}

/**
 * 新エントリを `## 失敗パターン一覧` の直下へ挿入したテキストを返す(純関数)。
 *
 * 既存の行には一切手を触れないため、既存エントリはバイト単位で不変になる。
 * `existing` が null / 空白のみなら雛形ごと作り、節が無いだけなら節を足して既存記述を残す。
 */
export function buildAppendedText(
  existing: string | null,
  input: GotchaInput,
  date: string
): BuildAppendResult {
  const warnings: string[] = []
  let created = false
  let sectionCreated = false

  let source = existing
  if (source === null || source.trim() === "") {
    source = renderGotchasTemplate()
    created = true
  }

  let doc = parseGotchas(source)
  warnings.push(...doc.warnings)

  if (doc.listSection === null) {
    // 節が無いだけなら節を足す。既存の記述は保持する(設計書 §12-2)。
    const lines = [...doc.lines]
    while (lines.length > 0 && isBlank(lines[lines.length - 1])) lines.pop()
    lines.push(...applyEol(["", `## ${LIST_SECTION_TITLE}`, ""], doc.crlf))
    doc = parseGotchas(lines.join("\n"))
    sectionCreated = !created
  }

  const section = doc.listSection
  if (section === null) {
    // 直前で節を足しているためここには来ない。到達したら書かずに止める。
    throw new GotchaError(
      "invalid_input",
      `\`## ${LIST_SECTION_TITLE}\` 節を作成できませんでした。`
    )
  }

  const num = doc.nextNumber
  const insertAt = section.headingIndex + 1
  const block = ["", ...renderEntryLines(num, date, input)]

  const following = doc.lines[insertAt]
  if (following === undefined || !isBlank(following)) {
    // 末尾に挿入した場合の最終改行、または後続エントリとの間の空行を補う。
    block.push("")
  }

  const lines = [...doc.lines]
  lines.splice(insertAt, 0, ...applyEol(block, doc.crlf))

  return {
    text: lines.join("\n"),
    id: formatGotchaId(num),
    number: num,
    created,
    sectionCreated,
    warnings
  }
}

// ---------------------------------------------------------------------------
// タグ付与(契約 §6-5)
// ---------------------------------------------------------------------------

export interface BuildTagResult {
  text: string
  id: string
  previousTag: GotchaTag | null
  tag: GotchaTag
  warnings: string[]
}

/**
 * 見出しへのタグ挿入と、エントリ末尾への理由行の追記(純関数)。
 *
 * 変更は 2 箇所だけで、エントリ本文は書き換えない。再付与のときは見出しのタグを
 * 差し替え、理由行は追記する(前の理由行を残し、状態遷移の履歴が読めるようにする)。
 */
export function buildTaggedText(
  existing: string,
  num: number,
  tag: GotchaTag,
  reason: string,
  date: string
): BuildTagResult {
  const doc = parseGotchas(existing)
  const entry = findGotchaByNumber(doc, num)
  if (entry === null) {
    throw new GotchaError(
      "not_found",
      `${formatGotchaId(num)} が \`## ${LIST_SECTION_TITLE}\` 配下に見つかりません。`
    )
  }

  const lines = [...doc.lines]
  const rawHeading = lines[entry.startIndex]
  const hadCr = rawHeading.endsWith("\r")
  const m = ENTRY_HEADING_RE.exec(stripCr(rawHeading))
  if (m === null) {
    throw new GotchaError(
      "not_found",
      `${formatGotchaId(num)} の見出しを解析できませんでした。`
    )
  }

  // 1. 見出し行のタイトル直前へタグを入れる。接頭辞(`### [日付] GOTCHA-NNN:`)は原文のまま。
  const title = entry.title
  const rebuilt = `${m[1]} [${tag}]${title === "" ? "" : ` ${title}`}`
  lines[entry.startIndex] = hadCr ? `${rebuilt}\r` : rebuilt

  // 2. エントリ末尾へ理由を 1 行追記する。
  let last = entry.startIndex
  for (let i = entry.endIndex - 1; i > entry.startIndex; i--) {
    if (!isBlank(lines[i])) {
      last = i
      break
    }
  }
  const reasonLine = `**[${tag}] (${date})**: ${reason.trim()}`
  lines.splice(last + 1, 0, ...applyEol([reasonLine], doc.crlf))

  return {
    text: lines.join("\n"),
    id: entry.id,
    previousTag: entry.tag,
    tag,
    warnings: doc.warnings
  }
}

// ---------------------------------------------------------------------------
// ロック(契約 §11「採番と挿入の原子性」)
// ---------------------------------------------------------------------------

export const LOCK_RETRY_INTERVAL_MS = 50
export const LOCK_MAX_RETRIES = 20
export const LOCK_STALE_MS = 60_000

/** ロックファイルは対象文書のパスに `.lock` を付けたもの。2 文書で別々になる。 */
export function lockPathFor(targetPath: string): string {
  return `${targetPath}.lock`
}

function sleepSync(ms: number): void {
  // 追加依存なしに同期待ちする。CLI はサブコマンドごとの短命プロセスであり、
  // ここで同期的に待っても他の処理を妨げない。
  const shared = new Int32Array(new SharedArrayBuffer(4))
  Atomics.wait(shared, 0, 0, ms)
}

function errnoCode(error: unknown): string | undefined {
  return (error as NodeJS.ErrnoException | undefined)?.code
}

function tryCreateLock(lockPath: string): boolean {
  try {
    const fd = fs.openSync(lockPath, "wx")
    try {
      fs.writeSync(fd, `${process.pid} ${new Date().toISOString()}\n`)
    } finally {
      fs.closeSync(fd)
    }
    return true
  } catch (error) {
    if (errnoCode(error) === "EEXIST") return false
    throw error
  }
}

function statMtimeMs(lockPath: string): number | null {
  try {
    return fs.statSync(lockPath).mtimeMs
  } catch {
    return null
  }
}

// 契約 §11 の 4: 死んだロックの奪取。手順を固定する。
// 1. unlink の直前に更新時刻を再取得し、なお 60 秒より古いことを確認する。
// 2. unlink する(ENOENT はそのまま次へ)。
// 3. 改めて wx で作成を試みる。奪取後の作成成功を仮定しない。
function tryStealStaleLock(lockPath: string): boolean {
  const mtimeMs = statMtimeMs(lockPath)
  if (mtimeMs === null) return tryCreateLock(lockPath)
  if (Date.now() - mtimeMs <= LOCK_STALE_MS) return false

  try {
    fs.unlinkSync(lockPath)
  } catch (error) {
    if (errnoCode(error) !== "ENOENT") return false
  }
  return tryCreateLock(lockPath)
}

/**
 * 対象文書のロックを取り、取れた場合だけ `fn` を実行する。
 *
 * `fs.open` の `wx` フラグによる排他作成で相互排除する。取得できなければ 50ms 間隔で
 * 最大 20 回リトライし、それでも取れなければ `lock_timeout` を投げる。
 *
 * ARCHITECTURE 側(`stage-adr` / `commit-architecture`)もこの関数を使い、
 * 対象パスが違えば別のロックになる。2 文書のロックは互いをブロックしない。
 */
export function withFileLock<T>(targetPath: string, fn: () => T): T {
  const lockPath = lockPathFor(targetPath)
  try {
    fs.mkdirSync(path.dirname(lockPath), { recursive: true })
  } catch {
    // 作成できない場合は後続の open が同じ理由で失敗するので、ここでは何もしない。
  }

  let acquired = tryCreateLock(lockPath)
  for (let attempt = 0; !acquired && attempt < LOCK_MAX_RETRIES; attempt++) {
    const mtimeMs = statMtimeMs(lockPath)
    if (mtimeMs !== null && Date.now() - mtimeMs > LOCK_STALE_MS) {
      acquired = tryStealStaleLock(lockPath)
      if (acquired) break
    }
    sleepSync(LOCK_RETRY_INTERVAL_MS)
    acquired = tryCreateLock(lockPath)
  }

  if (!acquired) {
    throw new GotchaError(
      "lock_timeout",
      `${lockPath} のロックを取得できませんでした。他のプロセスが書き込み中の可能性があります。`
    )
  }

  try {
    return fn()
  } finally {
    try {
      fs.rmSync(lockPath, { force: true })
    } catch {
      // 解放に失敗しても 60 秒後には死んだロックとして奪える。
    }
  }
}

// ---------------------------------------------------------------------------
// 書き込み経路
// ---------------------------------------------------------------------------

function readTextIfExists(filePath: string): string | null {
  try {
    return fs.readFileSync(filePath, "utf8")
  } catch (error) {
    if (errnoCode(error) === "ENOENT") return null
    throw error
  }
}

function formatToday(now: Date): string {
  const y = String(now.getFullYear()).padStart(4, "0")
  const m = String(now.getMonth() + 1).padStart(2, "0")
  const d = String(now.getDate()).padStart(2, "0")
  return `${y}-${m}-${d}`
}

export interface WriteOptions {
  /** 日付の既定値を決めるための現在時刻。テストから固定するために使う。 */
  now?: Date
}

export interface AppendGotchaResult {
  id: string
  number: number
  path: string
  date: string
  created: boolean
  sectionCreated: boolean
  warnings: string[]
}

/**
 * 新しいエントリを `## 失敗パターン一覧` の直下へ挿入する(契約 §6-3)。
 *
 * 採番から書き込みまでをロック下で行う。CLI はサブコマンドごとに別プロセスとして
 * 起動するため、プロセス内のロックでは同時実行の採番衝突を防げない。
 */
export function appendGotcha(
  gotchasPath: string,
  input: GotchaInput,
  options: WriteOptions = {}
): AppendGotchaResult {
  const validation = validateGotchaInput(input)
  if (validation.errors.length > 0) {
    throw new GotchaError(
      "invalid_input",
      `入力が書式を満たしていません: ${validation.errors.join(" / ")}`,
      validation.errors
    )
  }

  const date = input.date ?? formatToday(options.now ?? new Date())

  return withFileLock(gotchasPath, () => {
    const existing = readTextIfExists(gotchasPath)
    const built = buildAppendedText(existing, input, date)
    fs.mkdirSync(path.dirname(gotchasPath), { recursive: true })
    fs.writeFileSync(gotchasPath, built.text)
    return {
      id: built.id,
      number: built.number,
      path: gotchasPath,
      date,
      created: built.created,
      sectionCreated: built.sectionCreated,
      warnings: [...validation.warnings, ...built.warnings]
    }
  })
}

export interface TagGotchaParams {
  /** `GOTCHA-003` の形。数値だけでも受け付ける。 */
  id: string
  tag: string
  reason: string
  /** 省略時は当日日付。 */
  date?: string
}

export interface TagGotchaResult {
  id: string
  path: string
  tag: GotchaTag
  previousTag: GotchaTag | null
  date: string
  warnings: string[]
}

function isGotchaTag(value: string): value is GotchaTag {
  return (GOTCHA_TAGS as readonly string[]).includes(value)
}

/**
 * 既存エントリへタグを付与する(契約 §6-5)。
 *
 * 変更は見出しへのタグ挿入と末尾の理由行の 2 箇所だけで、本文は不変。
 * 再付与のときは見出しのタグを差し替え、理由行は追記する。
 */
export function tagGotcha(
  gotchasPath: string,
  params: TagGotchaParams,
  options: WriteOptions = {}
): TagGotchaResult {
  if (!isGotchaTag(params.tag)) {
    throw new GotchaError(
      "invalid_tag",
      `--tag は ${GOTCHA_TAGS.join(" / ")} のみを受け付けます(受領: ${JSON.stringify(
        params.tag
      )})。`
    )
  }
  const tag = params.tag

  const errors: string[] = []
  const reason = requireSingleLine(params.reason, "reason", errors)
  if (reason.trim() === "") {
    errors.push("reason が空です。タグを付ける理由は必須です。")
  }
  if (params.date !== undefined && !DATE_RE.test(params.date)) {
    errors.push("date は YYYY-MM-DD の形式で指定してください。")
  }
  if (errors.length > 0) {
    throw new GotchaError(
      "invalid_input",
      `入力が書式を満たしていません: ${errors.join(" / ")}`,
      errors
    )
  }

  const num = parseGotchaId(params.id)
  if (num === null) {
    throw new GotchaError(
      "invalid_input",
      `--id は GOTCHA-NNN の形式で指定してください(受領: ${JSON.stringify(params.id)})。`
    )
  }

  const date = params.date ?? formatToday(options.now ?? new Date())

  return withFileLock(gotchasPath, () => {
    const existing = readTextIfExists(gotchasPath)
    if (existing === null) {
      throw new GotchaError("not_found", `${gotchasPath} が存在しません。`)
    }
    const built = buildTaggedText(existing, num, tag, reason, date)
    fs.writeFileSync(gotchasPath, built.text)
    return {
      id: built.id,
      path: gotchasPath,
      tag: built.tag,
      previousTag: built.previousTag,
      date,
      warnings: built.warnings
    }
  })
}
