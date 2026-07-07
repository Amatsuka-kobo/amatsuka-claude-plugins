/**
 * ルール単体テスト用の共通フィクスチャ生成ヘルパー。
 * プロダクションコードからは参照しない(テスト専用)。
 */

import type {
  Artifact,
  RaguelConfig,
  RuleContext,
  SubmissionDigest
} from "../core/types.js"

export function makeArtifact(overrides: Partial<Artifact> = {}): Artifact {
  return {
    kind: "code",
    runId: "run-1",
    objective: "テスト用の目的",
    content: "",
    changedPaths: [],
    steps: [],
    context: {},
    ...overrides
  }
}

export function makeConfig(
  overrides: Partial<RaguelConfig> = {}
): RaguelConfig {
  return {
    version: 1,
    onError: "ASK",
    storage: {
      casesDir: "/tmp/raguel-cases",
      retention: { maxRuns: 200, maxDays: 90 }
    },
    judge: {
      provider: "none",
      model: "haiku",
      timeoutMs: 60000,
      canStop: false,
      maxConcurrency: 4,
      thresholds: { proceed: 80, confidence: 60, maxVariance: 30 }
    },
    weight: { tiers: { standard: 30, critical: 70 } },
    panel: {
      trivial: [],
      standard: [],
      critical: [],
      perPanelist: {}
    },
    precedent: { seedCatalog: true, topN: 5 },
    rules: {},
    ...overrides
  }
}

export function makeCtx(
  configOverrides: Partial<RaguelConfig> = {},
  priorSubmissions: SubmissionDigest[] = []
): RuleContext {
  return {
    config: makeConfig(configOverrides),
    priorSubmissions
  }
}
