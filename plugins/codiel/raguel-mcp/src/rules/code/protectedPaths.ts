/**
 * code/protected-paths — 保護 glob への変更検出(sealed, 既定 stop)
 */

import picomatch from "picomatch"
import type { Finding, Rule } from "../../core/types.js"
import { getSeverity } from "../util.js"

const RULE_ID = "code/protected-paths"

export const DEFAULT_PROTECTED_GLOBS = [".github/**", "infra/**", "**/*.env*"]

export const protectedPathsRule: Rule = {
  id: RULE_ID,
  appliesTo: ["code"],
  sealed: true,
  defaultSeverity: "stop",
  check(artifact, ctx): Finding[] {
    const settings = ctx.config.rules[RULE_ID]
    const severity = getSeverity(settings, "stop")
    const globs = Array.isArray(settings?.globs)
      ? (settings.globs as string[])
      : DEFAULT_PROTECTED_GLOBS

    // dot: true — .env や .github のようなドットファイル/ディレクトリも glob 対象にする
    const isMatch = picomatch(globs, { dot: true })
    const matched = artifact.changedPaths.filter((path) => isMatch(path))

    return matched.map((path) => ({
      ruleId: RULE_ID,
      severity,
      message: `保護されたパスへの変更を検出しました: ${path}`,
      evidence: { location: path }
    }))
  }
}
