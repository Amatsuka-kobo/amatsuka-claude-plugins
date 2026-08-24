import fs from "node:fs"
import path from "node:path"
import { fileURLToPath } from "node:url"
import { compose } from "./agents/compose"
import type { Vendor } from "./agents/fragments"
import type { RoleId } from "./agents/roles"

interface Options {
  vendor: Vendor
  name: string
  model: string
  roles: RoleId[]
  dir: string
  check: boolean
  write: boolean
  keep: string[]
}

interface Diff {
  ok: true
  target: string
  exists: boolean
  identical: boolean
  frontmatter: {
    changed: { key: string; existing: string; template: string }[]
    toolsOnlyInExisting: string[]
    toolsOnlyInTemplate: string[]
    keysOnlyInExisting: string[]
  }
  preambleChanged: boolean
  body: {
    sectionsOnlyInExisting: string[]
    sectionsOnlyInTemplate: string[]
    sectionsChanged: string[]
  }
}

interface Document {
  order: string[]
  meta: Map<string, string>
  preamble: string
  sections: Map<string, string>
}

function parseDocument(content: string): Document {
  const lines = content.split("\n")
  const close = lines.indexOf("---", 1)
  const meta = new Map<string, string>()
  const order: string[] = []

  for (const line of lines.slice(1, close)) {
    const at = line.indexOf(": ")
    if (at <= 0) continue
    const key = line.slice(0, at)
    meta.set(key, line.slice(at + 2))
    order.push(key)
  }

  const preamble: string[] = []
  const sections = new Map<string, string>()
  let heading: string | undefined
  let buffer: string[] = []

  for (const line of lines.slice(close + 1)) {
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

function splitTools(value: string | undefined): string[] {
  if (value === undefined) return []
  return value
    .split(",")
    .map((tool) => tool.trim())
    .filter((tool) => tool !== "")
}

function only(left: string[], right: string[]): string[] {
  return left.filter((item) => !right.includes(item))
}

function pluginRoot(): string {
  return (
    process.env.CLAUDE_PLUGIN_ROOT ??
    path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..")
  )
}

function fragmentDirs(projectDir: string): string[] {
  return [
    path.join(pluginRoot(), "assets", "roles"),
    path.join(projectDir, ".claude", "agent-policy", "roles")
  ]
}

function template(options: Options): string {
  return compose({
    name: options.name,
    model: options.model,
    vendor: options.vendor,
    roleIds: options.roles,
    fragmentDirs: fragmentDirs(options.dir)
  })
}

function targetPath(options: Options): string {
  return path.join(options.dir, ".claude", "agents", `${options.name}.md`)
}

function diff(options: Options): Diff {
  const rendered = template(options)
  const file = targetPath(options)
  const relative = path.relative(options.dir, file).split(path.sep).join("/")

  if (!fs.existsSync(file)) {
    return {
      ok: true,
      target: relative,
      exists: false,
      identical: false,
      frontmatter: {
        changed: [],
        toolsOnlyInExisting: [],
        toolsOnlyInTemplate: [],
        keysOnlyInExisting: []
      },
      preambleChanged: false,
      body: {
        sectionsOnlyInExisting: [],
        sectionsOnlyInTemplate: [],
        sectionsChanged: []
      }
    }
  }

  const existingRaw = fs.readFileSync(file, "utf8")
  const existing = parseDocument(existingRaw)
  const expected = parseDocument(rendered)

  const existingTools = splitTools(existing.meta.get("tools"))
  const expectedTools = splitTools(expected.meta.get("tools"))

  const changed: Diff["frontmatter"]["changed"] = []
  for (const [key, value] of expected.meta) {
    if (key === "tools") continue
    const current = existing.meta.get(key)
    if (current !== undefined && current !== value) {
      changed.push({ key, existing: current, template: value })
    }
  }

  const sectionsChanged: string[] = []
  for (const [heading, body] of expected.sections) {
    const current = existing.sections.get(heading)
    if (current !== undefined && current !== body) sectionsChanged.push(heading)
  }

  return {
    ok: true,
    target: relative,
    exists: true,
    identical: existingRaw === rendered,
    frontmatter: {
      changed,
      toolsOnlyInExisting: only(existingTools, expectedTools),
      toolsOnlyInTemplate: only(expectedTools, existingTools),
      keysOnlyInExisting: only(
        [...existing.meta.keys()],
        [...expected.meta.keys()]
      )
    },
    preambleChanged: existing.preamble !== expected.preamble,
    body: {
      sectionsOnlyInExisting: only(
        [...existing.sections.keys()],
        [...expected.sections.keys()]
      ),
      sectionsOnlyInTemplate: only(
        [...expected.sections.keys()],
        [...existing.sections.keys()]
      ),
      sectionsChanged
    }
  }
}

interface Keep {
  tools: Set<string>
  keys: Set<string>
  sections: Set<string>
  preamble: boolean
}

function parseKeep(selectors: string[]): Keep {
  const keep: Keep = {
    tools: new Set(),
    keys: new Set(),
    sections: new Set(),
    preamble: false
  }

  for (const selector of selectors) {
    if (selector === "preamble") {
      keep.preamble = true
      continue
    }
    const at = selector.indexOf(":")
    const kind = at === -1 ? selector : selector.slice(0, at)
    const value = at === -1 ? "" : selector.slice(at + 1)
    if (value === "")
      throw new Error(`keep: must be <kind>:<value>: ${selector}`)

    switch (kind) {
      case "tools":
        keep.tools.add(value)
        break
      case "key":
        keep.keys.add(value)
        break
      case "section":
        keep.sections.add(value)
        break
      default:
        throw new Error(`keep: unknown selector kind: ${selector}`)
    }
  }

  return keep
}

function render(document: Document): string {
  const head = ["---"]
  for (const key of document.order) {
    head.push(`${key}: ${document.meta.get(key) ?? ""}`)
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

function merge(existingRaw: string, renderedRaw: string, keep: Keep): string {
  const existing = parseDocument(existingRaw)
  const merged = parseDocument(renderedRaw)

  // tools: テンプレートの並びを保ち、保持指定されたものを末尾へ足す。
  const tools = splitTools(merged.meta.get("tools"))
  for (const tool of splitTools(existing.meta.get("tools"))) {
    if (keep.tools.has(tool) && !tools.includes(tool)) tools.push(tool)
  }
  merged.meta.set("tools", tools.join(", "))

  // frontmatter キー: 保持指定されたものは既存の値を採る。
  for (const key of keep.keys) {
    const value = existing.meta.get(key)
    if (value === undefined) continue
    if (!merged.order.includes(key)) merged.order.push(key)
    merged.meta.set(key, value)
  }

  if (keep.preamble && existing.preamble !== "") {
    merged.preamble = existing.preamble
  }

  // 節: 保持指定されたものは既存の内容を採る。テンプレートに無い節は末尾へ。
  for (const heading of keep.sections) {
    const content = existing.sections.get(heading)
    if (content === undefined) continue
    merged.sections.set(heading, content)
  }

  return render(merged)
}

function write(options: Options): unknown {
  const file = targetPath(options)
  const rendered = template(options)
  const keep = parseKeep(options.keep)
  const exists = fs.existsSync(file)

  const content =
    exists && options.keep.length > 0
      ? merge(fs.readFileSync(file, "utf8"), rendered, keep)
      : rendered

  fs.mkdirSync(path.dirname(file), { recursive: true })
  fs.writeFileSync(file, content)

  return {
    ok: true,
    target: path.relative(options.dir, file).split(path.sep).join("/"),
    action: exists ? "overwritten" : "written",
    kept: options.keep
  }
}

function parseArgs(argv: string[]): Options {
  const options: Options = {
    vendor: "gpt",
    name: "",
    model: "",
    roles: [],
    dir: process.cwd(),
    check: false,
    write: false,
    keep: []
  }

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index]
    const value = argv[index + 1]
    switch (arg) {
      case "--vendor":
        if (value !== "gpt" && value !== "grok" && value !== "claude") {
          throw new Error("vendor: must be gpt, grok or claude")
        }
        options.vendor = value
        index += 1
        break
      case "--name":
        options.name = requireValue(value, "name")
        index += 1
        break
      case "--model":
        options.model = requireValue(value, "model")
        index += 1
        break
      case "--roles":
        options.roles = requireValue(value, "roles")
          .split(",")
          .map((role) => role.trim())
          .filter((role) => role !== "") as RoleId[]
        index += 1
        break
      case "--dir":
        options.dir = path.resolve(requireValue(value, "dir"))
        index += 1
        break
      case "--check":
        options.check = true
        break
      case "--write":
        options.write = true
        break
      case "--keep":
        options.keep.push(requireValue(value, "keep"))
        index += 1
        break
      default:
        throw new Error(`Unsupported option: ${arg}`)
    }
  }

  if (options.name === "") throw new Error("name: is required")
  if (options.model === "") throw new Error("model: is required")
  if (options.roles.length === 0) throw new Error("roles: is required")
  return options
}

function requireValue(value: string | undefined, field: string): string {
  if (value === undefined || value.startsWith("--")) {
    throw new Error(`${field}: is required`)
  }
  return value
}

function respond(value: unknown): void {
  process.stdout.write(`${JSON.stringify(value)}\n`)
}

try {
  const options = parseArgs(process.argv.slice(2))
  if (options.write) {
    respond(write(options))
  } else {
    respond(diff(options))
  }
} catch (error) {
  respond({
    ok: false,
    error: error instanceof Error ? error.message : "Unexpected error"
  })
  process.exitCode = 1
}
