// pitcrew watch のエントリポイント(設計書 §3.5)。TTY でなければ
// alt screen に入る前に終了する。引数は serve.ts の parseArgs と同型の
// --dir のみ(--port は不要)。

import path from "node:path"
import { runTui } from "./loop.js"

function parseArgs(argv: string[]): { dir: string } {
  let dir = process.cwd()
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === "--dir" && argv[i + 1] !== undefined) {
      dir = path.resolve(argv[i + 1])
      i++
    }
  }
  return { dir }
}

const { dir } = parseArgs(process.argv.slice(2))

if (!process.stdin.isTTY || !process.stdout.isTTY) {
  console.error("pitcrew watch は対話端末(TTY)が必要です")
  process.exit(1)
}

runTui(dir)
