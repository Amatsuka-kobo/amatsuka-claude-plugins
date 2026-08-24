import type { Vendor } from "./fragments"
import type { RoleId } from "./roles"

export interface Preset {
  name: string
  vendor: Vendor
  defaultAlias: string
  color: string
  roleIds: RoleId[]
}

// 役割は設計書 §8.1。各方針の担当表(PRESET_ASSIGNMENTS)と一致させる。
export const PRESETS: readonly Preset[] = [
  {
    name: "gpt-sol",
    vendor: "gpt",
    defaultAlias: "claude-gpt-5-6-sol",
    color: "yellow",
    roleIds: ["complex-impl"]
  },
  {
    name: "gpt-terra",
    vendor: "gpt",
    defaultAlias: "claude-gpt-5-6-terra",
    color: "green",
    roleIds: [
      "normal-impl",
      "general",
      "explore",
      "realtime-research",
      "independent-review"
    ]
  },
  {
    name: "gpt-luna",
    vendor: "gpt",
    defaultAlias: "claude-gpt-5-6-luna",
    color: "cyan",
    roleIds: ["light-impl"]
  },
  {
    name: "grok",
    vendor: "grok",
    defaultAlias: "claude-grok-4-6",
    color: "red",
    roleIds: [
      "normal-impl",
      "light-impl",
      "general",
      "explore",
      "realtime-research",
      "independent-review"
    ]
  }
]

export const DEFAULT_ALIASES: Record<string, string> = Object.fromEntries(
  PRESETS.map((preset) => [preset.name, preset.defaultAlias])
)
