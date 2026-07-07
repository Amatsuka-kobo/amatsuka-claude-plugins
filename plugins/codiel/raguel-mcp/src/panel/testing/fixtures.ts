/**
 * テスト用の最小 Artifact フィクスチャ。
 */

import type { Artifact } from "../../core/types.js"

export function makeArtifact(overrides: Partial<Artifact> = {}): Artifact {
  return {
    kind: "code",
    runId: "run-1",
    objective: "ログイン機能を追加する",
    content:
      "diff --git a/src/login.ts b/src/login.ts\n+ export function login() {}",
    changedPaths: ["src/login.ts"],
    steps: [],
    context: {},
    ...overrides
  }
}
