// inject.test.ts が scripts/fetch-morph.mjs の代わりに置く差し替え。
// NJ_STUB_DELAY_MS ミリ秒(既定 1000)待ってから、CLAUDE_PLUGIN_DATA に目印のファイルを書く。

import fs from "node:fs"
import path from "node:path"

const delay = Number(process.env.NJ_STUB_DELAY_MS ?? 1000)
setTimeout(() => {
  fs.writeFileSync(
    path.join(process.env.CLAUDE_PLUGIN_DATA, "stub-started"),
    `${process.pid}\n`
  )
}, delay)
