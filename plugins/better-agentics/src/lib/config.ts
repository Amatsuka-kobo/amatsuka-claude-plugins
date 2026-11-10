// プロジェクトの設定ファイルを読み書きする。設定ファイルには外した役割を記録し、書くのは setup の CLI だけとする。

import fs from "node:fs"
import path from "node:path"
import { type RoleId, roleById } from "./roles"

export const CONFIG_FILE = ".claude/better-agentics/config.json"

export interface BetterAgenticsConfig {
  disabledRoles: RoleId[]
}

export type ConfigState =
  | { kind: "absent" }
  | { kind: "ok"; config: BetterAgenticsConfig }
  | { kind: "invalid"; message: string; raw: string | null }

function validate(value: unknown): BetterAgenticsConfig | string {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return "the top level must be an object"
  }
  const roles = (value as { disabledRoles?: unknown }).disabledRoles
  if (
    !Array.isArray(roles) ||
    !roles.every((role) => typeof role === "string")
  ) {
    return "disabledRoles must be an array of role IDs"
  }
  const unknown = roles.filter((role) => roleById(role) === undefined)
  if (unknown.length > 0) {
    return `disabledRoles contains unknown role IDs: ${unknown.join(", ")}`
  }
  return { disabledRoles: roles as RoleId[] }
}

export function readConfig(projectDir: string): ConfigState {
  const file = path.join(projectDir, CONFIG_FILE)
  if (!fs.existsSync(file)) return { kind: "absent" }
  let raw: string
  try {
    raw = fs.readFileSync(file, "utf8")
  } catch (error) {
    return {
      kind: "invalid",
      message: `${CONFIG_FILE} could not be read: ${error instanceof Error ? error.message : String(error)}`,
      raw: null
    }
  }
  let parsed: unknown
  try {
    parsed = JSON.parse(raw)
  } catch {
    return { kind: "invalid", message: `${CONFIG_FILE} is not valid JSON`, raw }
  }
  const result = validate(parsed)
  return typeof result === "string"
    ? { kind: "invalid", message: `${CONFIG_FILE}: ${result}`, raw }
    : { kind: "ok", config: result }
}

export function writeConfig(
  projectDir: string,
  config: BetterAgenticsConfig
): string {
  const result = validate(config)
  if (typeof result === "string") throw new Error(result)
  const file = path.join(projectDir, CONFIG_FILE)
  fs.mkdirSync(path.dirname(file), { recursive: true })
  fs.writeFileSync(
    file,
    `${JSON.stringify({ disabledRoles: result.disabledRoles }, null, 2)}\n`
  )
  return CONFIG_FILE
}

export function disabledRolesOf(state: ConfigState): RoleId[] {
  return state.kind === "ok" ? state.config.disabledRoles : []
}
