#!/usr/bin/env node
// better-agentics:setup の CLI。.claude/agents/ の定義の点検・生成・再生成と、翻訳断片の準備を担う。
// 応答は JSON の 1 行で、失敗は { ok: false, error } と終了コード 1 で返す。

import fs from "node:fs"
import path from "node:path"
import {
  type Definition,
  inspect,
  keyLineAmbiguous,
  keyLinesOf,
  scanDefinitions
} from "./lib/agents"
import { ROLE_KEY } from "./lib/compose"
import {
  assertLang,
  checkFragments,
  loadFragments,
  pluginRoot,
  scaffoldFragments
} from "./lib/fragments"
import { listMcpServers } from "./lib/mcp"
import { ROLES, roleById } from "./lib/roles"

export interface Options {
  command:
    | "list-coverage"
    | "check-fragments"
    | "scaffold-fragments"
    | "list-mcp"
    | "prune-tools"
    | "rewrite-roles"
    | "check"
    | "write"
  dir: string
  lang: string
  name: string
  role: string
  model: string
  /** undefined は省略。"none" は effort を書かない指定 */
  effort: string | undefined
  /** undefined は省略(既存を引き継ぐ) */
  mcpServers: string[] | undefined
  /** undefined は省略(既存を引き継ぐ) */
  mcpDeny: string[] | undefined
  keep: string[]
  tools: string[]
  /** --rewrite-roles の値。"" はマーカー行を消す */
  roles: string | undefined
}

const NAME_PATTERN = /^[a-z0-9]+(?:-[a-z0-9]+)*$/

const COMMANDS: Record<string, Options["command"]> = {
  "--list-coverage": "list-coverage",
  "--check-fragments": "check-fragments",
  "--scaffold-fragments": "scaffold-fragments",
  "--list-mcp": "list-mcp",
  "--prune-tools": "prune-tools",
  "--rewrite-roles": "rewrite-roles",
  "--check": "check",
  "--write": "write"
}

export function splitList(value: string): string[] {
  return [
    ...new Set(
      value
        .split(",")
        .map((entry) => entry.trim())
        .filter((entry) => entry !== "")
    )
  ]
}

function requireValue(value: string | undefined, field: string): string {
  if (value === undefined || value.startsWith("--")) {
    throw new Error(`${field}: is required`)
  }
  return value
}

function parseArgs(argv: string[]): Options {
  const options: Options = {
    command: "list-coverage",
    dir: process.cwd(),
    lang: "ja",
    name: "",
    role: "",
    model: "",
    effort: undefined,
    mcpServers: undefined,
    mcpDeny: undefined,
    keep: [],
    tools: [],
    roles: undefined
  }
  let command: Options["command"] | undefined

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index] ?? ""
    const value = argv[index + 1]
    const known = COMMANDS[arg]
    if (known !== undefined) {
      if (command !== undefined)
        throw new Error(`${arg}: only one command is allowed`)
      command = known
      continue
    }
    switch (arg) {
      case "--dir":
        options.dir = path.resolve(requireValue(value, "dir"))
        break
      case "--lang":
        options.lang = requireValue(value, "lang")
        break
      case "--name":
        options.name = requireValue(value, "name")
        break
      case "--role":
        options.role = requireValue(value, "role")
        break
      case "--model":
        options.model = requireValue(value, "model")
        break
      case "--effort":
        options.effort = requireValue(value, "effort")
        break
      case "--mcp-servers":
        options.mcpServers = splitList(requireValue(value, "mcp-servers"))
        break
      case "--mcp-deny":
        options.mcpDeny = splitList(requireValue(value, "mcp-deny"))
        break
      case "--keep":
        options.keep = splitList(requireValue(value, "keep"))
        break
      case "--tools":
        options.tools = splitList(requireValue(value, "tools"))
        break
      case "--roles":
        options.roles = requireValue(value, "roles").trim()
        break
      default:
        throw new Error(`Unsupported option: ${arg}`)
    }
    index += 1
  }

  if (command === undefined) throw new Error("command: is required")
  options.command = command
  assertLang(options.lang)
  // --name は作成先のパスに使うため、.claude/agents/ の外を指せない形だけを受け付ける。
  if (options.name !== "" && !NAME_PATTERN.test(options.name)) {
    throw new Error("name: must be lowercase letters, digits and hyphens")
  }
  if (
    ["prune-tools", "rewrite-roles", "check", "write"].includes(command) &&
    options.name === ""
  ) {
    throw new Error("name: is required")
  }
  if (command === "prune-tools" && options.tools.length === 0) {
    throw new Error("tools: is required")
  }
  if (command === "rewrite-roles" && options.roles === undefined) {
    throw new Error("roles: is required")
  }
  return options
}

function relative(options: Options, file: string): string {
  return path.relative(options.dir, file).split(path.sep).join("/")
}

export function definitionPath(options: Options): string {
  return path.join(options.dir, ".claude", "agents", `${options.name}.md`)
}

function disallowedToolsOf(
  entry: Definition,
  allowed: string[] | undefined
): string[] {
  if (allowed === undefined) return []
  if (entry.toolsFormat === "none") return ["*"]
  return (entry.tools ?? []).filter(
    (tool) => !tool.startsWith("mcp__") && !allowed.includes(tool)
  )
}

function listCoverage(options: Options): unknown {
  const fragments = loadFragments(pluginRoot(), options.dir, options.lang)
  const definitions = scanDefinitions(options.dir)
  const { duplicates, unknownRoles } = inspect(definitions)

  const roles = ROLES.map((role) => {
    const fragment = fragments.get(role.id)
    return {
      id: role.id,
      label: fragment?.label ?? role.label,
      kind: role.kind,
      reason: role.reason,
      model: role.model,
      effort: role.effort,
      defaultName: fragment?.defaultName ?? "",
      coveredBy: definitions
        .filter((entry) => entry.role === role.id)
        .map((entry) => entry.file)
    }
  })

  return {
    ok: true,
    roles,
    uncovered: roles
      .filter((role) => role.coveredBy.length === 0)
      .map((role) => role.id),
    definitions: definitions.map((entry) => {
      const role = roleById(entry.role)
      return {
        file: entry.file,
        name: entry.name,
        role: entry.role,
        model: entry.model ?? null,
        effort: entry.effort ?? null,
        known: role !== undefined,
        disallowedTools: disallowedToolsOf(
          entry,
          role === undefined ? undefined : fragments.get(role.id)?.tools
        ),
        toolsFormat: entry.toolsFormat
      }
    }),
    duplicates: duplicates.map((entry) => ({
      role: entry.role,
      files: definitions
        .filter((definition) => definition.role === entry.role)
        .map((definition) => definition.file)
    })),
    unknownRoles: unknownRoles.map((entry) => ({
      file: entry.file,
      role: entry.role
    }))
  }
}

interface DefinitionLines {
  file: string
  target: string
  lines: string[]
  close: number
}

// 既存定義の 1 行だけを文字列として差し替えるための読み込み。
// parseDocument と render を通すと空行・コメント・block 配列が落ちるため使わない。
function readDefinition(options: Options): DefinitionLines {
  const file = definitionPath(options)
  const target = relative(options, file)
  if (!fs.existsSync(file)) throw new Error(`target: ${target} does not exist`)
  const lines = fs.readFileSync(file, "utf8").split("\n")
  const close = lines[0]?.trim() === "---" ? lines.indexOf("---", 1) : -1
  if (close === -1) throw new Error(`target: ${target} has no frontmatter`)
  return { file, target, lines, close }
}

function keyLineIndex(definition: DefinitionLines, key: string): number {
  if (keyLineAmbiguous(definition.lines, definition.close, key)) {
    throw new Error(
      `${key}: the ${key} line of ${definition.target} is not a single unindented line`
    )
  }
  return keyLinesOf(definition.lines, definition.close, key)[0] ?? -1
}

function pruneTools(options: Options): unknown {
  const definition = readDefinition(options)
  const index = keyLineIndex(definition, "tools")
  if (index === -1)
    throw new Error(`tools: ${definition.target} has no tools line`)
  const line = definition.lines[index] ?? ""
  const value = line.slice(line.indexOf(":") + 1).trim()
  if (value === "" || /^[[{|>]/.test(value) || /["'()#]/.test(value)) {
    throw new Error(
      `tools: ${definition.target} uses an unsupported tools format; only a single comma-separated line is rewritten`
    )
  }
  const current = splitList(value)
  const warnings = options.tools
    .filter((tool) => !current.includes(tool))
    .map((tool) => `tools: ${tool} is not in the tools line`)
  const remaining = current.filter((tool) => !options.tools.includes(tool))
  if (remaining.length === current.length) {
    return {
      ok: true,
      target: definition.target,
      changed: false,
      warnings,
      toolsBefore: current,
      toolsAfter: current
    }
  }
  // 空の tools は全ツールの継承と区別できないため、すべて外れる指定は拒む。
  if (remaining.length === 0) {
    throw new Error(
      `tools: every tool of ${definition.target} would be removed`
    )
  }
  definition.lines[index] = `tools: ${remaining.join(", ")}`
  fs.writeFileSync(definition.file, definition.lines.join("\n"))
  return {
    ok: true,
    target: definition.target,
    changed: true,
    warnings,
    toolsBefore: current,
    toolsAfter: remaining
  }
}

function rewriteRoles(options: Options): unknown {
  const definition = readDefinition(options)
  const roles = options.roles ?? ""
  if (roles !== "" && roleById(roles) === undefined) {
    throw new Error(`roles: ${roles} is not a role id`)
  }
  const index = keyLineIndex(definition, ROLE_KEY)
  if (index === -1) {
    throw new Error(`roles: ${definition.target} has no ${ROLE_KEY} line`)
  }
  const line = definition.lines[index] ?? ""
  const before = line.slice(line.indexOf(":") + 1).trim()
  if (roles === "") definition.lines.splice(index, 1)
  else definition.lines[index] = `${ROLE_KEY}: ${roles}`
  const changed = roles !== before
  if (changed) fs.writeFileSync(definition.file, definition.lines.join("\n"))
  return {
    ok: true,
    target: definition.target,
    changed,
    before,
    after: roles === "" ? null : roles
  }
}

function run(options: Options): unknown {
  switch (options.command) {
    case "list-coverage":
      return listCoverage(options)
    case "check-fragments":
      return {
        ok: true,
        ...checkFragments(pluginRoot(), options.dir, options.lang)
      }
    case "scaffold-fragments":
      return {
        ok: true,
        lang: options.lang,
        written: scaffoldFragments(pluginRoot(), options.dir, options.lang).map(
          (file) => relative(options, file)
        )
      }
    case "list-mcp":
      return { ok: true, servers: listMcpServers(process.env) }
    case "prune-tools":
      return pruneTools(options)
    case "rewrite-roles":
      return rewriteRoles(options)
    case "check":
    case "write":
      throw new Error("not implemented")
  }
}

try {
  process.stdout.write(
    `${JSON.stringify(run(parseArgs(process.argv.slice(2))))}\n`
  )
} catch (error) {
  process.stdout.write(
    `${JSON.stringify({
      ok: false,
      error: error instanceof Error ? error.message : "Unexpected error"
    })}\n`
  )
  process.exitCode = 1
}
