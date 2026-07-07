#!/usr/bin/env node
/**
 * claudeCli.ts のテスト用スタブ。実 claude CLI の代わりに RAGUEL_CLAUDE_BIN として spawn される。
 *
 * 環境変数:
 * - FAKE_CLAUDE_MODE: "ok" | "structured" | "fenced" | "bad-json" | "hang" | "fail"(既定 "ok")
 * - FAKE_CLAUDE_RESPONSE: 応答本体の JSON 文字列(既定 "{}")
 * - FAKE_CLAUDE_STDIN_FILE: 指定時、受け取った stdin 全文をこのパスに書き出す
 * - FAKE_CLAUDE_STATE_FILE: 指定時、呼び出し回数を記録するファイル。
 *   "bad-json" モードで 2 回目以降の呼び出しを成功させたい場合に使う
 * - RAGUEL_ENV_DUMP_FILE: 指定時、env(RAGUEL_PANELIST 等)と cwd を JSON でこのパスに書き出す
 *   (claudeCli.ts が子プロセスに RAGUEL_PANELIST=1 を渡すことをテストから検証するため)
 * - FAKE_CLAUDE_DELAY_MS: 指定時、応答前にこの時間だけ待つ(セマフォの同時実行数検証用)
 * - FAKE_CLAUDE_TIMELINE_FILE: 指定時、待機の開始・終了時刻を "start:<epoch-ms>\n" /
 *   "end:<epoch-ms>\n" として追記する(複数プロセスからの追記なので短い1行 append のみ行う)
 */

import { appendFileSync, existsSync, readFileSync, writeFileSync } from "node:fs"

const mode = process.env.FAKE_CLAUDE_MODE ?? "ok"
const responseJson = process.env.FAKE_CLAUDE_RESPONSE ?? "{}"
const stdinFile = process.env.FAKE_CLAUDE_STDIN_FILE
const stateFile = process.env.FAKE_CLAUDE_STATE_FILE
const envDumpFile = process.env.RAGUEL_ENV_DUMP_FILE
const delayMs = process.env.FAKE_CLAUDE_DELAY_MS
  ? Number(process.env.FAKE_CLAUDE_DELAY_MS)
  : 0
const timelineFile = process.env.FAKE_CLAUDE_TIMELINE_FILE

async function readStdin() {
  const chunks = []
  for await (const chunk of process.stdin) chunks.push(chunk)
  return Buffer.concat(chunks).toString("utf8")
}

function nextCallCount() {
  if (!stateFile) return 1
  let count = 0
  if (existsSync(stateFile)) {
    count = Number(readFileSync(stateFile, "utf8").trim() || "0")
  }
  count += 1
  writeFileSync(stateFile, String(count))
  return count
}

async function main() {
  const stdin = await readStdin()

  if (stdinFile) writeFileSync(stdinFile, stdin)
  if (envDumpFile) {
    writeFileSync(
      envDumpFile,
      JSON.stringify({
        RAGUEL_PANELIST: process.env.RAGUEL_PANELIST ?? null,
        cwd: process.cwd()
      })
    )
  }

  if (mode === "hang") {
    await new Promise((resolve) => setTimeout(resolve, 60000))
    return
  }

  if (mode === "fail") {
    process.stderr.write("fake-claude: intentional failure\n")
    process.exit(1)
  }

  if (delayMs > 0) {
    if (timelineFile) appendFileSync(timelineFile, `start:${Date.now()}\n`)
    await new Promise((resolve) => setTimeout(resolve, delayMs))
    if (timelineFile) appendFileSync(timelineFile, `end:${Date.now()}\n`)
  }

  const callCount = nextCallCount()

  if (mode === "bad-json") {
    if (stateFile && callCount >= 2) {
      process.stdout.write(JSON.stringify({ result: responseJson }))
      return
    }
    process.stdout.write("{not valid json")
    return
  }

  if (mode === "structured") {
    process.stdout.write(
      JSON.stringify({ structured_output: JSON.parse(responseJson) })
    )
    return
  }

  if (mode === "fenced") {
    process.stdout.write(
      JSON.stringify({ result: "```json\n" + responseJson + "\n```" })
    )
    return
  }

  // "ok"(既定)
  process.stdout.write(JSON.stringify({ result: responseJson }))
}

main()
