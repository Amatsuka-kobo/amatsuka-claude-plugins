// レビュー項目・コメントの YAML frontmatter サブセット(フラット key-value +
// インライン配列のみ)。外部 YAML ライブラリへの依存を避けるための最小実装。
export type FrontmatterData = Record<string, string | number | string[]>

// 値に YAML 的に危険な文字が含まれる場合、および数字始まり(YAML で数値に
// 化ける "002"・"7be90d4" 等)の場合は JSON 文字列として引用する
function quote(v: string): string {
  return /[:#"[\],]|[\r\n]|^[\s\d]|\s$|^$/.test(v) ? JSON.stringify(v) : v
}

function unquote(v: string): string {
  if (v.startsWith('"') && v.endsWith('"') && v.length >= 2) {
    try {
      return JSON.parse(v) as string
    } catch {
      return v.slice(1, -1)
    }
  }
  return v
}

export function serializeFrontmatter(data: FrontmatterData): string {
  const lines = ["---"]
  for (const [key, value] of Object.entries(data)) {
    if (Array.isArray(value)) {
      lines.push(`${key}: [${value.map(quote).join(", ")}]`)
    } else {
      lines.push(`${key}: ${quote(String(value))}`)
    }
  }
  lines.push("---")
  return lines.join("\n")
}

export function parseFrontmatter(text: string): {
  data: Record<string, string | string[]>
  body: string
} {
  const m = text.match(/^---\n([\s\S]*?)\n---\n?/)
  if (!m) return { data: {}, body: text }
  const data: Record<string, string | string[]> = {}
  for (const line of m[1].split("\n")) {
    const kv = line.match(/^([A-Za-z][\w-]*):\s*(.*)$/)
    if (!kv) continue
    const [, key, raw] = kv
    // 手書きコメント(設計書 §5 の C 方式)の末尾空白に耐える
    const value = raw.trimEnd()
    if (value.startsWith("[") && value.endsWith("]")) {
      const inner = value.slice(1, -1).trim()
      data[key] =
        inner === "" ? [] : inner.split(",").map((s) => unquote(s.trim()))
    } else {
      data[key] = unquote(value)
    }
  }
  return { data, body: text.slice(m[0].length) }
}
