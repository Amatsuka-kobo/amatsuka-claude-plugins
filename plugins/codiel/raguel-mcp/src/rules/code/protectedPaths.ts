/**
 * code/protected-paths — 保護する glob への変更の検出(sealed, 既定 stop)。設計書 §6.4.2(R20)。
 * glob は loader が既定の glob との和集合から excludeDefaults を除いた値で、ここではそのまま使う。
 * 生成物(generated)と E2E のレポートのパスは、保護パスに当たっても対象にしない。
 */

import picomatch from "picomatch"
import { classifyPath } from "../../config/paths.js"
import type { Finding, Rule } from "../../core/types.js"
import { ruleParam } from "../params.js"
import { getSeverity } from "../util.js"

const RULE_ID = "code/protected-paths"

export const protectedPathsRule: Rule = {
  id: RULE_ID,
  appliesTo: ["code"],
  sealed: true,
  defaultSeverity: "stop",
  check(artifact, ctx): Finding[] {
    const severity = getSeverity(ctx.config.rules[RULE_ID], "stop")
    const globs = ruleParam<string[]>(ctx.config, RULE_ID, "globs")
    if (globs.length === 0) return []

    // dot: true — .env や .github のようなドットファイルとドットディレクトリも glob の対象にする
    const isMatch = picomatch(globs, { dot: true })
    return artifact.changedPaths
      .filter(
        (path) =>
          classifyPath(path, ctx.config, ctx.testsDir) === "normal" &&
          isMatch(path)
      )
      .map((path) => ({
        ruleId: RULE_ID,
        severity,
        message: `保護されたパスへの変更を検出しました: ${path}`,
        evidence: { location: path, path }
      }))
  }
}
