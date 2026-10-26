import fs from "node:fs"
import path from "node:path"
import { ROLE_KEY } from "./compose"
import { sectionBody } from "./document"
import { ROLES, type RoleId, roleById } from "./roles"

export type ToolsFormat = "csv" | "other" | "none"

export interface Definition {
  /** ファイル名から .md を除いた値 */
  file: string
  /** frontmatter の name。無ければ file */
  name: string
  role: string
  model: string | undefined
  effort: string | undefined
  /** undefined は tools 欄が無いか解釈できない */
  tools: string[] | undefined
  toolsFormat: ToolsFormat
  /** "## When to invoke" の配下。無ければ "" */
  whenToInvoke: string
}

export interface Inspection {
  known: Definition[]
  unknownRoles: { file: string; name: string; role: string }[]
  duplicates: { role: RoleId; names: string[] }[]
}

export function projectDirOf(env: NodeJS.ProcessEnv, fallback: string): string {
  const dir = env.CLAUDE_PROJECT_DIR
  return dir === undefined || dir === "" ? fallback : dir
}

/** tools が block 配列で書かれていたときだけ値が string[] になる。 */
function frontmatter(lines: string[]): Map<string, string | string[]> {
  const meta = new Map<string, string | string[]>()
  if (lines[0]?.trim() !== "---") return meta
  const close = lines.indexOf("---", 1)
  if (close === -1) return meta

  const metadataLines = lines.slice(1, close)
  for (const [index, line] of metadataLines.entries()) {
    const at = line.indexOf(":")
    if (at <= 0) continue
    const key = line.slice(0, at).trim()
    const value = line.slice(at + 1).trim()
    if (key === "tools" && value === "") {
      const items: string[] = []
      for (const candidate of metadataLines.slice(index + 1)) {
        const item = candidate.match(/^\s*-\s+(.+)$/)?.[1]
        if (item === undefined) break
        items.push(item)
      }
      meta.set(key, items.length === 0 ? value : items)
      continue
    }
    meta.set(key, value)
  }
  return meta
}

function unquote(value: string): string {
  const trimmed = value.trim()
  const quote = trimmed[0]
  if (
    trimmed.length >= 2 &&
    (quote === '"' || quote === "'") &&
    trimmed.at(-1) === quote
  ) {
    return trimmed.slice(1, -1)
  }
  return trimmed
}

function parseToolsField(
  raw: string | string[] | undefined
): string[] | undefined {
  if (raw === undefined) return undefined
  if (Array.isArray(raw)) {
    const parsed = raw.map(unquote).filter((item) => item !== "")
    return parsed.length === 0 ? undefined : parsed
  }
  const value = raw.trim()
  if (value === "") return undefined
  if (value.startsWith("[")) {
    if (!value.endsWith("]")) return undefined
    const inner = value.slice(1, -1).trim()
    if (inner === "") return []
    return inner
      .split(",")
      .map(unquote)
      .filter((item) => item !== "")
  }
  if (value.startsWith("{") || value.startsWith("|") || value.startsWith(">")) {
    return undefined
  }
  const parsed = value
    .split(",")
    .map(unquote)
    .filter((item) => item !== "")
  return parsed.length === 0 ? undefined : parsed
}

// 1 行のカンマ区切りだけを csv とする。行単位の書き換えはこの書式にだけ効く。
function toolsFormatOf(raw: string | string[] | undefined): ToolsFormat {
  if (raw === undefined) return "none"
  if (Array.isArray(raw)) return "other"
  const value = raw.trim()
  if (value === "" || /^[[{|>]/.test(value) || /["'()#]/.test(value)) {
    return "other"
  }
  return "csv"
}

// 書き換える行を 1 行に特定できるのは、字下げの無い行がちょうど 1 行のときだけである。
export function keyLinesOf(
  lines: string[],
  close: number,
  key: string
): number[] {
  const pattern = new RegExp(`^\\s*${key}\\s*:`)
  return lines
    .slice(1, Math.max(close, 1))
    .flatMap((line, index) => (pattern.test(line) ? [index + 1] : []))
}

export function keyLineAmbiguous(
  lines: string[],
  close: number,
  key: string
): boolean {
  const found = keyLinesOf(lines, close, key)
  return found.length > 1 || /^\s/.test(lines[found[0] ?? -1] ?? "")
}

function stringOf(value: string | string[] | undefined): string | undefined {
  return typeof value === "string" && value !== "" ? value : undefined
}

/** 存在しない・読めないディレクトリは [] を返す。読めない定義だけを飛ばす。 */
export function scanDefinitions(projectDir: string): Definition[] {
  const dir = path.join(projectDir, ".claude", "agents")
  let files: string[]
  try {
    files = fs.readdirSync(dir).sort()
  } catch {
    return []
  }

  const found: Definition[] = []
  for (const name of files) {
    if (!name.endsWith(".md")) continue
    let content: string
    try {
      content = fs.readFileSync(path.join(dir, name), "utf8")
    } catch {
      continue
    }
    const lines = content.split("\n")
    const meta = frontmatter(lines)
    const role = stringOf(meta.get(ROLE_KEY))
    if (role === undefined) continue

    const close = lines.indexOf("---", 1)
    const raw = meta.get("tools")
    const file = name.replace(/\.md$/, "")
    found.push({
      file,
      name: unquote(stringOf(meta.get("name")) ?? file),
      role,
      model: stringOf(meta.get("model")),
      effort: stringOf(meta.get("effort")),
      tools: parseToolsField(raw),
      toolsFormat:
        keyLineAmbiguous(lines, close, "tools") ||
        keyLineAmbiguous(lines, close, ROLE_KEY)
          ? "other"
          : toolsFormatOf(raw),
      whenToInvoke: sectionBody(content, "## When to invoke") ?? ""
    })
  }
  return found
}

export function inspect(definitions: Definition[]): Inspection {
  const known: Definition[] = []
  const unknownRoles: Inspection["unknownRoles"] = []
  for (const entry of definitions) {
    if (roleById(entry.role) === undefined) {
      unknownRoles.push({
        file: entry.file,
        name: entry.name,
        role: entry.role
      })
    } else {
      known.push(entry)
    }
  }
  const duplicates = ROLES.flatMap((role) => {
    const names = known
      .filter((entry) => entry.role === role.id)
      .map((entry) => entry.name)
    return names.length >= 2 ? [{ role: role.id, names }] : []
  })
  return { known, unknownRoles, duplicates }
}
