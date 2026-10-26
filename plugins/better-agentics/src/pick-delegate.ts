#!/usr/bin/env node
// 委譲の理由と作業内容を stdin の JSON で受け取り、委譲先の定義を JSON の 1 行で返す。
// 終了コードは常に 0 とし、成否は ok で表す。

import { projectDirOf, scanDefinitions } from "./lib/agents"
import { createJevAsk } from "./lib/jev"
import { pickDelegate } from "./lib/pick"

function dirArg(argv: string[]): string {
  const index = argv.indexOf("--dir")
  const value = index === -1 ? undefined : argv[index + 1]
  return value === undefined || value.startsWith("--") ? process.cwd() : value
}

async function readStdin(): Promise<string> {
  const chunks: Buffer[] = []
  for await (const chunk of process.stdin) chunks.push(chunk as Buffer)
  return Buffer.concat(chunks).toString("utf8")
}

try {
  const raw = await readStdin()
  const projectDir = projectDirOf(process.env, dirArg(process.argv.slice(2)))
  const key = process.env.TYPESAFE_API_KEY?.trim() ?? ""
  const output = await pickDelegate(raw, {
    definitions: scanDefinitions(projectDir),
    apiKey: key === "" ? undefined : key,
    createAsk: createJevAsk
  })
  process.stdout.write(`${JSON.stringify(output)}\n`)
} catch (error) {
  process.stdout.write(
    `${JSON.stringify({
      ok: false,
      error: "jev-failed",
      message: error instanceof Error ? error.message : String(error)
    })}\n`
  )
}
