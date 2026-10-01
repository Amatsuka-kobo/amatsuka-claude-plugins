/**
 * ルールの単体テスト用の共通フィクスチャを作るヘルパー。
 * プロダクションのコードからは参照しない(テスト専用)。
 */

import { defaultConfig } from "../config/defaults.js"
import { DEFAULT_TESTS_DIR } from "../config/paths.js"
import type {
  Artifact,
  PriorAttempt,
  RaguelConfig,
  RuleContext
} from "../core/types.js"

export function makeArtifact(overrides: Partial<Artifact> = {}): Artifact {
  return {
    kind: "code",
    phase: "implement",
    runId: "run-1",
    objective: "テスト用の目的",
    content: "",
    headingLines: [],
    subject: { repoPath: "/tmp/raguel-repo", head: null, files: [] },
    changedPaths: [],
    context: {},
    ...overrides
  }
}

/**
 * 内蔵の既定の設定(ルールのパラメータの既定値を含む)に overrides を浅く重ねて返す。
 * パネルを起動しないよう judge.provider は none、置き場は /tmp にする
 */
export function makeConfig(
  overrides: Partial<RaguelConfig> = {}
): RaguelConfig {
  const base = structuredClone(defaultConfig)
  return {
    ...base,
    storage: { ...base.storage, casesDir: "/tmp/raguel-cases" },
    judge: { ...base.judge, provider: "none" },
    ...overrides
  }
}

export function makeCtx(
  configOverrides: Partial<RaguelConfig> = {},
  priorAttempts: PriorAttempt[] = [],
  testsDir: string = DEFAULT_TESTS_DIR
): RuleContext {
  return {
    config: makeConfig(configOverrides),
    testsDir,
    priorAttempts
  }
}
