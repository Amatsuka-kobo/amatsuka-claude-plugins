import fs from "node:fs"
import path from "node:path"
import type { RoleKind } from "./roles"

export type Vendor = "gpt" | "grok" | "claude"

export interface Fragment {
  id: string
  label: string
  description: string
  tools: string[]
  kind: RoleKind
  sections: Map<string, string[]>
}

interface Parsed {
  meta: Record<string, string>
  sections: Map<string, string[]>
}

function parse(content: string): Parsed {
  const lines = content.split("\n")
  if (lines[0]?.trim() !== "---") throw new Error("Fragment has no frontmatter")
  const close = lines.indexOf("---", 1)
  if (close === -1) throw new Error("Fragment frontmatter is not closed")

  const meta: Record<string, string> = {}
  for (const line of lines.slice(1, close)) {
    const at = line.indexOf(":")
    if (at <= 0) continue
    meta[line.slice(0, at).trim()] = line.slice(at + 1).trim()
  }

  const sections = new Map<string, string[]>()
  let heading: string | undefined
  for (const line of lines.slice(close + 1)) {
    if (line.startsWith("## ")) {
      heading = line.trim()
      if (!sections.has(heading)) sections.set(heading, [])
      continue
    }
    if (heading === undefined) continue
    sections.get(heading)?.push(line)
  }

  for (const [key, body] of sections) {
    sections.set(key, trim(body))
  }
  return { meta, sections }
}

function trim(lines: string[]): string[] {
  let start = 0
  let end = lines.length
  while (start < end && lines[start]?.trim() === "") start += 1
  while (end > start && lines[end - 1]?.trim() === "") end -= 1
  return lines.slice(start, end)
}

function require(
  meta: Record<string, string>,
  key: string,
  file: string
): string {
  const value = meta[key]
  if (value === undefined || value === "") {
    throw new Error(`Fragment is missing "${key}": ${file}`)
  }
  return value
}

function readFragment(file: string): Fragment {
  const { meta, sections } = parse(fs.readFileSync(file, "utf8"))
  const kind = require(meta, "kind", file)
  if (kind !== "impl" && kind !== "readonly") {
    throw new Error(`Fragment "kind" must be impl or readonly: ${file}`)
  }
  return {
    id: require(meta, "id", file),
    label: require(meta, "label", file),
    description: require(meta, "description", file),
    tools: require(meta, "tools", file)
      .split(",")
      .map((tool) => tool.trim()),
    kind,
    sections
  }
}

function appendSections(base: Fragment, extra: Map<string, string[]>): void {
  for (const [heading, body] of extra) {
    const current = base.sections.get(heading)
    base.sections.set(
      heading,
      current === undefined ? body : [...current, ...body]
    )
  }
}

// dirs は探索順。後の要素が同じ役割 ID を持つとき、その断片で置き換える。
export function loadFragments(
  dirs: string[],
  vendor: Vendor
): Map<string, Fragment> {
  const fragments = new Map<string, Fragment>()

  for (const dir of dirs) {
    if (!fs.existsSync(dir)) continue
    const files = fs
      .readdirSync(dir)
      .filter((name) => name.endsWith(".md") && !name.startsWith("_"))
      .sort((left, right) => left.localeCompare(right))

    for (const name of files) {
      // <id>.<vendor>.md はベンダー別断片。ここでは読み飛ばす。
      if (name.split(".").length > 2) continue
      const fragment = readFragment(path.join(dir, name))
      fragments.set(fragment.id, fragment)
    }
  }

  // ベンダー別断片は、置き換え後の断片へ追記する。
  for (const dir of dirs) {
    if (!fs.existsSync(dir)) continue
    for (const name of fs.readdirSync(dir).sort()) {
      if (!name.endsWith(`.${vendor}.md`)) continue
      const { meta, sections } = parse(
        fs.readFileSync(path.join(dir, name), "utf8")
      )
      const target = fragments.get(meta.id ?? "")
      if (target !== undefined) appendSections(target, sections)
    }
  }

  return fragments
}

export function loadCommon(dirs: string[]): Map<string, string[]> {
  const sections = new Map<string, string[]>()
  for (const dir of dirs) {
    const file = path.join(dir, "_common.md")
    if (!fs.existsSync(file)) continue
    // 節単位で上書きする。後の dir が定義した節だけを差し替え、
    // 定義しなかった節は前の dir のものを残す。
    for (const [heading, body] of parse(fs.readFileSync(file, "utf8"))
      .sections) {
      sections.set(heading, body)
    }
  }
  if (sections.size === 0) throw new Error("_common.md not found")
  return sections
}
