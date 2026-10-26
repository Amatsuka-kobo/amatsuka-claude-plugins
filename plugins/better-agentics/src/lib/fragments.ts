import fs from "node:fs"
import path from "node:path"
import { fileURLToPath } from "node:url"
import { bodyHash } from "./hash"
import { type RoleId, type RoleKind, roleById } from "./roles"

export interface Fragment {
  id: RoleId
  label: string
  description: string
  defaultName: string
  tools: string[]
  kind: RoleKind
  /** キーは見出し行、値は trim 済みの行 */
  sections: Map<string, string[]>
}

export interface Vocabulary {
  bodyOrder: string[]
}

const JA: Vocabulary = {
  bodyOrder: [
    "## When to invoke",
    "## Core Responsibilities",
    "## 作業手順",
    "## 制約",
    "## Output Format"
  ]
}

const EN: Vocabulary = {
  bodyOrder: [
    "## When to invoke",
    "## Core Responsibilities",
    "## Procedure",
    "## Constraints",
    "## Output Format"
  ]
}

const WHEN_TO_INVOKE = "## When to invoke"

// ja 以外は en の語彙を使う。翻訳断片の見出しも英語のまま保つ。
export function vocabularyFor(lang: string): Vocabulary {
  return lang === "ja" ? JA : EN
}

// ソースの src/lib/・src/hooks/ からも、バンドル後の scripts/ からも同じルートを返すよう、
// .claude-plugin/plugin.json を持つディレクトリまで親をたどる。
export function pluginRoot(): string {
  const fromEnv = process.env.CLAUDE_PLUGIN_ROOT
  if (fromEnv !== undefined && fromEnv !== "") return fromEnv
  let dir = path.dirname(fileURLToPath(import.meta.url))
  while (!fs.existsSync(path.join(dir, ".claude-plugin", "plugin.json"))) {
    const parent = path.dirname(dir)
    if (parent === dir) throw new Error("plugin root not found")
    dir = parent
  }
  return dir
}

interface Parsed {
  meta: Record<string, string>
  sections: Map<string, string[]>
}

function trim(lines: string[]): string[] {
  let start = 0
  let end = lines.length
  while (start < end && lines[start]?.trim() === "") start += 1
  while (end > start && lines[end - 1]?.trim() === "") end -= 1
  return lines.slice(start, end)
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
    if (heading !== undefined) sections.get(heading)?.push(line)
  }
  for (const [key, body] of sections) sections.set(key, trim(body))
  return { meta, sections }
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

function readFragment(file: string): Fragment {
  const { meta, sections } = parse(fs.readFileSync(file, "utf8"))
  const id = requireMeta(meta, "id", file)
  const role = roleById(id)
  if (role === undefined) throw new Error(`Unknown role id: ${id} (${file})`)
  const kind = requireMeta(meta, "kind", file)
  if (kind !== "impl" && kind !== "readonly") {
    throw new Error(`Fragment "kind" must be impl or readonly: ${file}`)
  }
  return {
    id: role.id,
    label: requireMeta(meta, "label", file),
    description: requireMeta(meta, "description", file),
    defaultName: requireMeta(meta, "default-name", file),
    tools: requireMeta(meta, "tools", file)
      .split(",")
      .map((tool) => tool.trim())
      .filter((tool) => tool !== ""),
    kind,
    sections
  }
}

// lang は翻訳断片の置き場のパスに使うため、言語コードの形だけを受け付ける。
export function assertLang(lang: string): void {
  if (!/^[A-Za-z]{2,3}(?:-[A-Za-z0-9]{2,8})*$/.test(lang)) {
    throw new Error(`lang: invalid language code: "${lang}"`)
  }
}

function bundledLang(lang: string): "ja" | "en" {
  return lang === "ja" ? "ja" : "en"
}

function bundledDir(root: string, lang: string): string {
  return path.join(root, "assets", "roles", bundledLang(lang))
}

function translationDir(projectDir: string, lang: string): string {
  assertLang(lang)
  return path.join(projectDir, ".claude", "better-agentics", "roles", lang)
}

function needsTranslation(lang: string): boolean {
  return lang !== "ja" && lang !== "en"
}

function roleFiles(dir: string): string[] {
  return fs
    .readdirSync(dir)
    .filter((name) => name.endsWith(".md") && !name.startsWith("_"))
    .sort((left, right) => left.localeCompare(right))
}

// 探索の層は同梱と翻訳の 2 つ。翻訳で置き換えても When to invoke は同梱 en の値を残し、
// 委譲先の選択基準が翻訳で変わらないようにする。
export function loadFragments(
  root: string,
  projectDir: string,
  lang: string
): Map<RoleId, Fragment> {
  assertLang(lang)
  const dir = bundledDir(root, lang)
  const fragments = new Map<RoleId, Fragment>()
  for (const name of roleFiles(dir)) {
    const fragment = readFragment(path.join(dir, name))
    fragments.set(fragment.id, fragment)
  }
  if (!needsTranslation(lang)) return fragments

  const target = translationDir(projectDir, lang)
  if (!fs.existsSync(target)) return fragments
  for (const name of roleFiles(target)) {
    const translated = readFragment(path.join(target, name))
    const bundled = fragments.get(translated.id)
    const when = bundled?.sections.get(WHEN_TO_INVOKE)
    if (when !== undefined) translated.sections.set(WHEN_TO_INVOKE, when)
    fragments.set(translated.id, translated)
  }
  return fragments
}

export function loadPreamble(
  root: string,
  projectDir: string,
  lang: string
): string[] {
  const candidates = [path.join(bundledDir(root, lang), "_common.md")]
  if (needsTranslation(lang)) {
    candidates.unshift(
      path.join(translationDir(projectDir, lang), "_common.md")
    )
  }
  for (const file of candidates) {
    if (!fs.existsSync(file)) continue
    const preamble = parse(fs.readFileSync(file, "utf8")).sections.get(
      "## Preamble"
    )
    if (preamble !== undefined) return preamble
  }
  throw new Error("_common.md not found")
}

export interface FragmentStatus {
  lang: string
  targetDir: string | null
  missing: string[]
  stale: string[]
  ready: string[]
}

// _common.md も翻訳の対象に含める。
function bundledFiles(dir: string): string[] {
  return fs
    .readdirSync(dir)
    .filter((name) => name.endsWith(".md"))
    .sort((left, right) => left.localeCompare(right))
}

export function checkFragments(
  root: string,
  projectDir: string,
  lang: string
): FragmentStatus {
  assertLang(lang)
  if (!needsTranslation(lang)) {
    return { lang, targetDir: null, missing: [], stale: [], ready: [] }
  }
  const sourceDir = bundledDir(root, lang)
  const targetDir = translationDir(projectDir, lang)
  const status: FragmentStatus = {
    lang,
    targetDir,
    missing: [],
    stale: [],
    ready: []
  }
  for (const name of bundledFiles(sourceDir)) {
    const id = name.replace(/\.md$/, "")
    const target = path.join(targetDir, name)
    if (!fs.existsSync(target)) {
      status.missing.push(id)
      continue
    }
    const expected = bodyHash(
      fs.readFileSync(path.join(sourceDir, name), "utf8")
    )
    const actual = parse(fs.readFileSync(target, "utf8")).meta["source-hash"]
    if (actual === expected) status.ready.push(id)
    else status.stale.push(id)
  }
  return status
}

// source-hash が一致するファイルは最新の翻訳とみなして上書きしない。
// 一致しないファイルは英語で上書きするため、既存の訳はスキル側で退避させる。
export function scaffoldFragments(
  root: string,
  projectDir: string,
  lang: string
): string[] {
  assertLang(lang)
  if (!needsTranslation(lang)) return []
  const sourceDir = bundledDir(root, lang)
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
