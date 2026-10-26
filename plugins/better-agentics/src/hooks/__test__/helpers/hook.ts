import fs from "node:fs"
import path from "node:path"
import { fileURLToPath } from "node:url"
import { runTs } from "../../../testing/run-ts"

export const PLUGIN_ROOT = fileURLToPath(
  new URL("../../../../", import.meta.url)
)

export function environment(overrides: NodeJS.ProcessEnv): NodeJS.ProcessEnv {
  const base: NodeJS.ProcessEnv = { ...process.env }
  for (const key of Object.keys(base)) {
    if (key.startsWith("AMATSUKA_AGENT_")) delete base[key]
  }
  delete base.TYPESAFE_API_KEY
  delete base.CLAUDE_PROJECT_DIR
  base.CLAUDE_PLUGIN_ROOT = PLUGIN_ROOT
  return { ...base, ...overrides }
}

export const ENABLED: NodeJS.ProcessEnv = {
  AMATSUKA_AGENT_ENABLE_ORCHESTRATION: "1",
  TYPESAFE_API_KEY: "k"
}

export function runHook(
  hook: string,
  input: string,
  env: NodeJS.ProcessEnv
): string {
  const script = fileURLToPath(new URL(`../../${hook}.ts`, import.meta.url))
  return runTs(script, [], { input, env: environment(env), encoding: "utf8" })
}

export function contextOf(output: string): string | undefined {
  if (output.trim() === "") return undefined
  return JSON.parse(output).hookSpecificOutput.additionalContext
}

export function place(project: string, file: string, lines: string[]): void {
  const dir = path.join(project, ".claude", "agents")
  fs.mkdirSync(dir, { recursive: true })
  fs.writeFileSync(path.join(dir, `${file}.md`), [...lines, ""].join("\n"))
}

export function definition(name: string, role: string): string[] {
  return ["---", `name: ${name}`, `better-agentics-role: ${role}`, "---", ""]
}
