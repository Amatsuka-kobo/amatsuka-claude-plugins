#!/usr/bin/env node
// SessionStart の inject.mjs が切り離して起動する取得のエントリポイント。
// 固定の SOURCES で形態素解析の .node と辞書を CLAUDE_PLUGIN_DATA の下へ置く。
// 失敗は installMorph が fetch-failed.json に残すので、ここでは何も出力しない。

import { installMorph, resolveTarget, SOURCES } from "./morph-runtime.js"

const dataDir = process.env.CLAUDE_PLUGIN_DATA
const target = resolveTarget()
if (dataDir && target) {
  await installMorph({ dataDir, target, sources: SOURCES }).catch(() => {})
}
