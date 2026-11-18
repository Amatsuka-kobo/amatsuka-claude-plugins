// `link-claude-md`: CLAUDE.md へ ARCHITECTURE・GOTCHAS の @メンションを追記し、
// metatron.config.json が無ければ作る。
// GOTCHAS は記録が有効で、台帳に中身があるときだけ対象にする(SessionStart の案内と同じ条件)。

import fs from "node:fs"
import { writeFileAtomic } from "../lib/atomic-write.js"
import { linkClaudeMd } from "../lib/claude-md.js"
import { loadConfig } from "../lib/config.js"
import type { Features } from "../lib/features.js"
import {
  emitResult,
  emitWriteFailure,
  messageOf,
  noteWarnings
} from "./output.js"

export interface LinkContext {
  cwd: string
  features: Features
}

function hasContent(filePath: string): boolean {
  try {
    return fs.readFileSync(filePath, "utf8").trim() !== ""
  } catch {
    return false
  }
}

export function runLinkClaudeMd(ctx: LinkContext): void {
  const command = "link-claude-md"
  const config = loadConfig(ctx.cwd)
  noteWarnings(config.warnings)
  if (!hasContent(config.architecturePath)) {
    emitWriteFailure(
      command,
      "architecture_missing",
      `${config.architectureRelative} がまだ無いため追記しません。先に ARCHITECTURE を作成してください。`
    )
    return
  }
  const relatives = [
    config.architectureRelative,
    ...(ctx.features.gotchas && hasContent(config.gotchasPath)
      ? [config.gotchasRelative]
      : [])
  ]
  try {
    const result = linkClaudeMd(config.docRoot, relatives)
    // codiel は metatron.config.json の有無で metatron の利用を判定する。既定のパスのまま
    // 使うプロジェクトにも目印を残すため、無ければ最小の設定を作る。
    const configCreated = !fs.existsSync(config.configPath)
    if (configCreated)
      writeFileAtomic(config.configPath, '{\n  "version": 1\n}\n')
    emitResult(command, {
      ok: true,
      written: result.added.length > 0 || configCreated,
      ...result,
      configPath: config.configPath,
      configCreated,
      warnings: config.warnings
    })
  } catch (error) {
    emitWriteFailure(command, "write_failed", messageOf(error), {
      written: false
    })
  }
}
