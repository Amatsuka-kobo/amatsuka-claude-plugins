import fs from "node:fs"
import path from "node:path"
import { fileURLToPath } from "node:url"
import {
  type ComposeInput,
  compose,
  describeRoles,
  type RolesSummary
} from "./agents/compose"
import { loadFragments, type Vendor } from "./agents/fragments"
import { type RoleId, roleOrder } from "./agents/roles"

interface Options {
  vendor: Vendor
  name: string
  model: string
  roles: RoleId[]
  dir: string
  check: boolean
  write: boolean
  merge: boolean
  listRoles: boolean
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
  roles: RolesSummary
}

interface Document {
  order: string[]
  meta: Map<string, string>
  preamble: string
  sections: Map<string, string>
}

interface Discarded {
  frontmatterKeys: string[]
  preamble: boolean
  sections: string[]
}

function parseDocument(content: string): Document {
  const lines = content.split("\n")
  const startsWithFrontmatter = lines[0]?.trim() === "---"
  const close = startsWithFrontmatter ? lines.indexOf("---", 1) : -1
  const hasFrontmatter = startsWithFrontmatter && close !== -1
  const meta = new Map<string, string>()
  const order: string[] = []

  if (hasFrontmatter) {
    for (const line of lines.slice(1, close)) {
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

  for (const line of lines.slice(hasFrontmatter ? close + 1 : 0)) {
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

function composeInput(options: Options): ComposeInput {
  return {
    name: options.name,
    model: options.model,
    vendor: options.vendor,
    roleIds: options.roles,
    fragmentDirs: fragmentDirs(options.dir)
  }
}

function template(options: Options): string {
  return compose(composeInput(options))
}

function targetPath(options: Options): string {
  return path.join(options.dir, ".claude", "agents", `${options.name}.md`)
}

function compare(
  options: Options,
  rendered: string,
  existingRaw: string | undefined
): Diff {
  const file = targetPath(options)
  const relative = path.relative(options.dir, file).split(path.sep).join("/")
  const roles = describeRoles(composeInput(options))

  if (existingRaw === undefined) {
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
      },
      roles
    }
  }

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
    },
    roles
  }
}

function diff(options: Options): Diff {
  const rendered = template(options)
  const file = targetPath(options)
  const existingRaw = fs.existsSync(file)
    ? fs.readFileSync(file, "utf8")
    : undefined
  return compare(options, rendered, existingRaw)
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

  const missing: string[] = []
  for (const heading of keep.sections) {
    if (!existing.sections.has(heading)) missing.push(`section:${heading}`)
  }
  const existingTools = splitTools(existing.meta.get("tools"))
  for (const tool of keep.tools) {
    if (!existingTools.includes(tool)) missing.push(`tools:${tool}`)
  }
  for (const key of keep.keys) {
    if (!existing.meta.has(key)) missing.push(`key:${key}`)
  }
  if (missing.length > 0) {
    throw new Error(`keep: not found in existing file: ${missing.join(", ")}`)
  }

  // tools: テンプレートの並びを保ち、保持指定されたものを末尾へ足す。
  const tools = splitTools(merged.meta.get("tools"))
  for (const tool of existingTools) {
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

function automaticKeep(difference: Diff): string[] {
  return [
    ...difference.frontmatter.toolsOnlyInExisting.map(
      (tool) => `tools:${tool}`
    ),
    ...difference.frontmatter.keysOnlyInExisting.map((key) => `key:${key}`),
    ...difference.body.sectionsOnlyInExisting.map(
      (heading) => `section:${heading}`
    )
  ]
}

function unique(selectors: string[]): string[] {
  return [...new Set(selectors)]
}

function discarded(difference: Diff, keep: Keep): Discarded {
  if (!difference.exists) {
    return { frontmatterKeys: [], preamble: false, sections: [] }
  }

  return {
    frontmatterKeys: difference.frontmatter.changed
      .map((entry) => entry.key)
      .filter((key) => !keep.keys.has(key)),
    preamble: difference.preambleChanged && !keep.preamble,
    sections: difference.body.sectionsChanged.filter(
      (heading) => !keep.sections.has(heading)
    )
  }
}

function needsReview(selectors: string[]): string[] {
  return selectors.filter(
    (selector) =>
      selector.startsWith("tools:mcp__") || selector === "section:## ツール運用"
  )
}

function write(options: Options): unknown {
  const file = targetPath(options)
  const rendered = template(options)
  const exists = fs.existsSync(file)
  // 既存内容はここで一度だけ読み、自動 keep の抽出と merge の双方へ渡す。
  const existingRaw = exists ? fs.readFileSync(file, "utf8") : undefined
  const difference = compare(options, rendered, existingRaw)
  const selectors = unique([
    ...(exists && options.merge ? automaticKeep(difference) : []),
    ...options.keep
  ])
  const keep = parseKeep(selectors)
  const shouldMerge =
    existingRaw !== undefined && (options.merge || options.keep.length > 0)
  const content = shouldMerge ? merge(existingRaw, rendered, keep) : rendered
  const kept = shouldMerge ? selectors : []

  fs.mkdirSync(path.dirname(file), { recursive: true })
  fs.writeFileSync(file, content)

  return {
    ok: true,
    target: path.relative(options.dir, file).split(path.sep).join("/"),
    action: exists ? (options.merge ? "merged" : "overwritten") : "written",
    kept,
    keptNeedsReview: needsReview(kept),
    discarded: discarded(difference, shouldMerge ? keep : parseKeep([]))
  }
}

function listAvailableRoles(options: Options): unknown {
  const roles = [
    ...loadFragments(fragmentDirs(options.dir), options.vendor).values()
  ]
    .sort(
      (left, right) =>
        roleOrder(left.id) - roleOrder(right.id) ||
        left.id.localeCompare(right.id)
    )
    .map(({ id, label, kind, tools, source }) => ({
      id,
      label,
      kind,
      tools,
      source
    }))

  return { ok: true, roles }
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
    merge: false,
    listRoles: false,
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
        options.roles = [
          ...new Set(
            requireValue(value, "roles")
              .split(",")
              .map((role) => role.trim())
              .filter((role) => role !== "")
          )
        ] as RoleId[]
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
      case "--merge":
        options.merge = true
        break
      case "--list-roles":
        options.listRoles = true
        break
      case "--keep":
        options.keep.push(requireValue(value, "keep"))
        index += 1
        break
      default:
        throw new Error(`Unsupported option: ${arg}`)
    }
  }

  if (options.name !== "" && !/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(options.name)) {
    throw new Error("name: must be lowercase letters, digits and hyphens")
  }
  if (options.listRoles) return options
  if (options.name === "") throw new Error("name: is required")
  if (options.model === "") throw new Error("model: is required")
  if (options.roles.length === 0) throw new Error("roles: is required")
  if (options.merge && !options.write)
    throw new Error("merge: requires --write")
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
  if (options.listRoles) {
    respond(listAvailableRoles(options))
  } else if (options.write) {
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
