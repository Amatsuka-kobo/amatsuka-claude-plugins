#!/usr/bin/env node
/**
 * claudeCli.ts のテスト用スタブ。実 claude CLI の代わりに RAGUEL_CLAUDE_BIN として spawn される。
 *
 * 起動の検査: 隔離のフラグがすべてあること、--json-schema の値が JSON として読めて $schema を持たず
 * type: "object" を持つこと、cwd が空のディレクトリであること。外れたら実際の CLI と同じく
 * stderr に理由を書いて非ゼロ(2)で終わる。
 *
 * 環境変数:
 * - FAKE_CLAUDE_MODE: "ok" | "structured" | "fenced" | "bad-json" | "hang" | "fail" | "fail-once"(既定 "ok")
 * - FAKE_CLAUDE_RESPONSE: 応答本体の JSON 文字列(既定 "{}")
 * - FAKE_CLAUDE_STDIN_FILE: 指定時、受け取った stdin 全文をこのパスに書き出す
 * - FAKE_CLAUDE_STATE_FILE: 指定時、呼び出し回数を記録するファイル。
 *   "bad-json" と "fail-once" で 2 回目以降の呼び出しを成功させるときと、起動の回数を数えるときに使う
 * - RAGUEL_ENV_DUMP_FILE: 指定時、env(RAGUEL_PANELIST)と cwd を JSON でこのパスに書き出す
 * - FAKE_CLAUDE_DELAY_MS: 指定時、応答前にこの時間だけ待つ(セマフォの同時実行数の検証用)
 * - FAKE_CLAUDE_TIMELINE_FILE: 指定時、待機の開始・終了時刻を "start:<epoch-ms>\n" /
 *   "end:<epoch-ms>\n" として追記する(複数プロセスからの追記なので短い1行 append のみ行う)
 */

import {
  appendFileSync,
  existsSync,
  readdirSync,
  readFileSync,
  writeFileSync
} from "node:fs"

const mode = process.env.FAKE_CLAUDE_MODE ?? "ok"
const responseJson = process.env.FAKE_CLAUDE_RESPONSE ?? "{}"
const stdinFile = process.env.FAKE_CLAUDE_STDIN_FILE
const stateFile = process.env.FAKE_CLAUDE_STATE_FILE
const envDumpFile = process.env.RAGUEL_ENV_DUMP_FILE
const delayMs = process.env.FAKE_CLAUDE_DELAY_MS
  ? Number(process.env.FAKE_CLAUDE_DELAY_MS)
  : 0
const timelineFile = process.env.FAKE_CLAUDE_TIMELINE_FILE

/** 値を取らないフラグ */
const REQUIRED_SWITCHES = [
  "-p",
  "--disable-slash-commands",
  "--strict-mcp-config",
  "--no-session-persistence"
]
/** 値を取るフラグと、決まった値(null はどの値でもよい) */
const REQUIRED_OPTIONS = {
  "--output-format": "json",
  "--model": null,
  "--tools": "",
  "--mcp-config": '{"mcpServers":{}}',
  "--setting-sources": "project",
  "--json-schema": null
}

function fail(problem) {
  process.stderr.write(`fake-claude: ${problem}\n`)
  process.exit(2)
}

function checkInvocation(argv) {
  const options = {}
  const switches = new Set()
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i]
    if (arg in REQUIRED_OPTIONS) {
      if (i + 1 >= argv.length) fail(`${arg} に値がありません`)
      options[arg] = argv[++i]
    } else {
      switches.add(arg)
    }
  }
  for (const flag of REQUIRED_SWITCHES) {
    if (!switches.has(flag)) fail(`${flag} がありません`)
  }
  for (const [flag, expected] of Object.entries(REQUIRED_OPTIONS)) {
    if (!(flag in options)) fail(`${flag} がありません`)
    if (expected !== null && options[flag] !== expected) {
      fail(`${flag} の値が ${JSON.stringify(options[flag])} です`)
    }
  }
  if (options["--model"] === "") fail("--model の値が空です")

  let schema
  try {
    schema = JSON.parse(options["--json-schema"])
  } catch {
    fail("--json-schema の値が JSON として読めません")
  }
  if (typeof schema !== "object" || schema === null) {
    fail("--json-schema の値がオブジェクトではありません")
  }
  if ("$schema" in schema) fail("--json-schema に $schema があります")
  if (schema.type !== "object") fail('--json-schema に type: "object" がありません')

  const entries = readdirSync(process.cwd())
  if (entries.length > 0) {
    fail(`cwd が空ではありません: ${entries.join(", ")}`)
  }
}

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
  checkInvocation(process.argv.slice(2))
  const stdin = await readStdin()
  const callCount = nextCallCount()

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

  if (mode === "fail" || (mode === "fail-once" && callCount === 1)) {
    process.stderr.write("fake-claude: intentional failure\n")
    process.exit(1)
  }

  if (delayMs > 0) {
    if (timelineFile) appendFileSync(timelineFile, `start:${Date.now()}\n`)
    await new Promise((resolve) => setTimeout(resolve, delayMs))
    if (timelineFile) appendFileSync(timelineFile, `end:${Date.now()}\n`)
  }

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

  // "ok"(既定)と 2 回目以降の "fail-once"
  process.stdout.write(JSON.stringify({ result: responseJson }))
}

main()
