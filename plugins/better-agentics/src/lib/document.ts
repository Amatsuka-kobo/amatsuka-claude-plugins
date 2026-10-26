export interface Document {
  /** frontmatter のキーの出現順 */
  order: string[]
  /** block 値は "\n" から始まる値として丸ごと保つ */
  meta: Map<string, string>
  /** frontmatter の後から最初の "## " 見出しの前まで(trim 済み) */
  preamble: string
  /** キーは見出し行、値は本文(trim 済み) */
  sections: Map<string, string>
}

function frontmatterClose(lines: string[]): number {
  if (lines[0]?.trim() !== "---") return -1
  return lines.indexOf("---", 1)
}

export function parseDocument(content: string): Document {
  const lines = content.split("\n")
  const close = frontmatterClose(lines)
  const meta = new Map<string, string>()
  const order: string[] = []

  if (close !== -1) {
    let blockKey: string | undefined
    for (const line of lines.slice(1, close)) {
      // hooks のようなブロック値は、字下げされた後続行を改行付きで値に含めて丸ごと保つ。
      if (blockKey !== undefined && /^(\s|-)/.test(line)) {
        meta.set(blockKey, `${meta.get(blockKey)}\n${line}`)
        continue
      }
      blockKey = undefined
      const block = /^([^\s:#][^:]*):$/.exec(line.trimEnd())
      if (block?.[1] !== undefined) {
        blockKey = block[1]
        meta.set(blockKey, "")
        order.push(blockKey)
        continue
      }
      const at = line.indexOf(": ")
      if (at <= 0) continue
      const key = line.slice(0, at)
      meta.set(key, line.slice(at + 2))
      order.push(key)
    }
  }

  const preamble: string[] = []
  const sections = new Map<string, string>()
  let heading: string | undefined
  let buffer: string[] = []

  for (const line of lines.slice(close === -1 ? 0 : close + 1)) {
    if (line.startsWith("## ")) {
      if (heading !== undefined) sections.set(heading, buffer.join("\n").trim())
      heading = line.trim()
      buffer = []
      continue
    }
    if (heading === undefined) preamble.push(line)
    else buffer.push(line)
  }
  if (heading !== undefined) sections.set(heading, buffer.join("\n").trim())

  return { order, meta, preamble: preamble.join("\n").trim(), sections }
}

export function render(document: Document): string {
  const head = ["---"]
  for (const key of document.order) {
    const value = document.meta.get(key) ?? ""
    head.push(value.startsWith("\n") ? `${key}:${value}` : `${key}: ${value}`)
  }
  head.push("---", "")

  const body: string[] = []
  if (document.preamble !== "") body.push(document.preamble, "")
  for (const [heading, content] of document.sections) {
    body.push(heading, "")
    if (content !== "") body.push(content, "")
  }

  return `${[...head, ...body].join("\n").trimEnd()}\n`
}

function bodyLines(content: string): string[] {
  const lines = content.split("\n")
  const close = frontmatterClose(lines)
  return close === -1 ? lines : lines.slice(close + 1)
}

// parseDocument は同じ見出しを後勝ちで 1 つにまとめるが、委譲先の基準は最初の見出しの配下とする。
export function sectionBody(body: string, heading: string): string | undefined {
  const lines = bodyLines(body)
  const start = lines.findIndex((line) => line.trim() === heading)
  if (start === -1) return undefined
  const rest = lines.slice(start + 1)
  const end = rest.findIndex((line) => line.startsWith("## "))
  return (end === -1 ? rest : rest.slice(0, end)).join("\n").trim()
}

export function duplicateHeadings(content: string): string[] {
  const seen = new Set<string>()
  const duplicated = new Set<string>()
  for (const line of bodyLines(content)) {
    if (!line.startsWith("## ")) continue
    const heading = line.trim()
    if (seen.has(heading)) duplicated.add(heading)
    seen.add(heading)
  }
  return [...duplicated]
}
