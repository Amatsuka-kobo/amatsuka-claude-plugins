/**
 * 内蔵の既定の設定(設計書 §6.12.1)。利用者の設定はこの値に深くマージされる(src/config/loader.ts)。
 * ルールのパラメータの既定値は rules/params.ts の表から作る。
 */

import type { JudgeProviderName, PanelRole, RaguelConfig } from "../core/types"
import { RULE_SPECS } from "../rules/params"

export const defaultConfig: RaguelConfig = {
  version: 1,
  onError: "ASK",
  storage: {
    // ~ のまま持ち、loader.ts でホームディレクトリへ展開する
    casesDir: "~/.raguel",
    retention: { maxRuns: 200, maxDays: 90 }
  },
  judge: {
    provider: "claude",
    timeoutMs: 180000,
    deadlineMs: 600000,
    maxConcurrency: 4,
    thresholds: {
      proceed: 80,
      confidence: 70,
      maxVariance: 30
    }
  },
  weight: {
    tiers: { standard: 30, critical: 70 }
  },
  panel: {
    perPanelist: {}
  },
  contextJudge: {
    enabled: false,
    timeoutMs: 20000,
    thresholds: { lower: 0.5, raise: 0.7 }
  },
  precedent: {
    seedCatalog: true,
    topN: 5
  },
  subject: {
    ignoreUncommitted: []
  },
  rules: Object.fromEntries(
    RULE_SPECS.filter((spec) => spec.params.length > 0).map((spec) => [
      spec.id,
      Object.fromEntries(
        spec.params.map((p) => [p.name, structuredClone(p.default)])
      )
    ])
  )
}

/** claude の既定のモデル(§6.7.1)。codex は model を指定せず CLI の既定に任せる */
const CLAUDE_DEFAULT_MODELS: Record<PanelRole, string> = {
  adversarial: "sonnet",
  steelman: "haiku",
  crosscheck: "haiku",
  meta: "haiku"
}

/**
 * パネリストか meta の provider と model を解決する(§6.7.1)。
 * model は perPanelist.<名前>.model、provider が judge.provider と同じなら judge.model、プロバイダーごとの既定、の順。
 * model が undefined ならプロバイダーの既定に任せる
 */
export function resolvePanelist(
  config: RaguelConfig,
  role: PanelRole
): { provider: JudgeProviderName; model?: string } {
  const own = config.panel.perPanelist[role]
  const provider = own?.provider ?? config.judge.provider
  const model =
    own?.model ??
    (provider === config.judge.provider ? config.judge.model : undefined) ??
    (provider === "claude" ? CLAUDE_DEFAULT_MODELS[role] : undefined)
  return model === undefined ? { provider } : { provider, model }
}
