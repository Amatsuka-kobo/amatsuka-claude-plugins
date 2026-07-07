/**
 * 内蔵デフォルト設定。docs/DESIGN.md §11 の YAML 例と同値。
 * ユーザー設定はこの値に深マージされる(src/config/loader.ts)。
 */

import type { RaguelConfig } from "../core/types"

export const defaultConfig: RaguelConfig = {
  version: 1,
  onError: "ASK",
  storage: {
    // ~ のまま保持し、loader.ts で os.homedir() を使って展開する
    casesDir: "~/.raguel",
    retention: { maxRuns: 200, maxDays: 90 }
  },
  judge: {
    provider: "claude-cli",
    model: "haiku",
    timeoutMs: 60000,
    canStop: false,
    maxConcurrency: 4,
    thresholds: {
      proceed: 80,
      confidence: 60,
      maxVariance: 30
    }
  },
  weight: {
    tiers: { standard: 30, critical: 70 }
  },
  panel: {
    trivial: [],
    standard: ["adversarial"],
    critical: [
      "adversarial",
      "steelman",
      "crosscheck",
      "assumption",
      "precedent"
    ],
    perPanelist: {
      adversarial: { model: "sonnet" }
    }
  },
  precedent: {
    seedCatalog: true,
    topN: 5
  },
  rules: {
    "code/protected-paths": {
      globs: [".github/**", "infra/**", "**/*.env*"]
    },
    "code/max-diff-lines": {
      limit: 500,
      severity: "ask"
    },
    "plan/irreversible-ops": {
      keywords: ["本番", "deploy", "drop table", "force push", "削除"],
      severity: "ask"
    }
  }
}
