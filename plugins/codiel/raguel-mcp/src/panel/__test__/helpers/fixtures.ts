/**
 * パネルのテスト用の最小の Artifact。ルール層の makeArtifact に、パネルのプロンプトで確かめる
 * objective と本文を足したもの。
 */

import type { Artifact } from "../../../core/types.js"
import { makeArtifact as makeRuleArtifact } from "../../../rules/testHelpers.js"

export function makeArtifact(overrides: Partial<Artifact> = {}): Artifact {
  return makeRuleArtifact({
    objective: "ログイン機能を追加する",
    content:
      "diff --git a/src/login.ts b/src/login.ts\n+ export function login() {}",
    changedPaths: ["src/login.ts"],
    ...overrides
  })
}
