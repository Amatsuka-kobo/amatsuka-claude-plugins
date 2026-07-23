import fs from "node:fs"
import path from "node:path"
import type { RaphaelConfig } from "./types.js"

export const DEFAULT_CONFIG: RaphaelConfig = {
  detectCommandFailure: true,
  detectRetryLoop: true,
  detectUserRejection: true,
  detectEditChurn: true,
  retryThreshold: 3,
  editChurnThreshold: 3,
  distillThreshold: 3,
  defaultExpiryDays: 30,
  maxInjections: 3,
  rejectionPatterns: [],
  benignExit1Commands: [],
  antibodiesGitPolicy: "commit"
}

export function configPath(projectDir: string): string {
  return path.join(projectDir, ".claude", "raphael.local.md")
}

function parseFrontmatter(raw: string): Map<string, string> | null {
  const match = raw.match(/^---\r?\n([\s\S]*?)\r?\n---(?:\r?\n|$)/)
  if (!match) return null

  const entries = new Map<string, string>()
  for (const line of match[1].split(/\r?\n/)) {
    if (line.trim() === "") continue
    const field = line.match(/^([a-z0-9_]+):(?:\s?(.*))$/)
    if (!field) return null
    entries.set(field[1], field[2])
  }
  return entries
}

function booleanValue(value: string | undefined): boolean | null {
  if (value === "true") return true
  if (value === "false") return false
  return null
}

function integerInRange(
  value: string | undefined,
  minimum: number,
  maximum: number
): number | null {
  if (!value || !/^-?\d+$/.test(value)) return null
  const parsed = Number(value)
  return Number.isSafeInteger(parsed) && parsed >= minimum && parsed <= maximum
    ? parsed
    : null
}

function stringArray(value: string | undefined): string[] | null {
  if (value === undefined) return null
  try {
    const parsed: unknown = JSON.parse(value)
    return Array.isArray(parsed) &&
      parsed.every((item) => typeof item === "string")
      ? parsed
      : null
  } catch {
    return null
  }
}

function gitPolicy(value: string | undefined): "commit" | "ignore" | null {
  return value === "commit" || value === "ignore" ? value : null
}

// 設定ファイルを完全には YAML として扱わない。flat frontmatter の許可済み key
// だけを検査するため、壊れた field は個別に既定値へ戻せる。
export function loadConfig(projectDir: string): RaphaelConfig {
  const config: RaphaelConfig = {
    ...DEFAULT_CONFIG,
    rejectionPatterns: [...DEFAULT_CONFIG.rejectionPatterns],
    benignExit1Commands: [...DEFAULT_CONFIG.benignExit1Commands]
  }

  let raw: string
  try {
    raw = fs.readFileSync(configPath(projectDir), "utf8")
  } catch {
    return config
  }

  const fields = parseFrontmatter(raw)
  if (!fields) return config

  const detectCommandFailure = booleanValue(
    fields.get("detect_command_failure")
  )
  if (detectCommandFailure !== null)
    config.detectCommandFailure = detectCommandFailure

  const detectRetryLoop = booleanValue(fields.get("detect_retry_loop"))
  if (detectRetryLoop !== null) config.detectRetryLoop = detectRetryLoop

  const detectUserRejection = booleanValue(fields.get("detect_user_rejection"))
  if (detectUserRejection !== null)
    config.detectUserRejection = detectUserRejection

  const detectEditChurn = booleanValue(fields.get("detect_edit_churn"))
  if (detectEditChurn !== null) config.detectEditChurn = detectEditChurn

  const retryThreshold = integerInRange(fields.get("retry_threshold"), 2, 10)
  if (retryThreshold !== null) config.retryThreshold = retryThreshold

  const editChurnThreshold = integerInRange(
    fields.get("edit_churn_threshold"),
    2,
    10
  )
  if (editChurnThreshold !== null)
    config.editChurnThreshold = editChurnThreshold

  const distillThreshold = integerInRange(
    fields.get("distill_threshold"),
    1,
    100
  )
  if (distillThreshold !== null) config.distillThreshold = distillThreshold

  const defaultExpiryDays = integerInRange(
    fields.get("default_expiry_days"),
    1,
    365
  )
  if (defaultExpiryDays !== null) config.defaultExpiryDays = defaultExpiryDays

  const maxInjections = integerInRange(fields.get("max_injections"), 1, 10)
  if (maxInjections !== null) config.maxInjections = maxInjections

  const rejectionPatterns = stringArray(fields.get("rejection_patterns"))
  if (rejectionPatterns !== null) config.rejectionPatterns = rejectionPatterns

  const benignExit1Commands = stringArray(fields.get("benign_exit1_commands"))
  if (benignExit1Commands !== null)
    config.benignExit1Commands = benignExit1Commands

  const antibodiesGitPolicy = gitPolicy(fields.get("antibodies_git_policy"))
  if (antibodiesGitPolicy !== null)
    config.antibodiesGitPolicy = antibodiesGitPolicy

  return config
}
