import {
  MODELS,
  type ModelId,
  type ModelSpec,
  rolesAcrossPolicies
} from "./policies"
import type { RoleId } from "./roles"

export interface Preset {
  modelId: ModelId
  name: string
  vendor: ModelSpec["vendor"]
  defaultAlias: string
  color: string
  roleIds: RoleId[]
}

// 同梱プリセットは GPT / Grok の帯だけを持つ。Claude 帯は方針によって
// 役割集合が大きく変わるため、和集合を配ると担当表と食い違う定義になる。
// Claude 帯の定義は setup で生成する。
export const PRESETS: readonly Preset[] = MODELS.filter(
  (model) => model.vendor !== "claude"
).map((model) => ({
  modelId: model.id,
  name: model.defaultName,
  vendor: model.vendor,
  defaultAlias: model.model,
  color: model.color,
  roleIds: rolesAcrossPolicies(model.id)
}))

export const DEFAULT_ALIASES: Record<string, string> = Object.fromEntries(
  PRESETS.map((preset) => [preset.name, preset.defaultAlias])
)
