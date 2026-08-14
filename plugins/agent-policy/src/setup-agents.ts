import { execFileSync } from "node:child_process"
import fs from "node:fs"
import path from "node:path"
import { fileURLToPath } from "node:url"

type Profile = "gpt" | "grok"

type Action = "written" | "skipped" | "checked"

interface ProfileConfig {
  assetsDirectory: string
  defaultAlias: (name: string) => string
}

interface Options {
  profile: Profile
  check: boolean
  overwrite: boolean
  agents?: string[]
  aliases: Map<string, string>
  dir?: string
}

interface Template {
  name: string
  content: string
}

interface AgentResult {
  name: string
  alias: string
  path: string
  exists: boolean
  upToDate: boolean
  action: Action
}

const PROFILES: Record<Profile, ProfileConfig> = {
  gpt: {
    assetsDirectory: "skills/setup-gpt/assets",
    defaultAlias: (name) => {
      if (!name.startsWith("gpt-")) {
        throw new Error(`Unexpected GPT agent name: ${name}`)
      }
      return `claude-gpt-5-6-${name.slice("gpt-".length)}`
    }
  },
  grok: {
    assetsDirectory: "skills/setup-grok/assets",
    defaultAlias: () => "claude-grok-4-5"
  }
}

function main(): void {
  const options = parseArgs(process.argv.slice(2))
  const profile = PROFILES[options.profile]
  const templates = loadTemplates(
    path.join(resolvePluginRoot(), profile.assetsDirectory)
  )
  validateRequestedAgents(options, templates)

  const outputRoot = resolveOutputRoot(options.dir)
  const outDir = path.join(outputRoot, ".claude", "agents")
  const agents = templates
    .filter(
      (template) =>
        options.agents === undefined || options.agents.includes(template.name)
    )
    .map((template) =>
      writeAgent(template, profile, options, outputRoot, outDir)
    )

  respond({ ok: true, profile: options.profile, outDir, agents })
}

function parseArgs(args: string[]): Options {
  let profile: Profile | undefined
  let check = false
  let overwrite = false
  let agents: string[] | undefined
  const aliases = new Map<string, string>()
  let dir: string | undefined

  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index]
    switch (arg) {
      case "--profile":
        profile = parseProfile(requireValue(args, ++index, "profile"))
        break
      case "--check":
        check = true
        break
      case "--overwrite":
        overwrite = true
        break
      case "--agents":
        agents = parseAgents(requireValue(args, ++index, "agents"))
        break
      case "--alias": {
        const [name, alias] = parseAlias(requireValue(args, ++index, "alias"))
        aliases.set(name, alias)
        break
      }
      case "--dir":
        dir = requireValue(args, ++index, "dir")
        break
      default:
        throw new Error(`Unsupported option: ${arg}`)
    }
  }

  if (profile === undefined) {
    throw new Error("profile: is required")
  }

  return {
    profile,
    check,
    overwrite,
    ...(agents === undefined ? {} : { agents }),
    aliases,
    ...(dir === undefined ? {} : { dir })
  }
}

function parseProfile(value: string): Profile {
  if (value === "gpt" || value === "grok") return value
  throw new Error("profile: must be gpt or grok")
}

function parseAgents(value: string): string[] {
  const agents = value.split(",").map((agent) => agent.trim())
  if (agents.length === 0 || agents.some((agent) => agent.length === 0)) {
    throw new Error("agents: must be a non-empty CSV")
  }
  return [...new Set(agents)]
}

function parseAlias(value: string): [string, string] {
  const separator = value.indexOf("=")
  if (separator <= 0 || separator === value.length - 1) {
    throw new Error("alias: must be <name>=<alias>")
  }
  return [value.slice(0, separator), value.slice(separator + 1)]
}

function requireValue(args: string[], index: number, field: string): string {
  const value = args[index]
  if (value === undefined || value.startsWith("--")) {
    throw new Error(`${field}: is required`)
  }
  return value
}

function resolvePluginRoot(): string {
  return (
    process.env.CLAUDE_PLUGIN_ROOT ??
    path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..")
  )
}

function loadTemplates(directory: string): Template[] {
  const files = fs
    .readdirSync(directory, { withFileTypes: true })
    .filter((entry) => entry.isFile() && entry.name.endsWith(".template.md"))
    .map((entry) => entry.name)
    .sort((left, right) => left.localeCompare(right))

  if (files.length === 0) {
    throw new Error(`No templates found: ${directory}`)
  }

  return files.map((file) => parseTemplate(path.join(directory, file)))
}

function parseTemplate(file: string): Template {
  const content = fs.readFileSync(file, "utf8")
  const lines = content.split("\n")
  const name = lines
    .slice(1, lines.indexOf("---", 1))
    .find((line) => line.startsWith("name: "))

  if (content.split("{{MODEL_ALIAS}}").length !== 2) {
    throw new Error(`Template must contain one model placeholder: ${file}`)
  }
  if (name === undefined || name.length === "name: ".length) {
    throw new Error(`Template name is missing: ${file}`)
  }

  return { name: name.slice("name: ".length), content }
}

function validateRequestedAgents(
  options: Options,
  templates: Template[]
): void {
  const names = new Set(templates.map((template) => template.name))
  for (const name of options.agents ?? []) {
    if (!names.has(name)) {
      throw new Error(`agents: unknown agent: ${name}`)
    }
  }
  for (const name of options.aliases.keys()) {
    if (!names.has(name)) {
      throw new Error(`alias: unknown agent: ${name}`)
    }
  }
}

function resolveOutputRoot(dir: string | undefined): string {
  if (dir !== undefined) return path.resolve(dir)

  const cwd = process.cwd()
  try {
    const root = execFileSync("git", ["rev-parse", "--show-toplevel"], {
      cwd,
      stdio: ["ignore", "pipe", "ignore"]
    })
      .toString()
      .trim()
    if (root.length > 0) return root
  } catch {
    // git 未導入または git 管理外では cwd を使う。
  }
  return cwd
}

function writeAgent(
  template: Template,
  profile: ProfileConfig,
  options: Options,
  outputRoot: string,
  outDir: string
): AgentResult {
  const alias =
    options.aliases.get(template.name) ?? profile.defaultAlias(template.name)
  const content = template.content.replace("{{MODEL_ALIAS}}", alias)
  const target = path.join(outDir, `${template.name}.md`)
  const existing = readExisting(target)
  const exists = existing !== undefined
  const upToDate = existing?.equals(Buffer.from(content, "utf8")) ?? false
  let action: Action

  if (options.check) {
    action = "checked"
  } else if (exists && !options.overwrite) {
    action = "skipped"
  } else {
    fs.mkdirSync(outDir, { recursive: true })
    fs.writeFileSync(target, content)
    action = "written"
  }

  return {
    name: template.name,
    alias,
    path: path.relative(outputRoot, target).split(path.sep).join("/"),
    exists,
    upToDate,
    action
  }
}

function readExisting(target: string): Buffer | undefined {
  try {
    return fs.readFileSync(target)
  } catch (error) {
    if (isNotFound(error)) return undefined
    throw error
  }
}

function isNotFound(error: unknown): boolean {
  return (
    error !== null &&
    typeof error === "object" &&
    "code" in error &&
    error.code === "ENOENT"
  )
}

function respond(value: unknown): void {
  process.stdout.write(`${JSON.stringify(value)}\n`)
}

try {
  main()
} catch (error) {
  respond({
    ok: false,
    error: error instanceof Error ? error.message : "Unexpected error"
  })
  process.exitCode = 1
}
