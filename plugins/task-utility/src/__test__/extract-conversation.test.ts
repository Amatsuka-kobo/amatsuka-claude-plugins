import fs from "node:fs"
import os from "node:os"
import path from "node:path"
import { fileURLToPath } from "node:url"
import { expect, test } from "vitest"
import { runTs } from "../testing/run-ts.js"

const SCRIPT = fileURLToPath(
  new URL("../extract-conversation.ts", import.meta.url)
)

function run(lines: string[]): string {
  const file = path.join(
    fs.mkdtempSync(path.join(os.tmpdir(), "chat-ext-")),
    "t.jsonl"
  )
  fs.writeFileSync(file, `${lines.join("\n")}\n`)
  const stdout = runTs(SCRIPT, [file])
  fs.rmSync(path.dirname(file), { recursive: true, force: true })
  return stdout
}

const user = (text: string, extra: Record<string, unknown> = {}) =>
  JSON.stringify({
    type: "user",
    message: { role: "user", content: text },
    ...extra
  })
const assistant = (content: unknown[], extra: Record<string, unknown> = {}) =>
  JSON.stringify({
    type: "assistant",
    message: { role: "assistant", content },
    ...extra
  })

test("ユーザー発言は原文のまま、ハーネス注入は除外される", () => {
  const out = run([
    user("<command-name>/model</command-name>"),
    user("これは 原文の  発言です。改変されないこと。"),
    user("メタ発言", { isMeta: true })
  ])
  expect(out).toMatch(
    /## USER\n\nこれは 原文の {2}発言です。改変されないこと。/
  )
  expect(out).not.toMatch(/command-name|メタ発言/)
})

test("AI の text と tool_use ヒントが出力され、thinking は出ない", () => {
  const out = run([
    assistant([
      { type: "thinking", thinking: "内心" },
      { type: "text", text: "結論を報告します。" },
      {
        type: "tool_use",
        name: "Bash",
        input: { description: "テストを実行" }
      },
      { type: "tool_use", name: "Write", input: { file_path: "/x/y.md" } }
    ])
  ])
  expect(out).toMatch(/## ASSISTANT\n\n結論を報告します。/)
  expect(out).toMatch(/\(tool: Bash — テストを実行\)/)
  expect(out).toMatch(/\(tool: Write — \/x\/y\.md\)/)
  expect(out).not.toMatch(/内心/)
})

test("連続する ASSISTANT エントリは1セクションに結合される", () => {
  const out = run([
    user("質問"),
    assistant([{ type: "text", text: "前半。" }]),
    assistant([{ type: "text", text: "後半。" }])
  ])
  expect(out.match(/## ASSISTANT/g)?.length).toBe(1)
  expect(out).toMatch(/前半。\n\n後半。/)
})

test("サブエージェントの往復(isSidechain)は含めない", () => {
  const out = run([
    user("本編の発言"),
    user("サブエージェントへの指示", { isSidechain: true }),
    assistant([{ type: "text", text: "サブの応答" }], { isSidechain: true })
  ])
  expect(out).toMatch(/本編の発言/)
  expect(out).not.toMatch(/サブ/)
})
