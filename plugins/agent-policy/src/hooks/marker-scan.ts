import fs from "node:fs"
import path from "node:path"
import { roleById, sortRoleIds } from "../agents/roles"

export interface MarkedAgent {
  name: string
  model: string | undefined
  roles: string[]
  /** undefined = tools 欄なし・解釈不能(全ツール継承として扱う) / 値あり = 明示リスト */
  tools: string[] | undefined
  vendor: string | undefined
}

/** frontmatter の解析結果。tools が block 配列で書かれていたときだけ値が string[] になる。 */
export function frontmatter(file: string): Map<string, string | string[]> {
  const lines = fs.readFileSync(file, "utf8").split("\n")
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

function parseToolItems(items: string[]): string[] {
  return items.map(unquote).filter((item) => item !== "")
}

/** raw は frontmatter の tools 値(block 配列の場合は収集済みの要素列)。解釈不能な形式は undefined */
export function parseToolsField(
  raw: string | string[] | undefined
): string[] | undefined {
  if (raw === undefined) return undefined
  if (Array.isArray(raw)) {
    const parsed = parseToolItems(raw)
    return parsed.length === 0 ? undefined : parsed
  }

  const value = raw.trim()
  if (value === "") return undefined
  if (value.startsWith("[")) {
    if (!value.endsWith("]")) return undefined
    const inner = value.slice(1, -1).trim()
    if (inner === "") return []
    return parseToolItems(inner.split(","))
  }
  if (value.startsWith("{") || value.startsWith("|") || value.startsWith(">")) {
    return undefined
  }

  const parsed = parseToolItems(value.split(","))
  return parsed.length === 0 ? undefined : parsed
}

/** CLAUDE_PROJECT_DIR から .claude/agents のパスを組む。未設定・空なら undefined */
export function projectAgentsDir(env: NodeJS.ProcessEnv): string | undefined {
  const projectDir = env.CLAUDE_PROJECT_DIR
  if (projectDir === undefined || projectDir === "") return undefined
  return path.join(projectDir, ".claude", "agents")
}

/** 存在しない・読めないディレクトリは [] を返す。読めない定義だけを skip する。 */
export function scanAgents(dir: string | undefined): MarkedAgent[] {
  if (dir === undefined) return []

  let files: string[]
  try {
    files = fs.readdirSync(dir).sort()
  } catch {
    return []
  }

  const found: MarkedAgent[] = []
  for (const file of files) {
    if (!file.endsWith(".md")) continue

    let meta: Map<string, string | string[]>
    try {
      meta = frontmatter(path.join(dir, file))
    } catch {
      continue
    }

    const name = meta.get("name")
    const model = meta.get("model")
    const marker = meta.get("agent-policy-role")
    const vendor = meta.get("agent-policy-vendor")
    found.push({
      name: typeof name === "string" ? name : file.replace(/\.md$/, ""),
      model: typeof model === "string" ? model : undefined,
      roles:
        typeof marker === "string"
          ? marker
              .split(",")
              .map((role) => role.trim())
              .filter((role) => role !== "")
          : [],
      tools: parseToolsField(meta.get("tools")),
      vendor: typeof vendor === "string" ? vendor : undefined
    })
  }

  return found
}

/** 役割 ID → 表示ラベル。プロジェクト側カスタム役割断片も解決する。 */
export function roleLabel(
  env: NodeJS.ProcessEnv,
  role: string
): string | undefined {
  const known = roleById(role)
  if (known !== undefined) return known.label

  const projectDir = env.CLAUDE_PROJECT_DIR
  if (projectDir === undefined || projectDir === "") return undefined

  const base = path.join(projectDir, ".claude", "agent-policy", "roles")
  const candidates = [path.join(base, `${role}.md`)]
  try {
    if (fs.existsSync(base)) {
      for (const entry of fs.readdirSync(base, { withFileTypes: true })) {
        if (entry.isDirectory()) {
          candidates.push(path.join(base, entry.name, `${role}.md`))
        }
      }
    }
  } catch {
    // 走査に失敗しても、直下の候補だけで解決を試みる。
  }

  for (const file of candidates) {
    try {
      if (!fs.existsSync(file)) continue
      const value = frontmatter(file).get("label")
      return typeof value === "string" && value !== "" ? value : undefined
    } catch {
      // 1 ファイルが読めなくても、他の候補と方針注入は生かす。
    }
  }

  return undefined
}

/** 1 回の解決内で roleLabel の重複呼び出しを避けるメモ付き関数を返す。 */
export function roleLabels(
  env: NodeJS.ProcessEnv
): (role: string) => string | undefined {
  const labels = new Map<string, string | undefined>()
  return (role) => {
    if (labels.has(role)) return labels.get(role)
    const label = roleLabel(env, role)
    labels.set(role, label)
    return label
  }
}

/** 両フックが同一文面で使う役割マーカー対応表。 */
export function markerTable(
  env: NodeJS.ProcessEnv,
  marked: MarkedAgent[]
): string | undefined {
  const labelOf = roleLabels(env)
  const byRole = new Map<string, string[]>()
  for (const entry of marked) {
    for (const role of entry.roles) {
      if (labelOf(role) === undefined) continue
      const name =
        entry.vendor === undefined
          ? entry.name
          : `${entry.name} (${entry.vendor})`
      byRole.set(role, [...(byRole.get(role) ?? []), name])
    }
  }
  if (byRole.size === 0) return undefined

  const lines = [
    "次の Agent は役割マーカーを宣言している。担当表の該当する帯は、これらを優先して使う。同じ帯に複数あるときは依頼内容に近いものを選ぶ。"
  ]
  for (const role of sortRoleIds([...byRole.keys()])) {
    const names = byRole.get(role)
    if (names !== undefined) {
      lines.push(`- ${labelOf(role)}: ${names.join(" / ")}`)
    }
  }
  return lines.join("\n")
}
