export interface ParsedFrontmatter {
  fields: Record<string, string>
  body: string
  errors: string[]
}

const FIELD_LINE = /^([^:\s][^:]*):(?:\s*(.*))?$/

/**
 * Agent 定義で使う範囲の YAML frontmatter を読み取る。
 * YAML 全体を解釈せず、トップレベルのスカラーだけを扱う。
 */
export function parseFrontmatter(source: string): ParsedFrontmatter {
  const lines = source.split(/\r?\n/)
  const errors: string[] = []

  if (lines[0] !== "---") {
    return {
      fields: {},
      body: source.trim(),
      errors: ["frontmatter が --- で始まっていない"]
    }
  }

  const end = lines.findIndex((line, index) => index > 0 && line === "---")
  if (end === -1) {
    return {
      fields: {},
      body: "",
      errors: ["frontmatter の終端 --- がない"]
    }
  }

  const fields: Record<string, string> = {}
  for (let index = 1; index < end; index += 1) {
    const match = lines[index].match(FIELD_LINE)
    if (!match) continue

    const [, key, value = ""] = match
    const hasIndentedValue =
      value === "|" ||
      value === ">" ||
      (value === "" && /^\s/.test(lines[index + 1] ?? ""))
    if (!hasIndentedValue) {
      fields[key] = value
      continue
    }

    const values: string[] = []
    index += 1
    while (index < end && (/^\s/.test(lines[index]) || lines[index] === "")) {
      values.push(lines[index])
      index += 1
    }
    index -= 1
    fields[key] = values.join("\n").trim()
  }

  return {
    fields,
    body: lines
      .slice(end + 1)
      .join("\n")
      .trim(),
    errors
  }
}
