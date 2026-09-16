import fs from "node:fs"
import path from "node:path"
import { bodyHash } from "./hash"
import type { RoleKind } from "./roles"

export type Vendor = "gpt" | "grok" | "gemini" | "claude" | "none"

export interface FragmentDir {
  path: string
  source: "plugin" | "project"
}

export interface Fragment {
  id: string
  label: string
  description: string
  defaultName: string | undefined
  tools: string[]
  kind: RoleKind
  source: "plugin" | "project"
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

function requireMeta(
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

function readFragment(file: string, source: Fragment["source"]): Fragment {
  const { meta, sections } = parse(fs.readFileSync(file, "utf8"))
  const kind = requireMeta(meta, "kind", file)
  if (kind !== "impl" && kind !== "readonly") {
    throw new Error(`Fragment "kind" must be impl or readonly: ${file}`)
  }
  return {
    id: requireMeta(meta, "id", file),
    label: requireMeta(meta, "label", file),
    description: requireMeta(meta, "description", file),
    defaultName: meta["default-name"],
    tools: requireMeta(meta, "tools", file)
      .split(",")
      .map((tool) => tool.trim()),
    kind,
    source,
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

export function loadFragments(
  dirs: FragmentDir[],
  vendor?: Vendor
): Map<string, Fragment> {
  const fragments = new Map<string, Fragment>()

  for (const dir of dirs) {
    if (!fs.existsSync(dir.path)) continue
    const files = fs
      .readdirSync(dir.path)
      .filter((name) => name.endsWith(".md") && !name.startsWith("_"))
      .sort((left, right) => left.localeCompare(right))

    for (const name of files) {
      // <id>.<vendor>.md はベンダー別断片。ここでは読み飛ばす。
      if (name.split(".").length > 2) continue
      const fragment = readFragment(path.join(dir.path, name), dir.source)
      fragments.set(fragment.id, fragment)
    }
  }

  if (vendor !== undefined) {
    // ベンダー別断片は探索順で後勝ちにする。追記方式のままだと、言語別に
    // 用意した同じ役割の断片が複数ディレクトリから重ねて積まれる。
    const overlays = new Map<string, Map<string, string[]>>()
    for (const dir of dirs) {
      if (!fs.existsSync(dir.path)) continue
      for (const name of fs
        .readdirSync(dir.path)
        .sort((left, right) => left.localeCompare(right))) {
        if (!name.endsWith(`.${vendor}.md`)) continue
        const { meta, sections } = parse(
          fs.readFileSync(path.join(dir.path, name), "utf8")
        )
        const id = meta.id
        if (id === undefined || id === "") continue
        overlays.set(id, sections)
      }
    }
    for (const [id, sections] of overlays) {
      const target = fragments.get(id)
      if (target !== undefined) appendSections(target, sections)
    }
  }

  return fragments
}

export function loadCommon(dirs: FragmentDir[]): Map<string, string[]> {
  const sections = new Map<string, string[]>()
  for (const dir of dirs) {
    const file = path.join(dir.path, "_common.md")
    if (!fs.existsSync(file)) continue
    for (const [heading, body] of parse(fs.readFileSync(file, "utf8"))
      .sections) {
      sections.set(heading, body)
    }
  }
  if (sections.size === 0) throw new Error("_common.md not found")
  return sections
}

// 探索順は後勝ち。同梱 → プロジェクト翻訳 → プロジェクト独自。
// lang が ja / en 以外のときは同梱として en を使い、翻訳断片で置き換える。
export function fragmentDirsFor(
  pluginRoot: string,
  projectDir: string,
  lang: string
): FragmentDir[] {
  const bundled = lang === "ja" || lang === "en" ? lang : "en"
  const dirs: FragmentDir[] = [
    {
      path: path.join(pluginRoot, "assets", "roles", bundled),
      source: "plugin"
    }
  ]
  const projectRoles = path.join(projectDir, ".claude", "agent-policy", "roles")
  if (bundled !== lang) {
    dirs.push({ path: path.join(projectRoles, lang), source: "project" })
  }
  dirs.push({ path: projectRoles, source: "project" })
  return dirs
}

export interface StaleFragment {
  id: string
  expected: string
  actual: string
}

export interface FragmentStatus {
  lang: string
  sourceDir: string
  targetDir: string | null
  missing: string[]
  stale: StaleFragment[]
  ready: string[]
}

function bundledDir(pluginRoot: string, lang: string): string {
  const bundled = lang === "ja" || lang === "en" ? lang : "en"
  return path.join(pluginRoot, "assets", "roles", bundled)
}

function translationDir(projectDir: string, lang: string): string {
  return path.join(projectDir, ".claude", "agent-policy", "roles", lang)
}

// 同梱断片のファイル名一覧。_common.md とベンダー別断片も対象に含める。
function bundledFiles(dir: string): string[] {
  return fs
    .readdirSync(dir)
    .filter((name) => name.endsWith(".md"))
    .sort((left, right) => left.localeCompare(right))
}

export function checkFragments(
  pluginRoot: string,
  projectDir: string,
  lang: string
): FragmentStatus {
  const sourceDir = bundledDir(pluginRoot, lang)
  if (lang === "ja" || lang === "en") {
    return {
      lang,
      sourceDir,
      targetDir: null,
      missing: [],
      stale: [],
      ready: []
    }
  }

  const targetDir = translationDir(projectDir, lang)
  const missing: string[] = []
  const stale: StaleFragment[] = []
  const ready: string[] = []

  for (const name of bundledFiles(sourceDir)) {
    const id = name.replace(/\.md$/, "")
    const target = path.join(targetDir, name)
    if (!fs.existsSync(target)) {
      missing.push(id)
      continue
    }
    const expected = bodyHash(
      fs.readFileSync(path.join(sourceDir, name), "utf8")
    )
    const actual = parse(fs.readFileSync(target, "utf8")).meta["source-hash"]
    if (actual !== expected) {
      stale.push({ id, expected, actual: actual ?? "" })
      continue
    }
    ready.push(id)
  }

  return { lang, sourceDir, targetDir, missing, stale, ready }
}

// 同梱英語断片を翻訳先へコピーし、source-lang と source-hash を書き込む。
// 中身の翻訳はスキルが Edit で行う。source-hash が一致するファイルは
// 最新の翻訳とみなして上書きしない。ずれているファイルは英語ソースで
// 上書きするため、既存の訳が失われる。スキル側で確認させる。
export function scaffoldFragments(
  pluginRoot: string,
  projectDir: string,
  lang: string
): string[] {
  if (lang === "ja" || lang === "en") return []

  const sourceDir = bundledDir(pluginRoot, lang)
  const targetDir = translationDir(projectDir, lang)
  fs.mkdirSync(targetDir, { recursive: true })
  const written: string[] = []

  for (const name of bundledFiles(sourceDir)) {
    const target = path.join(targetDir, name)
    const source = fs.readFileSync(path.join(sourceDir, name), "utf8")
    const hash = bodyHash(source)
    const current = fs.existsSync(target)
      ? parse(fs.readFileSync(target, "utf8")).meta["source-hash"]
      : undefined
    if (current === hash) continue

    const lines = source.split("\n")
    const close = lines.indexOf("---", 1)
    const injected = [
      ...lines.slice(0, close),
      "source-lang: en",
      `source-hash: ${hash}`,
      ...lines.slice(close)
    ]
    fs.writeFileSync(target, injected.join("\n"))
    written.push(target)
  }

  return written
}
