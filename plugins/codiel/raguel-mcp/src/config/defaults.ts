/**
 * 内蔵の既定の設定(設計書 §6.12.1)。利用者の設定はこの値に深くマージされる(src/config/loader.ts)。
 * ルールのパラメータの既定値は rules/params.ts の表から作る。
 */

import type { RaguelConfig } from "../core/types"
import { RULE_SPECS } from "../rules/params"

export const defaultConfig: RaguelConfig = {
  version: 1,
  onError: "ASK",
  storage: {
    // ~ のまま持ち、loader.ts でホームディレクトリへ展開する
    casesDir: "~/.raguel",
    retention: { maxRuns: 200, maxDays: 90 }
  },
  contextJudge: {
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
