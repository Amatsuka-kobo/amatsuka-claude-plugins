// SessionStart が使用指示に添える知らせと警告を組み立てる。

import type { Definition } from "./agents"
import { CONFIG_FILE, type ConfigState, disabledRolesOf } from "./config"
import { CACHE_TTL_ROLES } from "./extra-keys"
import { ROLES, roleById, rolesFor } from "./roles"

const CACHE_LOST =
  "レビューの定義に書いた 1 時間のプロンプトキャッシュが効かず、5 分になる。"

function isSet(value: string | undefined): boolean {
  return (value?.trim() ?? "") !== ""
}

export function hasReviewDefinition(definitions: Definition[]): boolean {
  return definitions.some((entry) =>
    (CACHE_TTL_ROLES as readonly string[]).includes(entry.role)
  )
}

// 役割の model・effort・キャッシュの寿命を黙って上書きする環境変数を知らせる。
export function envWarnings(
  env: NodeJS.ProcessEnv,
  hasReviewDefinition: boolean
): string[] {
  const warnings: string[] = []
  const effort = env.CLAUDE_CODE_EFFORT_LEVEL?.trim() ?? ""
  if (effort !== "") {
    warnings.push(
      `CLAUDE_CODE_EFFORT_LEVEL が "${effort}" に設定されているため、委譲先に渡す役割ごとの effort が使われない。`
    )
  }
  const force = env.CLAUDE_CODE_SUBAGENT_MODEL_FORCE?.trim().toLowerCase() ?? ""
  if (force !== "" && force !== "0" && force !== "false") {
    warnings.push(
      "CLAUDE_CODE_SUBAGENT_MODEL_FORCE が設定されているため、委譲先のモデルが役割ごとのモデルにならず、一律になる。"
    )
  }
  if (hasReviewDefinition && isSet(env.FORCE_PROMPT_CACHING_5M)) {
    warnings.push(`FORCE_PROMPT_CACHING_5M が設定されているため、${CACHE_LOST}`)
  }
  if (
    hasReviewDefinition &&
    env.CLAUDE_CODE_SUBAGENT_PROMPT_CACHE_TTL?.trim() === "5m"
  ) {
    warnings.push(
      `CLAUDE_CODE_SUBAGENT_PROMPT_CACHE_TTL が 5m のため、${CACHE_LOST}`
    )
  }
  return warnings
}

export function setupNotices(input: {
  definitions: Definition[]
  config: ConfigState
}): string[] {
  const { definitions, config } = input
  const known = definitions.filter(
    (entry) => roleById(entry.role) !== undefined
  )
  const disabled = disabledRolesOf(config)
  const notices: string[] = []

  if (known.length === 0) {
    notices.push(
      "定義の無い役割は Standard Agent モードで委譲する。調整したい役割の定義と、外す役割は better-agentics:setup で決める。"
    )
  } else if (config.kind === "absent") {
    const uncovered = ROLES.filter(
      (role) => !known.some((entry) => entry.role === role.id)
    )
    if (uncovered.length > 0) {
      notices.push(
        [
          `${CONFIG_FILE} がまだ無い。定義の無い次の役割は、Standard Agent モードで委譲する。使わない役割は better-agentics:setup で外す。`,
          ...uncovered.map((role) => `- ${role.id}`)
        ].join("\n")
      )
    }
  }

  const disabledWithDefinition = known.filter((entry) =>
    (disabled as string[]).includes(entry.role)
  )
  if (disabledWithDefinition.length > 0) {
    notices.push(
      [
        "次の役割は設定で外しているが、定義がある。外す設定を優先し、この定義へは委譲しない。",
        ...disabledWithDefinition.map(
          (entry) => `- ${entry.role}: ${entry.name}`
        )
      ].join("\n")
    )
  }

  const stopped = [
    { reason: "review" as const, what: "レビュー" },
    { reason: "split" as const, what: "作業の分担" }
  ].filter(({ reason }) =>
    rolesFor(reason).every((role) => disabled.includes(role.id))
  )
  for (const { reason, what } of stopped) {
    notices.push(
      `${reason} の役割をすべて外しているため、${what}の委譲が止まる。better-agentics:setup で外す役割を見直せる。`
    )
  }

  if (config.kind === "invalid") {
    notices.push(
      `${CONFIG_FILE} の形が違う(${config.message})。外す役割が分からないため、委譲が止まる。better-agentics:setup で作り直す。`
    )
  }
  return notices
}
