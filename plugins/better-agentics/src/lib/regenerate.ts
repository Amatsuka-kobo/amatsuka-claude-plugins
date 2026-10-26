import { HASH_KEY, ROLE_KEY } from "./compose"
import { type Document, parseDocument, render } from "./document"
import { decodeRecord, encodeRecord, type HashRecord, textHash } from "./hash"

/** classify の戻り値。SectionReport.state はこれに "new" と "extra" を足した 6 値 */
export type TextState = "same" | "unknown" | "templateChanged" | "userEdited"
export type SectionState = TextState | "new" | "extra"

export interface SectionReport {
  /** "description" / "preamble" / 見出し行 */
  key: string
  state: SectionState
  /** unknown・templateChanged・userEdited のときだけ */
  existing?: string
  template?: string
}

export interface MergeInput {
  existingRaw: string
  templateRaw: string
  /** キーは "description" / "preamble" / 見出し行 */
  keep: Set<string>
}

export interface MergeOutput {
  content: string
  kept: string[]
  replaced: string[]
  keysKept: string[]
}

// テンプレートの値を使う frontmatter のキー。disallowedTools と MCP は、呼び出し側が
// 既存から引き継ぐかを決めてテンプレートに入れる。
const GENERATED_KEYS = [
  "name",
  "description",
  "model",
  "effort",
  "tools",
  "disallowedTools",
  ROLE_KEY,
  HASH_KEY
]

// record は、既存の記録のうちそのキーの値。記録が無ければ undefined。
export function classify(
  existing: string,
  template: string,
  record: string | undefined
): TextState {
  if (textHash(existing) === textHash(template)) return "same"
  if (record === undefined) return "unknown"
  if (textHash(existing) === record) return "templateChanged"
  return "userEdited"
}

function recordValue(
  record: HashRecord | undefined,
  key: string
): string | undefined {
  if (record === undefined) return undefined
  if (key === "description") return record.description
  if (key === "preamble") return record.preamble
  return record.sections[key]
}

function textOf(document: Document, key: string): string | undefined {
  if (key === "description") return document.meta.get("description") ?? ""
  if (key === "preamble") return document.preamble
  return document.sections.get(key)
}

function report(
  key: string,
  existing: string,
  template: string,
  record: HashRecord | undefined
): SectionReport {
  const state = classify(existing, template, recordValue(record, key))
  return state === "same" ? { key, state } : { key, state, existing, template }
}

export function compare(
  existingRaw: string,
  templateRaw: string
): SectionReport[] {
  const existing = parseDocument(existingRaw)
  const template = parseDocument(templateRaw)
  const record = decodeRecord(existing.meta.get(HASH_KEY))

  const reports: SectionReport[] = []
  for (const key of ["description", "preamble"]) {
    reports.push(
      report(
        key,
        textOf(existing, key) ?? "",
        textOf(template, key) ?? "",
        record
      )
    )
  }
  for (const [heading, body] of template.sections) {
    const current = existing.sections.get(heading)
    reports.push(
      current === undefined
        ? { key: heading, state: "new" }
        : report(heading, current, body, record)
    )
  }
  for (const heading of existing.sections.keys()) {
    if (!template.sections.has(heading)) {
      reports.push({ key: heading, state: "extra" })
    }
  }
  return reports
}

export function merge(input: MergeInput): MergeOutput {
  const existing = parseDocument(input.existingRaw)
  const template = parseDocument(input.templateRaw)
  const existingRecord = decodeRecord(existing.meta.get(HASH_KEY))
  const record = decodeRecord(template.meta.get(HASH_KEY)) ?? { sections: {} }
  const reports = compare(input.existingRaw, input.templateRaw)

  const kept: string[] = []
  const replaced: string[] = []
  const keepRecord = (key: string): void => {
    const value = recordValue(existingRecord, key)
    if (key === "description" || key === "preamble") {
      if (value === undefined) delete record[key]
      else record[key] = value
    } else if (value === undefined) {
      delete record.sections[key]
    } else {
      record.sections[key] = value
    }
  }

  const merged: Document = {
    order: [...template.order],
    meta: new Map(template.meta),
    preamble: template.preamble,
    sections: new Map(template.sections)
  }
  // name は書き直すキーに含めない(設計書 §9-3)。
  merged.meta.set(
    "name",
    existing.meta.get("name") ?? template.meta.get("name") ?? ""
  )

  for (const entry of reports) {
    if (entry.state === "extra") {
      merged.sections.set(entry.key, existing.sections.get(entry.key) ?? "")
      kept.push(entry.key)
      continue
    }
    if (input.keep.has(entry.key)) {
      if (entry.key === "description") {
        merged.meta.set("description", existing.meta.get("description") ?? "")
      } else if (entry.key === "preamble") {
        merged.preamble = existing.preamble
      } else {
        merged.sections.set(entry.key, existing.sections.get(entry.key) ?? "")
      }
      keepRecord(entry.key)
      kept.push(entry.key)
      continue
    }
    if (entry.state !== "same" && entry.state !== "new")
      replaced.push(entry.key)
  }

  const keysKept = existing.order.filter(
    (key) => !GENERATED_KEYS.includes(key) && !merged.meta.has(key)
  )
  for (const key of keysKept) {
    merged.order.push(key)
    merged.meta.set(key, existing.meta.get(key) ?? "")
  }
  merged.meta.set(HASH_KEY, encodeRecord(record))

  return { content: render(merged), kept, replaced, keysKept }
}
