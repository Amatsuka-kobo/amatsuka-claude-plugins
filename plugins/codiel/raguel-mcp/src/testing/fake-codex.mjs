#!/usr/bin/env node
/**
 * codexCli.ts のテスト用スタブ。実 codex CLI の代わりに RAGUEL_CODEX_BIN として spawn される。
 *
 * 起動の検査: `exec` と隔離のフラグがすべてあり、プロンプトを stdin で受ける `-` が最後にあること。
 * --output-schema のファイルが厳格な形(オブジェクトごとに全プロパティを required に並べ、
 * additionalProperties: false を持つ)であること。--output-schema と -o のファイルが cwd の中にあり、
 * cwd にスキーマのファイルのほかに何も無いこと。外れたら stderr に理由を書いて非ゼロ(2)で終わる。
 * 応答は -o のファイルに書き、stdout には応答と取り違えうる文字列を書く。
 *
 * 環境変数:
 * - FAKE_CODEX_MODE: "ok" | "bad-json" | "hang" | "fail" | "fail-once"(既定 "ok")
 * - FAKE_CODEX_RESPONSE: -o に書く JSON 文字列(既定 "{}")
 * - FAKE_CODEX_STDIN_FILE: 指定時、受け取った stdin 全文をこのパスに書き出す
 * - FAKE_CODEX_STATE_FILE: 指定時、呼び出し回数を記録するファイル
 * - FAKE_CODEX_ARGS_FILE: 指定時、受け取った引数の列を JSON でこのパスに書き出す
 * - RAGUEL_ENV_DUMP_FILE: 指定時、env(RAGUEL_PANELIST)と cwd を JSON でこのパスに書き出す
 */

import {
  existsSync,
  readdirSync,
  readFileSync,
  realpathSync,
  writeFileSync
} from "node:fs"
import * as path from "node:path"

const mode = process.env.FAKE_CODEX_MODE ?? "ok"
const responseJson = process.env.FAKE_CODEX_RESPONSE ?? "{}"
const stdinFile = process.env.FAKE_CODEX_STDIN_FILE
const stateFile = process.env.FAKE_CODEX_STATE_FILE
const argsFile = process.env.FAKE_CODEX_ARGS_FILE
const envDumpFile = process.env.RAGUEL_ENV_DUMP_FILE

const REQUIRED_SWITCHES = [
  "--ephemeral",
  "--ignore-user-config",
  "--skip-git-repo-check"
]
const VALUE_OPTIONS = ["--sandbox", "--output-schema", "-o", "-m"]

function fail(problem) {
  process.stderr.write(`fake-codex: ${problem}\n`)
  process.exit(2)
}

/** 厳格な形でない箇所を返す。無ければ null */
function findLooseNode(schema, where) {
  if (typeof schema !== "object" || schema === null) return null
  if ("$schema" in schema) return `${where} に $schema があります`
  if (schema.properties) {
    if (schema.additionalProperties !== false) {
      return `${where} に additionalProperties: false がありません`
    }
    const keys = Object.keys(schema.properties).sort()
    const required = [...(schema.required ?? [])].sort()
    if (JSON.stringify(keys) !== JSON.stringify(required)) {
      return `${where} の required が全プロパティと一致しません`
    }
    for (const [key, sub] of Object.entries(schema.properties)) {
      const found = findLooseNode(sub, `${where}.properties.${key}`)
      if (found) return found
    }
  }
  if (schema.items) {
    const found = findLooseNode(schema.items, `${where}.items`)
    if (found) return found
  }
  for (const key of ["anyOf", "oneOf", "allOf"]) {
    for (const [i, sub] of (schema[key] ?? []).entries()) {
      const found = findLooseNode(sub, `${where}.${key}[${i}]`)
      if (found) return found
    }
  }
  return null
}

function checkInvocation(argv) {
  if (argv[0] !== "exec") fail("最初の引数が exec ではありません")
  if (argv.at(-1) !== "-") fail("最後の引数が - ではありません")
  const options = {}
  const switches = new Set()
  for (let i = 1; i < argv.length - 1; i++) {
    const arg = argv[i]
    if (VALUE_OPTIONS.includes(arg)) {
      options[arg] = argv[++i]
    } else {
      switches.add(arg)
    }
  }
  for (const flag of REQUIRED_SWITCHES) {
    if (!switches.has(flag)) fail(`${flag} がありません`)
  }
  if (options["--sandbox"] !== "read-only") {
    fail(`--sandbox の値が ${JSON.stringify(options["--sandbox"])} です`)
  }
  if ("-m" in options && !options["-m"]) fail("-m の値が空です")

  const cwd = realpathSync(process.cwd())
  const schemaPath = options["--output-schema"]
  const outputPath = options["-o"]
  if (!schemaPath) fail("--output-schema がありません")
  if (!outputPath) fail("-o がありません")
  for (const file of [schemaPath, outputPath]) {
    if (realpathSync(path.dirname(path.resolve(file))) !== cwd) {
      fail(`${file} が cwd の中にありません`)
    }
  }
  const extra = readdirSync(cwd).filter(
    (name) => name !== path.basename(schemaPath)
  )
  if (extra.length > 0) fail(`cwd にほかのファイルがあります: ${extra.join(", ")}`)

  let schema
  try {
    schema = JSON.parse(readFileSync(schemaPath, "utf8"))
  } catch {
    fail("--output-schema のファイルが JSON として読めません")
  }
  if (schema?.type !== "object") fail('スキーマに type: "object" がありません')
  const loose = findLooseNode(schema, "(root)")
  if (loose) fail(loose)
  return outputPath
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
  const argv = process.argv.slice(2)
  if (argsFile) writeFileSync(argsFile, JSON.stringify(argv))
  const outputPath = checkInvocation(argv)
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
    process.stderr.write("fake-codex: intentional failure\n")
    process.exit(1)
  }

  // stdout は捨てられる前提なので、応答と取り違えうる文字列を書く
  process.stdout.write('{"decoy":true}\n')

  if (mode === "bad-json" && !(stateFile && callCount >= 2)) {
    writeFileSync(outputPath, "{not valid json")
    return
  }

  writeFileSync(outputPath, responseJson)
}

main()
