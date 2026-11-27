// `link-claude-md`: CLAUDE.md へ ARCHITECTURE の @メンションを追記し、
// metatron.config.json が無ければ作る。

import fs from "node:fs"
import { isMentionablePath, linkClaudeMd } from "../lib/claude-md.js"
import { loadConfig } from "../lib/config.js"
import {
  emitResult,
  emitWriteFailure,
  messageOf,
  noteWarnings
} from "./output.js"

export interface LinkContext {
  cwd: string
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
  const candidates = [config.architectureRelative]
  // 空白か制御文字を含むパスは @メンションにできないので、残りだけを追記する。
  const relatives = candidates.filter(isMentionablePath)
  const skipped = candidates.filter((rel) => !isMentionablePath(rel))
  let configCreated = false
  try {
    // codiel は metatron.config.json の有無で metatron の利用を判定する。既定のパスのまま
    // 使うプロジェクトにも目印を残すため、無ければ最小の設定を作る。既存の設定は上書きしない。
    // CLAUDE.md より先に作り、CLAUDE.md の書き込みに失敗したときは作った設定ファイルを消す。
    configCreated = createConfigIfMissing(config.configPath)
    const result = linkClaudeMd(config.docRoot, relatives)
    emitResult(command, {
      ok: true,
      written: result.added.length > 0 || configCreated,
      ...result,
      skipped,
      configPath: config.configPath,
      configCreated,
      warnings: config.warnings
    })
  } catch (error) {
    // この実行で作った設定ファイルだけを戻す。既存の設定は触らない。
    let configRemoveError: string | undefined
    if (configCreated) {
      try {
        fs.rmSync(config.configPath, { force: true })
        configCreated = false
      } catch (removeError) {
        configRemoveError = messageOf(removeError)
      }
    }
    emitWriteFailure(command, "write_failed", messageOf(error), {
      written: configCreated,
      configCreated,
      ...(configRemoveError === undefined
        ? {}
        : {
            configRemoveFailed: true,
            configRemoveError: `作った設定ファイル ${config.configPath} を消せませんでした: ${configRemoveError}`
          })
    })
  }
}

function createConfigIfMissing(configPath: string): boolean {
  try {
    fs.writeFileSync(configPath, '{\n  "version": 1\n}\n', { flag: "wx" })
    return true
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "EEXIST") return false
    throw error
  }
}
