import fs from "node:fs"
import path from "node:path"
import { parseFrontmatter } from "./lib/frontmatter.js"

type DefinitionType = "skill" | "command"

interface CheckResult {
  path: string
  type: DefinitionType
  name: string
  command: string
  errors: string[]
  warnings: string[]
}

const KNOWN_FIELDS = new Set([
  "name",
  "description",
  "when_to_use",
  "argument-hint",
  "arguments",
  "disable-model-invocation",
  "user-invocable",
  "allowed-tools",
  "disallowed-tools",
  "model",
  "effort",
  "context",
  "agent",
  "background",
  "hooks",
  "paths",
  "shell"
])

function usage(): void {
  console.error(
    "usage: node scripts/check-skill-definition.mjs <definition.md> [--type skill|command]"
  )
}

function parseArgs(
  args: string[]
): { file: string; type?: DefinitionType } | null {
  if (args.length === 0) return null

  const [file, ...options] = args
  let type: DefinitionType | undefined
  for (let index = 0; index < options.length; index += 1) {
    if (options[index] !== "--type") return null
    const value = options[index + 1]
    if (value !== "skill" && value !== "command") return null
    type = value
    index += 1
  }

  return { file, type }
}

function normalizedPath(file: string): string {
  return path.resolve(file).split(path.sep).join("/")
}

function inferType(file: string): DefinitionType | null {
  const normalized = normalizedPath(file)
  if (normalized.includes("/commands/") && normalized.endsWith(".md"))
    return "command"
  if (path.basename(file) === "SKILL.md") return "skill"
  return null
}

function isValidName(name: string): boolean {
  return /^[a-z0-9]$/.test(name) || /^[a-z0-9][a-z0-9-]*[a-z0-9]$/.test(name)
}

function resolveCommand(
  file: string,
  type: DefinitionType,
  name: string
): string {
  const normalized = normalizedPath(file)
  const match = normalized.match(/\/plugins\/([^/]+)\/(?:skills|commands)\//)
  if (match) return `/${match[1]}:${name}`
  return `/${name}`
}

function checkDefinition(
  file: string,
  type: DefinitionType,
  source: string
): CheckResult {
  const { fields, body, errors } = parseFrontmatter(source)
  const warnings: string[] = []
  const hasName = "name" in fields
  const filename = path.basename(file, path.extname(file))
  const name = type === "skill" ? (hasName ? fields.name : path.basename(path.dirname(file))) : filename

  if ((type === "skill" && hasName && !isValidName(fields.name)) ||
    (type === "command" && !isValidName(filename))) {
    errors.push(
      "name は英小文字・数字・ハイフンのみで指定し、先頭と末尾はハイフン以外にする"
    )
  }

  if (!fields.description && !body)
    errors.push("description も本文も無い。どちらか一方は要る")

  for (const key of Object.keys(fields)) {
    if (!KNOWN_FIELDS.has(key))
      errors.push(`使用できない frontmatter フィールド: ${key}`)
  }

  if (!fields.description && body)
    warnings.push("description が未指定。本文の第 1 段落が使われる")

  const descriptionLength = [...(fields.description ?? "")].length
  const whenToUseLength = [...(fields.when_to_use ?? "")].length
  const metadataLength = descriptionLength + whenToUseLength
  if (metadataLength > 1536) {
    warnings.push(
      `description と when_to_use の合計が 1536 文字を超えている(${metadataLength} 文字)。一覧で切り詰められる`
    )
  } else if (metadataLength > 1300) {
    warnings.push(
      `description と when_to_use の合計が上限に近い(${metadataLength} 文字 / 1536)`
    )
  }

  const bodyLines = body ? body.split(/\r?\n/).length : 0
  if (bodyLines > 500)
    warnings.push(
      `本文が 500 行を超えている(${bodyLines} 行)。references/ への分割を検討する`
    )

  if (fields.context === "fork" && !fields.agent)
    warnings.push("context: fork に対する agent が未指定")

  if (type === "command" && hasName)
    warnings.push(
      `command の name はコマンド名を決めない。呼び出し名はファイル名(${filename})になる`
    )

  return {
    path: file,
    type,
    name,
    command: resolveCommand(file, type, name),
    errors,
    warnings
  }
}

const args = parseArgs(process.argv.slice(2))
if (!args) {
  usage()
  process.exitCode = 2
} else {
  const type = args.type ?? inferType(args.file)
  if (!type) {
    console.error("定義種別を判別できない。--type を指定する")
    process.exitCode = 2
  } else {
    let source: string
    try {
      source = fs.readFileSync(args.file, "utf8")
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      console.error(`定義ファイルを読めない: ${args.file}: ${message}`)
      process.exitCode = 2
      process.exit()
    }

    const result = checkDefinition(args.file, type, source)
    console.log(JSON.stringify(result, null, 2))
    process.exitCode = result.errors.length === 0 ? 0 : 1
  }
}
