import fs from "node:fs"
import os from "node:os"
import path from "node:path"
import { parseFrontmatter } from "./lib/frontmatter.js"
import { KNOWN_TOOLS } from "./lib/known-tools.js"

type Scope = "project" | "user" | "plugin"

interface CheckResult {
  path: string
  scope: Scope
  errors: string[]
  warnings: string[]
}

const KNOWN_FIELDS = new Set([
  "name",
  "description",
  "tools",
  "disallowedTools",
  "model",
  "permissionMode",
  "maxTurns",
  "skills",
  "mcpServers",
  "hooks",
  "memory",
  "background",
  "effort",
  "isolation",
  "color",
  "initialPrompt"
])

function usage(): void {
  console.error(
    "usage: node scripts/check-agent-definition.mjs <agent-definition.md> [--scope project|user|plugin]"
  )
}

function parseArgs(args: string[]): { file: string; scope?: Scope } | null {
  if (args.length === 0) return null

  const [file, ...options] = args
  let scope: Scope | undefined
  for (let index = 0; index < options.length; index += 1) {
    if (options[index] !== "--scope") return null
    const value = options[index + 1]
    if (value !== "project" && value !== "user" && value !== "plugin")
      return null
    scope = value
    index += 1
  }

  return { file, scope }
}

function inferScope(file: string): Scope {
  const normalized = path.resolve(file).split(path.sep).join("/")
  const userAgents = path.join(os.homedir(), ".claude", "agents")
  const normalizedUserAgents = userAgents.split(path.sep).join("/")

  if (normalized.includes("/plugins/") && normalized.includes("/agents/"))
    return "plugin"
  if (
    normalized === normalizedUserAgents ||
    normalized.startsWith(`${normalizedUserAgents}/`)
  )
    return "user"
  return "project"
}

function parseTools(value: string): string[] {
  const trimmed = value.trim()
  if (trimmed.startsWith("[") && trimmed.endsWith("]")) {
    return trimmed
      .slice(1, -1)
      .split(",")
      .map((tool) => tool.trim().replace(/^(?:"|')|(?:"|')$/g, ""))
      .filter(Boolean)
  }

  return trimmed
    .split(",")
    .map((tool) => tool.trim())
    .filter(Boolean)
}

function isKnownTool(tool: string): boolean {
  return KNOWN_TOOLS.includes(tool) || tool === "*" || tool.startsWith("mcp__")
}

function checkDefinition(
  file: string,
  scope: Scope,
  source: string
): CheckResult {
  const { fields, body, errors } = parseFrontmatter(source)
  const warnings: string[] = []

  if (!fields.name) errors.push("name が未指定")
  if (!fields.description) errors.push("description が未指定")

  if (fields.name && !/^[a-z0-9-]+$/.test(fields.name))
    errors.push("name は英小文字・数字・ハイフンのみで指定する")

  const filename = path.basename(file, path.extname(file))
  if (fields.name && fields.name !== filename)
    warnings.push("name がファイル名と一致しない")

  if ("model" in fields && fields.model.trim() === "")
    errors.push("model が空文字列")

  if (fields.tools) {
    for (const tool of parseTools(fields.tools)) {
      if (!isKnownTool(tool)) warnings.push(`未知のツール名: ${tool}`)
    }
  }

  if (scope === "plugin") {
    if ("hooks" in fields) errors.push("plugin 配下では hooks を使えない")
    if ("mcpServers" in fields)
      errors.push("plugin 配下では mcpServers を使えない")
    if ("permissionMode" in fields)
      errors.push("plugin 配下では permissionMode を使えない")
    if ("isolation" in fields && fields.isolation !== "worktree")
      errors.push("plugin 配下の isolation は worktree のみ指定できる")
  }

  if (!body) errors.push("本文が空")
  if (!fields.color) warnings.push("color が未指定")

  for (const key of Object.keys(fields)) {
    if (!KNOWN_FIELDS.has(key))
      warnings.push(`未知の frontmatter フィールド: ${key}`)
  }

  return { path: file, scope, errors, warnings }
}

const args = parseArgs(process.argv.slice(2))
if (!args) {
  usage()
  process.exitCode = 2
} else {
  const scope = args.scope ?? inferScope(args.file)
  let source: string
  try {
    source = fs.readFileSync(args.file, "utf8")
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    console.error(`定義ファイルを読めない: ${args.file}: ${message}`)
    process.exitCode = 2
    process.exit()
  }

  const result = checkDefinition(args.file, scope, source)
  console.log(JSON.stringify(result, null, 2))
  process.exitCode = result.errors.length === 0 ? 0 : 1
}
