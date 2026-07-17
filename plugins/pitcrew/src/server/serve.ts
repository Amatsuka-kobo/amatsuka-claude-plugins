import crypto from "node:crypto"
import fs from "node:fs"
import path from "node:path"
import { writeFileAtomic } from "../lib/atomic.js"
import { loadConfig } from "../lib/config.js"
import { pitcrewDir } from "../lib/run.js"
import { createPitcrewServer } from "./http.js"

// ブラウザビューアのエントリ(設計書 §5)。/pitcrew:serve コマンドが起動する。
// 127.0.0.1 のみに listen し、トークン付き URL を表示・serve.json に書く。
// 正常終了(SIGINT/SIGTERM)で serve.json を削除する。

function parseArgs(argv: string[]): { port: number | null; dir: string } {
  let port: number | null = null
  let dir = process.cwd()
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === "--port" && argv[i + 1] !== undefined) {
      const n = Number(argv[i + 1])
      // --port 0 はテスト用のエフェメラルポート指定として有効
      if (Number.isInteger(n) && n >= 0 && n <= 65535) port = n
      i++
    } else if (argv[i] === "--dir" && argv[i + 1] !== undefined) {
      dir = path.resolve(argv[i + 1])
      i++
    }
  }
  return { port, dir }
}

const { port: portArg, dir: projectDir } = parseArgs(process.argv.slice(2))
const config = loadConfig(projectDir)
const port = portArg ?? config.port
const token = crypto.randomBytes(24).toString("hex")

// UI は自分のファイルの隣の ui.html を読む(src/ でも scripts/ でも同じ相対位置)
const html = fs
  .readFileSync(new URL("./ui.html", import.meta.url), "utf8")
  .replaceAll("%PITCREW_THEME%", config.theme)

const server = createPitcrewServer({ projectDir, token, html })
const serveJsonPath = path.join(pitcrewDir(projectDir), "serve.json")

server.listen(port, "127.0.0.1", () => {
  const addr = server.address()
  const actualPort =
    typeof addr === "object" && addr !== null ? addr.port : port
  const url = `http://127.0.0.1:${actualPort}/?token=${token}`
  writeFileAtomic(
    serveJsonPath,
    `${JSON.stringify(
      {
        port: actualPort,
        token,
        pid: process.pid,
        startedAt: new Date().toISOString(),
        url
      },
      null,
      2
    )}\n`
  )
  console.log(`pitcrew viewer: ${url}`)
})

server.on("error", (err) => {
  console.error(`pitcrew viewer の起動に失敗しました: ${String(err)}`)
  process.exit(1)
})

function shutdown(): void {
  try {
    fs.rmSync(serveJsonPath, { force: true })
  } catch {
    // serve.json の削除失敗は無視(次回起動で上書きされる)
  }
  server.close(() => process.exit(0))
  // SSE 接続が残っていても 1 秒で強制終了する
  setTimeout(() => process.exit(0), 1000).unref()
}

process.on("SIGINT", shutdown)
process.on("SIGTERM", shutdown)
